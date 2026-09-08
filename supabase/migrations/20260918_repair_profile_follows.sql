-- Repair migration for projects where the original social graph migration
-- was not applied even though the client already uses profile_follows.
create table if not exists public.profile_follows (
  follower_id uuid not null references auth.users(id) on delete cascade,
  following_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, following_id),
  check (follower_id <> following_id)
);

create index if not exists profile_follows_following_idx on public.profile_follows(following_id);
alter table public.profile_follows enable row level security;

drop policy if exists "Anyone can read public follows" on public.profile_follows;
create policy "Anyone can read public follows" on public.profile_follows
  for select to authenticated using (true);

drop policy if exists "Users manage their follows" on public.profile_follows;
create policy "Users manage their follows" on public.profile_follows
  for all to authenticated
  using (follower_id = auth.uid())
  with check (follower_id = auth.uid());
