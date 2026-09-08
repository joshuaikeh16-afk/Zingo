-- TikTok-style creative metadata for short-form video posts.
alter table public.posts
  add column if not exists overlay_text text,
  add column if not exists music_title text,
  add column if not exists music_artist text,
  add column if not exists tags text[] not null default '{}';

alter table public.posts
  drop constraint if exists posts_video_creative_metadata_check;

alter table public.posts
  add constraint posts_video_creative_metadata_check
  check (
    (overlay_text is null or char_length(overlay_text) <= 90)
    and (music_title is null or char_length(music_title) <= 80)
    and (music_artist is null or char_length(music_artist) <= 80)
    and coalesce(array_length(tags, 1), 0) <= 8
  );
