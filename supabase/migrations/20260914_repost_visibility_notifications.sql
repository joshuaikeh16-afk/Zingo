-- Reposts can target friends, followers, or both, and notify the original creator.
alter table public.creator_notifications
  drop constraint if exists creator_notifications_notification_type_check;
alter table public.creator_notifications
  add constraint creator_notifications_notification_type_check
  check (notification_type in ('like', 'comment', 'comment_reply', 'repost'));

create or replace function public.create_creator_repost_notification()
returns trigger language plpgsql security definer set search_path = public as $$
declare owner_id uuid; actor_name text;
begin
  select user_id into owner_id from public.posts where id = new.post_id;
  if owner_id is null or owner_id = new.user_id then return new; end if;
  select coalesce(display_name, username, 'Someone') into actor_name from public.profiles where id = new.user_id;
  insert into public.creator_notifications(recipient_id, actor_id, post_id, notification_type, message)
  values (owner_id, new.user_id, new.post_id, 'repost', actor_name || ' reposted your video.');
  return new;
end $$;

drop trigger if exists video_reposts_creator_notification on public.video_reposts;
create trigger video_reposts_creator_notification after insert on public.video_reposts
for each row execute function public.create_creator_repost_notification();
