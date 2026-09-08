-- Creator editor metadata for video and image posts.
alter table public.posts
  add column if not exists media_type text not null default 'video',
  add column if not exists trim_start_seconds numeric,
  add column if not exists trim_end_seconds numeric,
  add column if not exists sticker text,
  add column if not exists filter_name text not null default 'none';

alter table public.posts
  drop constraint if exists posts_creator_editor_metadata_check;

alter table public.posts
  add constraint posts_creator_editor_metadata_check
  check (
    media_type in ('video', 'image')
    and (trim_start_seconds is null or trim_start_seconds >= 0)
    and (trim_end_seconds is null or trim_end_seconds >= 0)
    and (trim_end_seconds is null or trim_start_seconds is null or trim_end_seconds > trim_start_seconds)
    and (sticker is null or char_length(sticker) <= 8)
    and filter_name in ('none', 'soft', 'mono', 'vivid')
  );

update storage.buckets
set allowed_mime_types = array[
  'video/mp4', 'video/webm', 'video/quicktime',
  'image/jpeg', 'image/png', 'image/webp', 'image/gif'
]
where id = 'post-videos';
