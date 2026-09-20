-- 楓伴 v18：楓之谷經典版 BOSS 重生計時器
-- 在 Supabase SQL Editor 執行一次即可。

create extension if not exists pgcrypto;

create table if not exists public.boss_timers (
  id uuid primary key default gen_random_uuid(),
  server text not null,
  boss_name text not null check (char_length(boss_name) between 1 and 80),
  map_name text not null default '' check (char_length(map_name) <= 120),
  channel integer not null check (channel between 1 and 99),
  respawn_min_minutes integer not null check (respawn_min_minutes between 1 and 10080),
  respawn_max_minutes integer not null check (respawn_max_minutes between 1 and 10080),
  defeated_at timestamptz not null,
  notes text not null default '' check (char_length(notes) <= 500),
  created_by uuid not null references auth.users(id) on delete cascade,
  updated_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint boss_timers_respawn_range_check check (respawn_max_minutes >= respawn_min_minutes),
  constraint boss_timers_server_boss_channel_unique unique (server, boss_name, channel)
);

create index if not exists boss_timers_defeated_at_idx
  on public.boss_timers(defeated_at desc);

create index if not exists boss_timers_server_idx
  on public.boss_timers(server, boss_name, channel);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists boss_timers_set_updated_at on public.boss_timers;
create trigger boss_timers_set_updated_at
before update on public.boss_timers
for each row execute function public.set_updated_at();

alter table public.boss_timers enable row level security;

drop policy if exists "Boss timers are publicly readable" on public.boss_timers;
create policy "Boss timers are publicly readable"
on public.boss_timers
for select
using (true);

drop policy if exists "Signed in users can create boss timers" on public.boss_timers;
create policy "Signed in users can create boss timers"
on public.boss_timers
for insert
with check (
  auth.uid() is not null
  and auth.uid() = created_by
  and auth.uid() = updated_by
);

drop policy if exists "Signed in users can update boss timers" on public.boss_timers;
create policy "Signed in users can update boss timers"
on public.boss_timers
for update
using (auth.uid() is not null)
with check (
  auth.uid() is not null
  and auth.uid() = updated_by
);

drop policy if exists "Creators can delete boss timers" on public.boss_timers;
create policy "Creators can delete boss timers"
on public.boss_timers
for delete
using (auth.uid() = created_by);

-- 讓其他在線玩家能即時收到新增／更新／刪除。
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'boss_timers'
  ) then
    alter publication supabase_realtime add table public.boss_timers;
  end if;
end
$$;
