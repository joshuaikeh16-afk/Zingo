-- Public follower graph and creator profile management.
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
create policy "Anyone can read public follows" on public.profile_follows for select to authenticated using (true);
drop policy if exists "Users manage their follows" on public.profile_follows;
create policy "Users manage their follows" on public.profile_follows for all to authenticated using (follower_id = auth.uid()) with check (follower_id = auth.uid());

create table if not exists public.video_reposts (
  user_id uuid not null references auth.users(id) on delete cascade,
  post_id uuid not null references public.posts(id) on delete cascade,
  visibility text not null default 'friends' check (visibility in ('friends', 'followers', 'both')),
  created_at timestamptz not null default now(),
  primary key (user_id, post_id)
);
alter table public.video_reposts add column if not exists visibility text not null default 'friends';
alter table public.video_reposts drop constraint if exists video_reposts_visibility_check;
alter table public.video_reposts add constraint video_reposts_visibility_check check (visibility in ('friends', 'followers', 'both'));
alter table public.video_reposts enable row level security;
drop policy if exists "Reposts are publicly readable" on public.video_reposts;
create policy "Reposts are publicly readable" on public.video_reposts for select to authenticated using (true);
drop policy if exists "Users manage their reposts" on public.video_reposts;
create policy "Users manage their reposts" on public.video_reposts for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create table if not exists public.video_pins (
  user_id uuid not null references auth.users(id) on delete cascade,
  post_id uuid not null references public.posts(id) on delete cascade,
  pin_order integer not null check (pin_order between 1 and 3),
  created_at timestamptz not null default now(),
  primary key (user_id, post_id),
  unique (user_id, pin_order)
);
alter table public.video_pins enable row level security;
drop policy if exists "Pins are publicly readable" on public.video_pins;
create policy "Pins are publicly readable" on public.video_pins for select to authenticated using (true);
drop policy if exists "Creators manage their pins" on public.video_pins;
create policy "Creators manage their pins" on public.video_pins for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
