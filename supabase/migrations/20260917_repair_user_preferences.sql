-- Keep deployed databases compatible with the settings UI.
alter table public.user_preferences
  add column if not exists allow_dms boolean not null default true,
  add column if not exists allow_nonfriend_dms boolean not null default false,
  add column if not exists allow_follower_dms boolean not null default false,
  add column if not exists public_watchlist boolean not null default true,
  add column if not exists nsfw_filter boolean not null default false,
  add column if not exists notify_dm boolean not null default true,
  add column if not exists notify_likes boolean not null default true,
  add column if not exists notify_comments boolean not null default true;
