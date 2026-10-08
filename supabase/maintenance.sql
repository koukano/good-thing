-- SQL Editorで一度実行。DB管理者だけが実行できる整理関数。
create or replace function public.good_things_cleanup()
returns void language plpgsql security definer set search_path = '' as $$
begin
  delete from public.posts where status = 'hidden' and moderated_at < now() - interval '90 days';
  delete from public.reports where resolved_at < now() - interval '90 days';
  delete from public.moderation_log where created_at < now() - interval '1 year';
  delete from public.rate_buckets where bucket < now() - interval '2 days';
end;
$$;
revoke all on function public.good_things_cleanup() from public, anon, authenticated, service_role;

-- 手動実行する場合は次の1行をSQL Editorで実行します。
-- select public.good_things_cleanup();

-- 自動で毎日整理する場合、Supabase DashboardのIntegrationsでCron(pg_cron)を有効化し、
-- 次の3行のコメント記号を外して一度だけ実行してください。UTC 18:00 = 日本時間03:00。
-- select cron.schedule('good-things-cleanup', '0 18 * * *',
--   $$select public.good_things_cleanup();$$
-- );
