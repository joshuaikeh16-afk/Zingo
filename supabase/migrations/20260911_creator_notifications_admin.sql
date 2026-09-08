-- Creator notifications and a server-checked admin dashboard foundation.
-- Apply this migration before opening the new Inbox activity card.

create table if not exists public.creator_notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references auth.users(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  post_id uuid references public.posts(id) on delete cascade,
  notification_type text not null check (notification_type in ('like', 'comment', 'comment_reply')),
  message text not null,
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create index if not exists creator_notifications_recipient_idx
  on public.creator_notifications(recipient_id, created_at desc);

alter table public.creator_notifications enable row level security;
drop policy if exists "Users read their creator notifications" on public.creator_notifications;
create policy "Users read their creator notifications" on public.creator_notifications
for select to authenticated using (recipient_id = (select auth.uid()));
drop policy if exists "Users mark their creator notifications read" on public.creator_notifications;
create policy "Users mark their creator notifications read" on public.creator_notifications
for update to authenticated using (recipient_id = (select auth.uid()))
with check (recipient_id = (select auth.uid()));

create or replace function public.create_creator_like_notification()
returns trigger language plpgsql security definer set search_path = public as $$
declare owner_id uuid; actor_name text;
begin
  select user_id into owner_id from public.posts where id = new.post_id;
  if owner_id is null or owner_id = new.user_id then return new; end if;
  select coalesce(display_name, username, 'Someone') into actor_name from public.profiles where id = new.user_id;
  insert into public.creator_notifications(recipient_id, actor_id, post_id, notification_type, message)
  values (owner_id, new.user_id, new.post_id, 'like', actor_name || ' liked your video.');
  return new;
end $$;

create or replace function public.create_creator_comment_notifications()
returns trigger language plpgsql security definer set search_path = public as $$
declare owner_id uuid; actor_name text;
begin
  select user_id into owner_id from public.posts where id = new.post_id;
  select coalesce(display_name, username, 'Someone') into actor_name from public.profiles where id = new.user_id;
  if owner_id is not null and owner_id <> new.user_id then
    insert into public.creator_notifications(recipient_id, actor_id, post_id, notification_type, message)
    values (owner_id, new.user_id, new.post_id, 'comment', actor_name || ' commented on your video.');
  end if;
  insert into public.creator_notifications(recipient_id, actor_id, post_id, notification_type, message)
  select distinct c.user_id, new.user_id, new.post_id, 'comment_reply', actor_name || ' joined the conversation on a video you commented on.'
  from public.post_comments c
  where c.post_id = new.post_id
    and c.user_id <> new.user_id
    and c.user_id <> coalesce(owner_id, new.user_id)
    and not exists (
      select 1 from public.creator_notifications n
      where n.recipient_id = c.user_id and n.actor_id = new.user_id
        and n.post_id = new.post_id and n.created_at > now() - interval '1 minute'
    );
  return new;
end $$;

drop trigger if exists post_likes_creator_notification on public.post_likes;
create trigger post_likes_creator_notification after insert on public.post_likes
for each row execute function public.create_creator_like_notification();
drop trigger if exists post_comments_creator_notification on public.post_comments;
create trigger post_comments_creator_notification after insert on public.post_comments
for each row execute function public.create_creator_comment_notifications();

do $$ begin
  alter publication supabase_realtime add table public.creator_notifications;
exception when duplicate_object then null;
end $$;

create table if not exists public.admin_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'admin' check (role in ('admin', 'moderator')),
  created_at timestamptz not null default now()
);
alter table public.admin_roles enable row level security;

create or replace function public.is_current_user_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admin_roles where user_id = auth.uid());
$$;

create or replace function public.get_admin_dashboard()
returns json language plpgsql security definer set search_path = public as $$
declare result json;
begin
  if not public.is_current_user_admin() then raise exception 'admin access required'; end if;
  select json_build_object(
    'users', (select count(*) from public.profiles),
    'posts', (select count(*) from public.posts where post_type = 'video'),
    'comments', (select count(*) from public.post_comments),
    'likes', (select count(*) from public.post_likes),
    'recent_comments', coalesce((select json_agg(row_to_json(x)) from (
      select c.id, c.content, c.created_at, c.post_id, p.username
      from public.post_comments c left join public.profiles p on p.id = c.user_id
      order by c.created_at desc limit 25
    ) x), '[]'::json)
  ) into result;
  return result;
end $$;
