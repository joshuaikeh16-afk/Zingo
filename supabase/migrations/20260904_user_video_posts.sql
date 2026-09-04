-- Kaidra: private, friend-visible 24-hour video posts.
-- Run through the Supabase SQL editor or `supabase db push` before deploying
-- the corresponding browser code.

alter table public.posts
  add column if not exists media_duration_seconds integer;

alter table public.posts
  drop constraint if exists posts_media_duration_seconds_check;

alter table public.posts
  add constraint posts_media_duration_seconds_check
  check (media_duration_seconds is null or media_duration_seconds between 1 and 180);

-- Existing status-post installations normally already have this permission;
-- this makes video posting work in installations where it was omitted.
drop policy if exists "Users insert their own posts" on public.posts;
create policy "Users insert their own posts"
on public.posts for insert to authenticated
with check (user_id = (select auth.uid()));

drop policy if exists "Users delete their own video posts" on public.posts;
create policy "Users delete their own video posts"
on public.posts for delete to authenticated
using (user_id = (select auth.uid()) and post_type = 'video');

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'post-videos',
  'post-videos',
  false,
  104857600,
  array['video/mp4', 'video/webm', 'video/quicktime']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Video authors upload their files" on storage.objects;
create policy "Video authors upload their files"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'post-videos'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

drop policy if exists "Video authors update their files" on storage.objects;
create policy "Video authors update their files"
on storage.objects for update to authenticated
using (
  bucket_id = 'post-videos'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
)
with check (
  bucket_id = 'post-videos'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

drop policy if exists "Video authors delete their files" on storage.objects;
create policy "Video authors delete their files"
on storage.objects for delete to authenticated
using (
  bucket_id = 'post-videos'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

-- An object can be signed/read only by its author or an accepted friend,
-- while its matching post remains within the 24-hour lifetime.
drop policy if exists "Authors and friends read active videos" on storage.objects;
create policy "Authors and friends read active videos"
on storage.objects for select to authenticated
using (
  bucket_id = 'post-videos'
  and exists (
    select 1
    from public.posts p
    where p.post_type = 'video'
      and p.media_url = storage.objects.name
      and p.expires_at > now()
      and (
        p.user_id = (select auth.uid())
        or exists (
          select 1
          from public.friend_requests fr
          where fr.status = 'accepted'
            and (
              (fr.requester_id = p.user_id and fr.target_id = (select auth.uid()))
              or (fr.target_id = p.user_id and fr.requester_id = (select auth.uid()))
            )
        )
      )
  )
);
