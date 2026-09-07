-- 楓伴 v14：累積瀏覽 + 目前在線
-- 累積瀏覽：每個瀏覽器分頁工作階段只記 1 次，避免重新整理一直灌水。
-- 目前在線：前端使用 Supabase Realtime Presence，不需要額外在線資料表。

create table if not exists public.site_metrics (
  key text primary key,
  total_views bigint not null default 0,
  updated_at timestamp with time zone not null default now()
);

alter table public.site_metrics enable row level security;

insert into public.site_metrics(key,total_views)
values ('main',0)
on conflict (key) do nothing;

create or replace function public.record_fengban_visit()
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  result bigint;
begin
  insert into public.site_metrics(key,total_views,updated_at)
  values ('main',1,now())
  on conflict (key)
  do update set
    total_views = public.site_metrics.total_views + 1,
    updated_at = now()
  returning total_views into result;

  return result;
end;
$$;

create or replace function public.get_fengban_visit_count()
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select total_views from public.site_metrics where key='main'),
    0
  );
$$;

revoke all on public.site_metrics from anon, authenticated;
grant execute on function public.record_fengban_visit() to anon, authenticated;
grant execute on function public.get_fengban_visit_count() to anon, authenticated;
