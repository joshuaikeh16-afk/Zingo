-- Persistent engagement for 24-hour video posts.
create table if not exists public.video_saves (
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create table if not exists public.video_shares (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  destination text not null default 'native',
  created_at timestamptz not null default now()
);

create index if not exists video_shares_user_created_idx on public.video_shares(user_id, created_at desc);

alter table public.video_saves enable row level security;
alter table public.video_shares enable row level security;

drop policy if exists "Users manage their own video saves" on public.video_saves;
create policy "Users manage their own video saves" on public.video_saves
for all to authenticated using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

drop policy if exists "Users record their own video shares" on public.video_shares;
create policy "Users record their own video shares" on public.video_shares
for insert to authenticated with check (user_id = (select auth.uid()));

drop policy if exists "Users read their own video shares" on public.video_shares;
create policy "Users read their own video shares" on public.video_shares
for select to authenticated using (user_id = (select auth.uid()));

-- post_likes and post_comments already back likes/comments in this project.
-- Ensure a user can manage only their own engagement records.
alter table public.post_likes enable row level security;
alter table public.post_comments enable row level security;

drop policy if exists "Users manage their own post likes" on public.post_likes;
create policy "Users manage their own post likes" on public.post_likes
for all to authenticated using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

drop policy if exists "Authenticated users read post likes" on public.post_likes;
create policy "Authenticated users read post likes" on public.post_likes
for select to authenticated using (true);

drop policy if exists "Authenticated users read post comments" on public.post_comments;
create policy "Authenticated users read post comments" on public.post_comments
for select to authenticated using (true);

drop policy if exists "Users manage their own post comments" on public.post_comments;
create policy "Users manage their own post comments" on public.post_comments
for all to authenticated using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));
