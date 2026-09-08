-- Keep post engagement tied to the post itself.
-- This covers video likes/comments (and is also correct for other post types
-- that use these shared engagement tables).

-- Remove rows that already point at deleted posts so the constraints below
-- can be added cleanly to existing installations.
delete from public.post_likes l
where not exists (
  select 1
  from public.posts p
  where p.id = l.post_id
);

delete from public.post_comments c
where not exists (
  select 1
  from public.posts p
  where p.id = c.post_id
);

-- These constraints may already exist in an older installation without
-- ON DELETE CASCADE. Replace them so the migration works in both cases.
alter table public.post_likes
  drop constraint if exists post_likes_post_id_fkey;

alter table public.post_comments
  drop constraint if exists post_comments_post_id_fkey;

alter table public.post_likes
  add constraint post_likes_post_id_fkey
  foreign key (post_id) references public.posts(id) on delete cascade;

alter table public.post_comments
  add constraint post_comments_post_id_fkey
  foreign key (post_id) references public.posts(id) on delete cascade;
