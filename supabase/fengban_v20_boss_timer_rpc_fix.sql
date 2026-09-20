-- 楓伴 v20：社群實測 BOSS 計時器（RPC 修正版）
-- 玩家操作：選王 → 選頻道 → 王已消滅
-- 系統自動：開始倒數、同輪多人回報去重、累積連續擊殺間隔、官方帳號看統計

create extension if not exists pgcrypto;

-- 既有楓伴主程式已使用 admin_users；若正式環境已有此表，這行不會更動原資料。
create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.boss_definitions (
  boss_key text primary key,
  boss_name text not null,
  short_name text not null,
  icon text not null default '👑',
  respawn_min_minutes integer not null check (respawn_min_minutes between 1 and 1440),
  respawn_max_minutes integer not null check (respawn_max_minutes between 1 and 1440),
  source_type text not null default 'community',
  source_note text not null default '',
  sort_order integer not null default 0,
  is_active boolean not null default true,
  updated_at timestamptz not null default now(),
  constraint boss_definitions_range_check check (respawn_max_minutes >= respawn_min_minutes)
);

-- 目前測試版初始參考值。之後可用官方帳號依楓伴實測結果校正。
insert into public.boss_definitions
  (boss_key,boss_name,short_name,icon,respawn_min_minutes,respawn_max_minutes,source_type,source_note,sort_order)
values
  ('mano','紅寶王','紅寶王','🔴',30,45,'community','現版本仍需更多當版實測；先用寬區間測試',10),
  ('stumpy','樹妖王','樹妖王','🌳',35,45,'community','當版玩家回報約 35～45 分',20),
  ('zombie_lupin_boss','殭屍猴王','猴王','🐒',45,45,'community','當版玩家回報約 45 分',30),
  ('king_clang','巨居蟹','巨居蟹','🦀',45,45,'community','當版玩家回報約 45 分',40),
  ('mushmom','蘑菇王','蘑菇王','🍄',45,60,'community','當版玩家回報約 45～60 分',50),
  ('dyle','沼澤巨鱷','巨鱷','🐊',45,45,'community','當版玩家回報約 45 分',60),
  ('zombie_mushmom','殭屍蘑菇王','殭屍菇王','☠️',45,55,'fengban','楓伴站長 2026-09-19 實測約 45～55 分',70),
  ('jr_balrog','巴洛古','巴洛古','👹',405,540,'community','目前仍採社群舊有區間，待經典版玩家實測校正',80)
on conflict (boss_key) do update set
  boss_name=excluded.boss_name,
  short_name=excluded.short_name,
  icon=excluded.icon,
  respawn_min_minutes=excluded.respawn_min_minutes,
  respawn_max_minutes=excluded.respawn_max_minutes,
  source_type=excluded.source_type,
  source_note=excluded.source_note,
  sort_order=excluded.sort_order,
  is_active=true,
  updated_at=now();

create table if not exists public.boss_kill_events (
  id uuid primary key default gen_random_uuid(),
  server text not null,
  boss_key text not null references public.boss_definitions(boss_key) on update cascade,
  channel integer not null check (channel between 1 and 60),
  defeated_at timestamptz not null,
  previous_event_id uuid references public.boss_kill_events(id) on delete set null,
  interval_seconds integer check (interval_seconds is null or interval_seconds > 0),
  first_reporter uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create index if not exists boss_kill_events_lookup_idx
  on public.boss_kill_events(server,boss_key,channel,defeated_at desc);
create index if not exists boss_kill_events_boss_idx
  on public.boss_kill_events(server,boss_key,defeated_at desc);

create table if not exists public.boss_kill_confirmations (
  event_id uuid not null references public.boss_kill_events(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  reported_at timestamptz not null default now(),
  primary key(event_id,user_id)
);

create index if not exists boss_kill_confirmations_reported_idx
  on public.boss_kill_confirmations(reported_at desc);

create table if not exists public.boss_timer_state (
  id uuid primary key default gen_random_uuid(),
  server text not null,
  boss_key text not null references public.boss_definitions(boss_key) on update cascade,
  channel integer not null check (channel between 1 and 60),
  defeated_at timestamptz not null,
  event_id uuid not null references public.boss_kill_events(id) on delete cascade,
  updated_at timestamptz not null default now(),
  unique(server,boss_key,channel)
);

create index if not exists boss_timer_state_server_idx
  on public.boss_timer_state(server,updated_at desc);

alter table public.boss_definitions enable row level security;
alter table public.boss_kill_events enable row level security;
alter table public.boss_kill_confirmations enable row level security;
alter table public.boss_timer_state enable row level security;

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

drop policy if exists "Boss definitions are publicly readable" on public.boss_definitions;
create policy "Boss definitions are publicly readable"
on public.boss_definitions for select using(true);

drop policy if exists "Admins can manage boss definitions" on public.boss_definitions;
create policy "Admins can manage boss definitions"
on public.boss_definitions for all
using(public.is_fengban_admin())
with check(public.is_fengban_admin());

drop policy if exists "Boss timer state is publicly readable" on public.boss_timer_state;
create policy "Boss timer state is publicly readable"
on public.boss_timer_state for select using(true);

-- 原始擊殺事件與玩家確認資料只給官方／管理員帳號查看。
drop policy if exists "Admins can read boss kill events" on public.boss_kill_events;
create policy "Admins can read boss kill events"
on public.boss_kill_events for select using(public.is_fengban_admin());

drop policy if exists "Admins can read boss confirmations" on public.boss_kill_confirmations;
create policy "Admins can read boss confirmations"
on public.boss_kill_confirmations for select using(public.is_fengban_admin());

-- 所有新增都經由 RPC 執行，不開放前端直接寫入原始資料表。
drop function if exists public.record_boss_kill(text,text,integer);
drop function if exists public.record_boss_kill(text,integer,text);

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

  select b.respawn_min_minutes,b.respawn_max_minutes
  into v_min,v_max
  from public.boss_definitions b
  where b.boss_key=p_boss_key and b.is_active=true;

  if v_min is null then
    raise exception '找不到這隻王的設定';
  end if;

  -- 避免兩名玩家同時按下，產生兩個事件。
  perform pg_advisory_xact_lock(hashtext(p_server||'|'||p_boss_key||'|'||p_channel::text)::bigint);

  select e.id,e.defeated_at
  into v_prev_id,v_prev_at
  from public.boss_kill_events e
  where e.server=p_server
    and e.boss_key=p_boss_key
    and e.channel=p_channel
  order by e.defeated_at desc
  limit 1;

  -- 10 分鐘內的同王同頻道回報視為同一輪擊殺，只增加確認玩家，不新增週期。
  if v_prev_id is not null and v_now-v_prev_at<=interval '10 minutes' then
    v_event_id:=v_prev_id;
    v_event_at:=v_prev_at;
    v_duplicate:=true;
  else
    if v_prev_at is not null then
      v_interval_seconds:=floor(extract(epoch from (v_now-v_prev_at)))::integer;
    else
      v_interval_seconds:=null;
    end if;

    insert into public.boss_kill_events(
      server,boss_key,channel,defeated_at,previous_event_id,interval_seconds,first_reporter
    ) values(
      p_server,p_boss_key,p_channel,v_now,v_prev_id,v_interval_seconds,v_uid
    ) returning id,defeated_at into v_event_id,v_event_at;
  end if;

  insert into public.boss_kill_confirmations(event_id,user_id,reported_at)
  values(v_event_id,v_uid,v_now)
  on conflict(event_id,user_id) do nothing;

  insert into public.boss_timer_state(server,boss_key,channel,defeated_at,event_id,updated_at)
  values(p_server,p_boss_key,p_channel,v_event_at,v_event_id,v_now)
  on conflict(server,boss_key,channel) do update set
    defeated_at=excluded.defeated_at,
    event_id=excluded.event_id,
    updated_at=excluded.updated_at;

  return query select v_event_id,v_event_at,v_duplicate,v_min,v_max;
end;
$$;

revoke all on function public.record_boss_kill(text,integer,text) from public;
grant execute on function public.record_boss_kill(text,integer,text) to authenticated;

-- 讓所有在線玩家即時看到倒數更新。
do $$
begin
  if not exists(
    select 1 from pg_publication_tables
    where pubname='supabase_realtime'
      and schemaname='public'
      and tablename='boss_timer_state'
  ) then
    alter publication supabase_realtime add table public.boss_timer_state;
  end if;
end
$$;


-- 強制 PostgREST / Supabase API 重新讀取新函式。
notify pgrst, 'reload schema';
