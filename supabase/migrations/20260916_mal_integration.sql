-- MyAnimeList catalog IDs and optional private OAuth connection.
-- Social data remains in the existing Kaidra tables.

alter table public.user_watchlist
  add column if not exists media_type text not null default 'anime',
  add column if not exists mal_id bigint,
  add column if not exists title text,
  add column if not exists cover_url text,
  add column if not exists score numeric,
  add column if not exists start_date date,
  add column if not exists finish_date date,
  add column if not exists tags text[] not null default '{}',
  add column if not exists notes text,
  add column if not exists times_rewatched integer not null default 0,
  add column if not exists is_rewatching boolean not null default false;

alter table public.user_watchlist
  drop constraint if exists user_watchlist_status_check;

alter table public.user_watchlist
  add constraint user_watchlist_status_check
  check (status in ('watching', 'completed', 'on_hold', 'dropped', 'plan_to_watch', 'planned', 'favourite', 'worst'));

update public.user_watchlist
set mal_id = anime_id
where mal_id is null;

create index if not exists user_watchlist_mal_id_idx
  on public.user_watchlist (user_id, media_type, mal_id);

create table if not exists public.mal_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  mal_user_id bigint,
  mal_username text,
  access_token text not null,
  refresh_token text,
  expires_at timestamptz,
  scope text,
  updated_at timestamptz not null default now()
);

alter table public.mal_connections enable row level security;

-- OAuth tokens are server-only. The Edge Function uses the service role to
-- read them; the browser receives connection status without the token.
drop policy if exists "Users can read their MAL connection" on public.mal_connections;

drop policy if exists "Users can create their MAL connection" on public.mal_connections;
create policy "Users can create their MAL connection"
  on public.mal_connections for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update their MAL connection" on public.mal_connections;
create policy "Users can update their MAL connection"
  on public.mal_connections for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete their MAL connection" on public.mal_connections;
create policy "Users can delete their MAL connection"
  on public.mal_connections for delete
  using (auth.uid() = user_id);
