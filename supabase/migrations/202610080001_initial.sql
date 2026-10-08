-- この専用プロジェクトに一度だけ実行してください。数学サイトのDBには実行しません。
begin;

create table public.posts (
  id uuid primary key default gen_random_uuid(),
  body text not null check (char_length(body) between 1 and 300)
    check (regexp_replace(body, '[[:space:]' || chr(8203) || chr(8204) || chr(8205) || chr(8288) || chr(65279) || ']', '', 'g') <> ''),
  created_at timestamptz not null default now(),
  status text not null default 'visible' check (status in ('visible', 'hidden')),
  moderated_at timestamptz,
  likes_count integer not null default 0 check (likes_count >= 0),
  actor_hash text not null check (length(actor_hash) = 64),
  request_id uuid not null,
  unique (actor_hash, request_id),
  check (status <> 'hidden' or moderated_at is not null)
);
create index posts_feed on public.posts (created_at desc, id desc) where status = 'visible';
create index posts_actor_time on public.posts (actor_hash, created_at desc);

create table public.likes (
  post_id uuid not null references public.posts(id) on delete cascade,
  actor_hash text not null check (length(actor_hash) = 64),
  created_at timestamptz not null default now(),
  primary key (post_id, actor_hash)
);
create table public.reports (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  actor_hash text not null check (length(actor_hash) = 64),
  reason text not null check (reason in ('personal', 'abuse', 'spam', 'other')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  unique (post_id, actor_hash)
);
create index reports_open on public.reports(created_at desc) where resolved_at is null;

create table public.rate_buckets (
  scope text not null,
  action text not null,
  bucket timestamptz not null,
  hits integer not null default 0,
  primary key (scope, action, bucket)
);
create table public.moderation_log (
  id bigint generated always as identity primary key,
  post_id uuid not null,
  previous_status text not null,
  new_status text not null,
  reason text not null check (char_length(reason) between 1 and 500),
  operated_by text not null,
  created_at timestamptz not null default now()
);

-- 一般の閲覧者にはテーブルへの権限もRLSポリシーも与えません。
alter table public.posts enable row level security;
alter table public.likes enable row level security;
alter table public.reports enable row level security;
alter table public.rate_buckets enable row level security;
alter table public.moderation_log enable row level security;
revoke all on public.posts, public.likes, public.reports, public.rate_buckets, public.moderation_log from public, anon, authenticated;
grant select, insert, update, delete on public.posts, public.likes, public.reports, public.rate_buckets, public.moderation_log to service_role;
grant usage, select on sequence public.moderation_log_id_seq to service_role;

-- 同じバケットへの加算は原子的。超過は例外でトランザクション全体をロールバック。
create function public.good_things_bucket(p_scope text, p_action text, p_bucket timestamptz, p_max integer)
returns void language plpgsql security definer set search_path = '' as $$
declare v_hits integer;
begin
  insert into public.rate_buckets(scope, action, bucket, hits) values(p_scope, p_action, p_bucket, 1)
    on conflict(scope, action, bucket) do update set hits = public.rate_buckets.hits + 1
    returning hits into v_hits;
  if v_hits > p_max then raise exception 'rate_limited' using errcode = 'P0001'; end if;
end;
$$;

create function public.good_things_limit(p_action text, p_actor text, p_ip text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_min timestamptz := date_trunc('minute', now());
  v_hour timestamptz := date_trunc('hour', now());
  v_day timestamptz := date_trunc('day', now() at time zone 'UTC') at time zone 'UTC';
begin
  -- 小規模サイト向けに順序を一本化。多重リクエストで上限をすり抜けません。
  perform pg_advisory_xact_lock(20261008, 1);
  if length(p_ip) <> 64 or (p_action <> 'read' and length(p_actor) <> 64) then
    raise exception 'invalid_input';
  end if;
  if p_action = 'post' then
    perform public.good_things_bucket('actor:' || p_actor, 'post:minute', v_min, 1);
    perform public.good_things_bucket('actor:' || p_actor, 'post:hour', v_hour, 5);
    perform public.good_things_bucket('ip:' || p_ip, 'post:minute', v_min, 5);
    perform public.good_things_bucket('ip:' || p_ip, 'post:hour', v_hour, 30);
    perform public.good_things_bucket('global', 'post:minute', v_min, 30);
    perform public.good_things_bucket('global', 'post:day', v_day, 300);
  elsif p_action = 'like' then
    perform public.good_things_bucket('actor:' || p_actor, 'like:minute', v_min, 30);
    perform public.good_things_bucket('actor:' || p_actor, 'like:day', v_day, 300);
    perform public.good_things_bucket('ip:' || p_ip, 'like:minute', v_min, 100);
    perform public.good_things_bucket('global', 'like:minute', v_min, 500);
    perform public.good_things_bucket('global', 'like:day', v_day, 10000);
  elsif p_action = 'report' then
    perform public.good_things_bucket('actor:' || p_actor, 'report:minute', v_min, 3);
    perform public.good_things_bucket('actor:' || p_actor, 'report:day', v_day, 20);
    perform public.good_things_bucket('ip:' || p_ip, 'report:minute', v_min, 20);
    perform public.good_things_bucket('global', 'report:minute', v_min, 100);
    perform public.good_things_bucket('global', 'report:day', v_day, 1000);
  elsif p_action = 'read' then
    perform public.good_things_bucket('ip:' || p_ip, 'read:minute', v_min, 120);
    perform public.good_things_bucket('global', 'read:minute', v_min, 3000);
  else raise exception 'invalid_input';
  end if;
  -- 生IPは保存せず、バケット自体も2日以内に削除します。
  delete from public.rate_buckets where bucket < now() - interval '2 days';
end;
$$;

create function public.good_things_list(p_ip text, p_before_time timestamptz default null, p_before_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_posts jsonb;
begin
  if (p_before_time is null) <> (p_before_id is null) then raise exception 'invalid_input'; end if;
  perform public.good_things_limit('read', null, p_ip);
  select coalesce(jsonb_agg(to_jsonb(p) order by p.created_at desc, p.id desc), '[]'::jsonb) into v_posts
    from (
      select id, body, created_at, likes_count from public.posts
      where status = 'visible' and (p_before_time is null or (created_at, id) < (p_before_time, p_before_id))
      order by created_at desc, id desc limit 21
    ) p;
  return v_posts;
end;
$$;

create function public.good_things_write(p_action text, p_actor text, p_ip text, p_body text default null,
  p_request uuid default null, p_post uuid default null, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_post public.posts; v_inserted integer;
begin
  if p_action not in ('post', 'like', 'report') or p_action is null or p_actor is null or p_ip is null
    or length(p_actor) <> 64 or length(p_ip) <> 64 then raise exception 'invalid_input'; end if;
  perform pg_advisory_xact_lock(20261008, 1);
  if p_action = 'post' then
    if p_body is null or p_request is null or char_length(p_body) not between 1 and 300
      or regexp_replace(p_body, '[[:space:]' || chr(8203) || chr(8204) || chr(8205) || chr(8288) || chr(65279) || ']', '', 'g') = ''
      then raise exception 'invalid_input'; end if;
    -- 通信断後の同じリクエストを再送しても、重複投稿を作りません。
    select * into v_post from public.posts where actor_hash = p_actor and request_id = p_request;
    if found then
      if v_post.status <> 'visible' or v_post.body <> p_body then raise exception 'invalid_input'; end if;
    else
      perform public.good_things_limit('post', p_actor, p_ip);
      if exists(select 1 from public.posts where actor_hash = p_actor and created_at > now() - interval '60 seconds')
        then raise exception 'rate_limited'; end if;
      if exists(select 1 from public.posts where actor_hash = p_actor and body = p_body and created_at > now() - interval '1 day')
        then raise exception 'duplicate_body'; end if;
      insert into public.posts(body, actor_hash, request_id) values(p_body, p_actor, p_request) returning * into v_post;
    end if;
    return jsonb_build_object('post', jsonb_build_object('id', v_post.id, 'body', v_post.body, 'created_at', v_post.created_at, 'likes_count', v_post.likes_count));
  end if;

  if p_post is null then raise exception 'invalid_input'; end if;
  select * into v_post from public.posts where id = p_post and status = 'visible' for update;
  if not found then raise exception 'post_unavailable'; end if;
  perform public.good_things_limit(p_action, p_actor, p_ip);
  if p_action = 'like' then
    insert into public.likes(post_id, actor_hash) values(p_post, p_actor) on conflict do nothing;
    get diagnostics v_inserted = row_count;
    if v_inserted = 1 then
      update public.posts set likes_count = likes_count + 1 where id = p_post returning * into v_post;
    end if;
    return jsonb_build_object('likes_count', v_post.likes_count, 'alreadyLiked', v_inserted = 0);
  end if;
  if p_reason is null or p_reason not in ('personal', 'abuse', 'spam', 'other') then raise exception 'invalid_input'; end if;
  insert into public.reports(post_id, actor_hash, reason) values(p_post, p_actor, p_reason) on conflict do nothing;
  return jsonb_build_object('ok', true);
end;
$$;

-- 管理者はSupabaseダッシュボードに認証して、この関数をSQL Editorで実行。
-- 一般利用者のanon / authenticatedキーからは呼べません。
create function public.good_things_moderate(p_post uuid, p_status text, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_old text;
begin
  if p_status not in ('visible', 'hidden') or p_status is null or p_reason is null or char_length(trim(p_reason)) not between 1 and 500
    then raise exception 'invalid_input'; end if;
  select status into v_old from public.posts where id = p_post for update;
  if not found then raise exception 'post_unavailable'; end if;
  update public.posts set status = p_status, moderated_at = now() where id = p_post;
  insert into public.moderation_log(post_id, previous_status, new_status, reason, operated_by)
    values(p_post, v_old, p_status, trim(p_reason), session_user);
  update public.reports set resolved_at = now() where post_id = p_post and resolved_at is null;
end;
$$;

-- PostgreSQLの関数は既定でPUBLIC実行可なので、全関数を明示的に取り消します。
revoke all on function public.good_things_bucket(text,text,timestamptz,integer) from public, anon, authenticated;
revoke all on function public.good_things_limit(text,text,text) from public, anon, authenticated;
revoke all on function public.good_things_list(text,timestamptz,uuid) from public, anon, authenticated;
revoke all on function public.good_things_write(text,text,text,text,uuid,uuid,text) from public, anon, authenticated;
revoke all on function public.good_things_moderate(uuid,text,text) from public, anon, authenticated;
grant execute on function public.good_things_list(text,timestamptz,uuid) to service_role;
grant execute on function public.good_things_write(text,text,text,text,uuid,uuid,text) to service_role;
-- moderateはDB所有者だけに限定。Edge Functionにも管理機能を与えません。
revoke all on function public.good_things_moderate(uuid,text,text) from service_role;
commit;
