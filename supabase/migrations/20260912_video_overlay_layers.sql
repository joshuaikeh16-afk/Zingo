-- Timed multi-layer text overlays for the creator editor.
alter table public.posts
  add column if not exists overlay_layers jsonb not null default '[]'::jsonb;

alter table public.posts
  add column if not exists allow_download boolean not null default true;

alter table public.posts
  drop constraint if exists posts_overlay_layers_check;

alter table public.posts
  add constraint posts_overlay_layers_check check (
    jsonb_typeof(overlay_layers) = 'array'
    and jsonb_array_length(overlay_layers) <= 12
  );
