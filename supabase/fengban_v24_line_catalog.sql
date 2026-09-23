-- Additive migration. Run in the existing project. No boss data is changed.
begin;
create table if not exists public.line_guide_entries (
 id uuid primary key default gen_random_uuid(),
 kind text not null check (kind in ('任務','裝備','怪物')),
 name text not null check (char_length(name) between 1 and 80),
 aliases text not null default '' check (char_length(aliases)<=500),
 search_text text generated always as (name || ' ' || aliases) stored,
 summary text not null check (char_length(summary) between 1 and 160),
 details text not null check (char_length(details) between 1 and 3000),
 game_version text not null check (char_length(game_version) between 1 and 120),
 source_label text not null check (char_length(source_label) between 1 and 120),
 source_url text not null check (source_url ~ '^https://' and char_length(source_url)<=500),
 verified_at date not null,
 is_published boolean not null default false,
 created_at timestamptz not null default now(),
 unique (kind,name,game_version)
);
create index if not exists line_guide_entries_browse on public.line_guide_entries(kind,is_published,name,id);
alter table public.line_guide_entries enable row level security;
revoke all on public.line_guide_entries from anon,authenticated;
grant all on public.line_guide_entries to service_role;
comment on table public.line_guide_entries is '站長核實的經典版指南；僅透過伺服器讀取已公開資料。';
commit;
