-- 楓伴 BOSS 計時器 v27：王種全域重生時間設定
-- 如果已經執行過 v20 / v19，這支 SQL 主要用來再次確認管理員可修改 boss_definitions。
-- 前端 v27 會直接更新 boss_definitions 的 respawn_min_minutes / respawn_max_minutes。

create or replace function public.is_fengban_admin()
returns boolean
language sql
stable
security definer
set search_path=public
as $$
  select auth.uid() is not null
    and exists(select 1 from public.admin_users a where a.user_id=auth.uid());
$$;

revoke all on function public.is_fengban_admin() from public;
grant execute on function public.is_fengban_admin() to authenticated;

alter table public.boss_definitions enable row level security;

drop policy if exists "Boss definitions are publicly readable" on public.boss_definitions;
create policy "Boss definitions are publicly readable"
on public.boss_definitions for select using(true);

drop policy if exists "Admins can manage boss definitions" on public.boss_definitions;
create policy "Admins can manage boss definitions"
on public.boss_definitions for all
using(public.is_fengban_admin())
with check(public.is_fengban_admin());

notify pgrst, 'reload schema';
