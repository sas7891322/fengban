-- 楓伴 BOSS 計時器 v26：管理員可重設倒數出生時間＋自訂前後區間
-- 執行一次即可。前端需部署 v26 版本。

alter table public.boss_timer_state
  add column if not exists target_respawn_at timestamptz,
  add column if not exists window_before_minutes integer,
  add column if not exists window_after_minutes integer;

alter table public.boss_timer_state
  drop constraint if exists boss_timer_state_window_before_check,
  drop constraint if exists boss_timer_state_window_after_check;

alter table public.boss_timer_state
  add constraint boss_timer_state_window_before_check
    check (window_before_minutes is null or window_before_minutes between 0 and 1440),
  add constraint boss_timer_state_window_after_check
    check (window_after_minutes is null or window_after_minutes between 0 and 1440);

-- 新一輪擊殺若 defeated_at 改變，自動清掉上一輪人工重設值。
create or replace function public.clear_boss_timer_override_on_new_kill()
returns trigger
language plpgsql
set search_path=public
as $$
begin
  if tg_op='INSERT' then
    return new;
  end if;

  if new.defeated_at is distinct from old.defeated_at then
    new.target_respawn_at:=null;
    new.window_before_minutes:=null;
    new.window_after_minutes:=null;
  end if;
  return new;
end;
$$;

drop trigger if exists boss_timer_clear_override_on_new_kill on public.boss_timer_state;
create trigger boss_timer_clear_override_on_new_kill
before update on public.boss_timer_state
for each row execute function public.clear_boss_timer_override_on_new_kill();

create or replace function public.admin_reset_boss_timer(
  p_server text,
  p_boss_key text,
  p_channel integer,
  p_countdown_minutes integer,
  p_before_minutes integer default 0,
  p_after_minutes integer default 0
)
returns table(
  target_respawn_at timestamptz,
  window_start_at timestamptz,
  window_end_at timestamptz
)
language plpgsql
security definer
set search_path=public
as $$
declare
  v_target timestamptz;
  v_before integer:=greatest(0,coalesce(p_before_minutes,0));
  v_after integer:=greatest(0,coalesce(p_after_minutes,0));
begin
  if not public.is_fengban_admin() then
    raise exception '只有管理員可以重設王計時';
  end if;

  if p_server is null or btrim(p_server)='' then
    raise exception '伺服器不可為空白';
  end if;
  if p_channel is null or p_channel<1 or p_channel>60 then
    raise exception '頻道必須介於 1～60';
  end if;
  if p_countdown_minutes is null or p_countdown_minutes<0 or p_countdown_minutes>10080 then
    raise exception '倒數時間必須介於 0～10080 分鐘';
  end if;
  if v_before>1440 or v_after>1440 then
    raise exception '前後區間不可超過 1440 分鐘';
  end if;

  v_target:=clock_timestamp()+make_interval(mins=>p_countdown_minutes);

  update public.boss_timer_state
  set target_respawn_at=v_target,
      window_before_minutes=v_before,
      window_after_minutes=v_after,
      updated_at=clock_timestamp()
  where server=p_server
    and boss_key=p_boss_key
    and channel=p_channel;

  if not found then
    raise exception '找不到這筆王計時紀錄';
  end if;

  return query select
    v_target,
    v_target-make_interval(mins=>v_before),
    v_target+make_interval(mins=>v_after);
end;
$$;

revoke all on function public.admin_reset_boss_timer(text,text,integer,integer,integer,integer) from public;
grant execute on function public.admin_reset_boss_timer(text,text,integer,integer,integer,integer) to authenticated;

notify pgrst, 'reload schema';
