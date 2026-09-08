alter table public.user_preferences add column if not exists allow_nonfriend_dms boolean not null default false;
alter table public.user_preferences add column if not exists allow_follower_dms boolean not null default false;
alter table public.user_preferences add column if not exists notify_likes boolean not null default true;
alter table public.user_preferences add column if not exists notify_comments boolean not null default true;
