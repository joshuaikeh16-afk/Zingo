-- Selected audio attribution for video posts.
alter table public.posts
  add column if not exists music_url text;

-- The `audio-search` Edge Function should proxy Freesound (or another
-- licensed catalog) and return: { tracks: [{ id, title, artist, source,
-- previewUrl }] }. Keep provider credentials in Edge Function secrets.
