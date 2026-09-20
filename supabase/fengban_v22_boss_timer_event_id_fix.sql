-- 楓伴 BOSS 計時器 v22：record_boss_kill event_id 歧義修正
-- 只需要在 Supabase SQL Editor 執行一次。
-- 不需重跑 v20 / v21，不需重新部署前端。

create or replace function public.record_boss_kill(
  p_boss_key text,
  p_channel integer,
  p_server text
)
returns table(
  event_id uuid,
  defeated_at timestamptz,
  was_duplicate boolean,
  respawn_min_minutes integer,
  respawn_max_minutes integer
)
language plpgsql
security definer
set search_path=public
as $$
declare
  v_uid uuid:=auth.uid();
  v_now timestamptz:=clock_timestamp();
  v_prev_id uuid;
  v_prev_at timestamptz;
  v_event_id uuid;
  v_event_at timestamptz;
  v_interval_seconds integer;
  v_min integer;
  v_max integer;
  v_duplicate boolean:=false;
begin
  if v_uid is null then
    raise exception '請先登入後再回報王已消滅';
  end if;

  if p_server is null or btrim(p_server)='' then
    raise exception '伺服器不可為空白';
  end if;

  if p_channel is null or p_channel<1 or p_channel>60 then
    raise exception '頻道必須介於 1～60';
  end if;

  select
    b.respawn_min_minutes,
    b.respawn_max_minutes
  into
    v_min,
    v_max
  from public.boss_definitions as b
  where b.boss_key=p_boss_key
    and b.is_active=true;

  if v_min is null then
    raise exception '找不到這隻王的設定';
  end if;

  -- 避免兩名玩家同時按下造成兩個事件。
  perform pg_advisory_xact_lock(
    hashtext(p_server||'|'||p_boss_key||'|'||p_channel::text)::bigint
  );

  select
    e.id,
    e.defeated_at
  into
    v_prev_id,
    v_prev_at
  from public.boss_kill_events as e
  where e.server=p_server
    and e.boss_key=p_boss_key
    and e.channel=p_channel
  order by e.defeated_at desc
  limit 1;

  -- 10 分鐘內同王同頻道的多人回報視為同一輪擊殺。
  if v_prev_id is not null
     and v_now-v_prev_at<=interval '10 minutes' then
    v_event_id:=v_prev_id;
    v_event_at:=v_prev_at;
    v_duplicate:=true;
  else
    if v_prev_at is not null then
      v_interval_seconds:=
        floor(extract(epoch from (v_now-v_prev_at)))::integer;
    else
      v_interval_seconds:=null;
    end if;

    insert into public.boss_kill_events as new_event(
      server,
      boss_key,
      channel,
      defeated_at,
      previous_event_id,
      interval_seconds,
      first_reporter
    )
    values(
      p_server,
      p_boss_key,
      p_channel,
      v_now,
      v_prev_id,
      v_interval_seconds,
      v_uid
    )
    returning
      new_event.id,
      new_event.defeated_at
    into
      v_event_id,
      v_event_at;
  end if;

  -- 直接指定主鍵 constraint，避免 event_id 與 RETURNS TABLE 的 event_id 撞名。
  insert into public.boss_kill_confirmations as confirmation(
    event_id,
    user_id,
    reported_at
  )
  values(
    v_event_id,
    v_uid,
    v_now
  )
  on conflict on constraint boss_kill_confirmations_pkey
  do nothing;

  insert into public.boss_timer_state as timer_state(
    server,
    boss_key,
    channel,
    defeated_at,
    event_id,
    updated_at
  )
  values(
    p_server,
    p_boss_key,
    p_channel,
    v_event_at,
    v_event_id,
    v_now
  )
  on conflict(server,boss_key,channel)
  do update set
    defeated_at=excluded.defeated_at,
    event_id=excluded.event_id,
    updated_at=excluded.updated_at;

  return query
  select
    v_event_id,
    v_event_at,
    v_duplicate,
    v_min,
    v_max;
end;
$$;

revoke all on function public.record_boss_kill(text,integer,text) from public;
grant execute on function public.record_boss_kill(text,integer,text) to authenticated;

notify pgrst, 'reload schema';
