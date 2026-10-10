-- 既存データを保持する追加変更です。初期SQLの実行済みプロジェクトで一度だけ実行。
-- 投稿・いいね・通報を削除しません。失敗時はトランザクション全体が戻ります。
begin;
lock table public.posts in access exclusive mode;
create temporary table talking_migration_snapshot on commit drop as
  select count(*) as n, md5(coalesce(string_agg(to_jsonb(p)::text, '' order by p.id), '')) as digest from public.posts p;
alter table public.posts add column views_count integer not null default 0 check (views_count >= 0);
create table public.post_views (
  post_id uuid not null references public.posts(id) on delete cascade,
  actor_hash text not null check (length(actor_hash) = 64),
  created_at timestamptz not null default now(),
  primary key (post_id, actor_hash)
);
alter table public.post_views enable row level security;
revoke all on public.post_views from public, anon, authenticated;
grant select, insert, update, delete on public.post_views to service_role;

create or replace function public.good_things_limit(p_action text, p_actor text, p_ip text)
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
  elsif p_action = 'view' then
    perform public.good_things_bucket('actor:' || p_actor, 'view:minute', v_min, 20);
    perform public.good_things_bucket('actor:' || p_actor, 'view:day', v_day, 200);
    perform public.good_things_bucket('ip:' || p_ip, 'view:minute', v_min, 120);
    perform public.good_things_bucket('global', 'view:minute', v_min, 600);
    perform public.good_things_bucket('global', 'view:day', v_day, 15000);
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

create or replace function public.good_things_list(p_ip text, p_before_time timestamptz default null, p_before_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_posts jsonb;
begin
  if (p_before_time is null) <> (p_before_id is null) then raise exception 'invalid_input'; end if;
  perform public.good_things_limit('read', null, p_ip);
  select coalesce(jsonb_agg(to_jsonb(p) order by p.created_at desc, p.id desc), '[]'::jsonb) into v_posts
    from (
      select id, body, created_at, likes_count, views_count from public.posts
      where status = 'visible' and (p_before_time is null or (created_at, id) < (p_before_time, p_before_id))
      order by created_at desc, id desc limit 21
    ) p;
  return v_posts;
end;
$$;

create or replace function public.good_things_write(p_action text, p_actor text, p_ip text, p_body text default null,
  p_request uuid default null, p_post uuid default null, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_post public.posts; v_inserted integer;
begin
  if p_action not in ('post', 'like', 'report', 'view') or p_action is null or p_actor is null or p_ip is null
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
    return jsonb_build_object('post', jsonb_build_object('id', v_post.id, 'body', v_post.body, 'created_at', v_post.created_at, 'likes_count', v_post.likes_count, 'views_count', v_post.views_count));
  end if;

  if p_post is null then raise exception 'invalid_input'; end if;
  select * into v_post from public.posts where id = p_post and status = 'visible' for update;
  if not found then raise exception 'post_unavailable'; end if;
  perform public.good_things_limit(p_action, p_actor, p_ip);
  if p_action = 'view' then
    insert into public.post_views(post_id, actor_hash) values(p_post, p_actor) on conflict do nothing;
    get diagnostics v_inserted = row_count;
    if v_inserted = 1 then
      update public.posts set views_count = views_count + 1 where id = p_post returning * into v_post;
    end if;
    return jsonb_build_object('views_count', v_post.views_count, 'alreadyViewed', v_inserted = 0);
  end if;
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

-- 削除はログイン済み管理者が明示的に実行した場合のみ。通常の投稿には影響しません。
create function public.good_things_delete(p_post uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_old text;
begin
  if p_reason is null or char_length(trim(p_reason)) not between 1 and 500 then raise exception 'invalid_input'; end if;
  perform pg_advisory_xact_lock(20261008, 1);
  select status into v_old from public.posts where id = p_post for update;
  if not found then raise exception 'post_unavailable'; end if;
  insert into public.moderation_log(post_id, previous_status, new_status, reason, operated_by)
    values(p_post, v_old, 'deleted', trim(p_reason), session_user);
  delete from public.posts where id = p_post;
end;
$$;
revoke all on function public.good_things_delete(uuid,text) from public, anon, authenticated, service_role;

-- 古い投稿の全フィールドが変わっていないことを検査。不一致ならすべてロールバック。
do $$
begin
  if not exists (
    select 1 from talking_migration_snapshot s cross join
      (select count(*) as n, md5(coalesce(string_agg((to_jsonb(p) - 'views_count')::text, '' order by p.id), '')) as digest from public.posts p) current
    where s.n = current.n and s.digest = current.digest
  ) then raise exception 'existing_data_changed'; end if;
end;
$$;
commit;
select count(*) as existing_posts, true as views_ready from public.posts;
