-- 楓伴 v23：LINE 回報共用網站計時資料。先確認 v19～v22 已安裝。
-- 在同一個 Supabase 專案的 SQL Editor 執行一次；可重跑。
begin;
alter table public.boss_kill_events alter column first_reporter drop not null;
alter table public.boss_kill_events add column if not exists report_source text not null default 'website';

create table if not exists public.line_boss_confirmations (
  event_id uuid not null references public.boss_kill_events(id) on delete cascade,
  reporter_hash text not null,
  reported_at timestamptz not null default now(),
  primary key(event_id,reporter_hash)
);
create table if not exists public.line_report_receipts (
  nonce uuid primary key,
  reporter_hash text not null,
  event_id uuid not null references public.boss_kill_events(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists line_report_rate_idx on public.line_report_receipts(reporter_hash,created_at desc);
create table if not exists public.line_boss_favorites (
  reporter_hash text not null,
  server text not null check(server in ('菇菇寶貝','雪吉拉')),
  boss_key text not null references public.boss_definitions(boss_key),
  created_at timestamptz not null default now(),
  primary key(reporter_hash,server,boss_key)
);
alter table public.line_boss_confirmations enable row level security;
alter table public.line_report_receipts enable row level security;
alter table public.line_boss_favorites enable row level security;
revoke all on public.line_boss_confirmations,public.line_report_receipts,public.line_boss_favorites from anon,authenticated;
grant all on public.line_boss_confirmations,public.line_report_receipts,public.line_boss_favorites to service_role;
grant select on public.line_boss_confirmations to authenticated;
drop policy if exists "Admins read LINE confirmations" on public.line_boss_confirmations;
create policy "Admins read LINE confirmations" on public.line_boss_confirmations for select to authenticated using(public.is_fengban_admin());

create or replace function public.line_save_favorite(p_reporter text,p_server text,p_boss text)
returns void language plpgsql security definer set search_path=public as $$
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Forbidden'; end if;
  if p_reporter is null or p_reporter !~ '^[a-f0-9]{64}$' then raise exception 'Invalid reporter'; end if;
  perform pg_advisory_xact_lock(hashtext('line-favorite:'||p_reporter)::bigint);
  if exists(select 1 from public.line_boss_favorites where reporter_hash=p_reporter and server=p_server and boss_key=p_boss) then return; end if;
  if (select count(*) from public.line_boss_favorites where reporter_hash=p_reporter)>=10 then raise exception 'Favorite limit'; end if;
  insert into public.line_boss_favorites(reporter_hash,server,boss_key) values(p_reporter,p_server,p_boss);
end; $$;
revoke all on function public.line_save_favorite(text,text,text) from public,anon,authenticated;
grant execute on function public.line_save_favorite(text,text,text) to service_role;

create or replace function public.line_record_boss_kill(p_nonce uuid,p_reporter text,p_server text,p_boss text,p_channel integer,p_at timestamptz)
returns table(event_id uuid,defeated_at timestamptz,was_duplicate boolean)
language plpgsql security definer set search_path=public as $$
declare
  v_id uuid; v_at timestamptz; v_prev uuid; v_prev_at timestamptz;
  v_duplicate boolean:=false; v_now timestamptz:=clock_timestamp(); v_receipt_reporter text;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Forbidden'; end if;
  if p_reporter is null or p_reporter !~ '^[a-f0-9]{64}$' or p_nonce is null then raise exception 'Invalid reporter'; end if;
  if p_server is null or p_server not in ('菇菇寶貝','雪吉拉') or p_channel is null or p_channel not between 1 and 60 then raise exception 'Invalid location'; end if;
  if not exists(select 1 from public.boss_definitions where boss_key=p_boss and is_active) then raise exception 'Invalid boss'; end if;
  perform pg_advisory_xact_lock(hashtext('line-reporter:'||p_reporter)::bigint);
  perform pg_advisory_xact_lock(hashtext('line-nonce:'||p_nonce::text)::bigint);
  select r.event_id,e.defeated_at,r.reporter_hash into v_id,v_at,v_receipt_reporter
    from public.line_report_receipts r join public.boss_kill_events e on e.id=r.event_id where r.nonce=p_nonce;
  if v_id is not null then
    if v_receipt_reporter<>p_reporter then raise exception 'Invalid receipt'; end if;
    return query select v_id,v_at,true; return;
  end if;
  if p_at is null or p_at>v_now+interval '30 seconds' or p_at<v_now-interval '21 minutes' then raise exception 'Invalid time'; end if;
  if exists(select 1 from public.line_report_receipts r where r.reporter_hash=p_reporter and r.created_at>v_now-interval '10 seconds') then raise exception 'LINE_RATE_LIMIT'; end if;
  -- 和網站 record_boss_kill 使用完全相同的鎖，避免同時回報重複事件。
  perform pg_advisory_xact_lock(hashtext(p_server||'|'||p_boss||'|'||p_channel::text)::bigint);
  select e.id,e.defeated_at into v_prev,v_prev_at from public.boss_kill_events e
    where e.server=p_server and e.boss_key=p_boss and e.channel=p_channel order by e.defeated_at desc limit 1;
  if v_prev is not null and abs(extract(epoch from(p_at-v_prev_at)))<=600 then
    v_id:=v_prev; v_at:=v_prev_at; v_duplicate:=true;
  elsif v_prev is not null and p_at<v_prev_at then
    raise exception 'LINE_STALE';
  else
    insert into public.boss_kill_events(server,boss_key,channel,defeated_at,previous_event_id,interval_seconds,first_reporter,report_source)
      values(p_server,p_boss,p_channel,p_at,v_prev,case when v_prev is null then null else floor(extract(epoch from(p_at-v_prev_at)))::integer end,null,'line')
      returning id into v_id;
    v_at:=p_at;
  end if;
  insert into public.line_boss_confirmations(event_id,reporter_hash) values(v_id,p_reporter) on conflict do nothing;
  insert into public.boss_timer_state(server,boss_key,channel,defeated_at,event_id,updated_at)
    values(p_server,p_boss,p_channel,v_at,v_id,v_now)
    on conflict(server,boss_key,channel) do update set defeated_at=excluded.defeated_at,event_id=excluded.event_id,updated_at=excluded.updated_at;
  insert into public.line_report_receipts(nonce,reporter_hash,event_id) values(p_nonce,p_reporter,v_id);
  return query select v_id,v_at,v_duplicate;
end; $$;
revoke all on function public.line_record_boss_kill(uuid,text,text,text,integer,timestamptz) from public,anon,authenticated;
grant execute on function public.line_record_boss_kill(uuid,text,text,text,integer,timestamptz) to service_role;
notify pgrst,'reload schema';
commit;
