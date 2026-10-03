-- Incremental migration for the existing Kaidra schema. Does not delete legacy data.
begin;
create index if not exists messages_conversation_created_id_idx on public.messages(conversation_id, created_at desc, id desc);
create index if not exists messages_unread_idx on public.messages(conversation_id, sender_id) where read_at is null;
create index if not exists conversation_participants_user_idx on public.conversation_participants(user_id, conversation_id);

create or replace function public.kaidra_is_conversation_member(target_conversation uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.conversation_participants where conversation_id = target_conversation and user_id = (select auth.uid()));
$$;
revoke all on function public.kaidra_is_conversation_member(uuid) from public;
grant execute on function public.kaidra_is_conversation_member(uuid) to authenticated;
create or replace function public.kaidra_can_send_message(target_conversation uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.kaidra_is_conversation_member(target_conversation) and not exists (
    select 1 from public.conversation_participants cp join public.user_preferences p on p.user_id = cp.user_id
    where cp.conversation_id = target_conversation and cp.user_id <> (select auth.uid()) and not p.allow_dms
  );
$$;
revoke all on function public.kaidra_can_send_message(uuid) from public;
grant execute on function public.kaidra_can_send_message(uuid) to authenticated;
alter table public.messages enable row level security;
drop policy if exists "Kaidra members read messages" on public.messages;
create policy "Kaidra members read messages" on public.messages for select to authenticated using (public.kaidra_is_conversation_member(conversation_id));
drop policy if exists "Kaidra restrict message visibility" on public.messages;
create policy "Kaidra restrict message visibility" on public.messages as restrictive for select to authenticated using (public.kaidra_is_conversation_member(conversation_id));
drop policy if exists "Kaidra members send messages" on public.messages;
create policy "Kaidra members send messages" on public.messages for insert to authenticated with check (sender_id = (select auth.uid()) and public.kaidra_can_send_message(conversation_id));
drop policy if exists "Kaidra restrict message authorship" on public.messages;
create policy "Kaidra restrict message authorship" on public.messages as restrictive for insert to authenticated with check (sender_id = (select auth.uid()) and public.kaidra_can_send_message(conversation_id));
drop policy if exists "Kaidra recipients read receipts" on public.messages;
create policy "Kaidra recipients read receipts" on public.messages for update to authenticated using (sender_id <> (select auth.uid()) and public.kaidra_is_conversation_member(conversation_id)) with check (sender_id <> (select auth.uid()) and public.kaidra_is_conversation_member(conversation_id));
-- A read receipt may never rewrite another participant's message.
create or replace function public.kaidra_guard_message_update()
returns trigger language plpgsql set search_path = '' as $$
begin
  if (select auth.role()) = 'authenticated' then
    if old.sender_id = (select auth.uid()) or not public.kaidra_is_conversation_member(old.conversation_id)
       or (to_jsonb(new) - 'read_at') is distinct from (to_jsonb(old) - 'read_at') then
      raise exception 'Only recipients may update a read receipt';
    end if;
    new.read_at = coalesce(old.read_at, now());
  end if;
  return new;
end;
$$;
drop trigger if exists kaidra_guard_message_update on public.messages;
create trigger kaidra_guard_message_update before update on public.messages for each row execute function public.kaidra_guard_message_update();

create table if not exists public.sports_alert_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  enabled boolean not null default false,
  news_enabled boolean not null default false,
  competition text not null default 'ALL' check (competition in ('ALL','PL','CL','PD','SA','BL1','FL1','WC')),
  updated_at timestamptz not null default now()
);
alter table public.sports_alert_settings enable row level security;
drop policy if exists "Own sports preferences" on public.sports_alert_settings;
create policy "Own sports preferences" on public.sports_alert_settings for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
grant select, insert, update, delete on public.sports_alert_settings to authenticated;

create table if not exists public.sports_events (
  event_key text primary key,
  title text not null,
  body text not null default '',
  url text not null default 'https://www.fifa.com/',
  competition text not null default 'ALL',
  kind text not null check (kind in ('kickoff','result','news','special')),
  starts_at timestamptz not null,
  notify_at timestamptz not null,
  delivered_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.sports_events enable row level security;
drop policy if exists "Read football events" on public.sports_events;
create policy "Read football events" on public.sports_events for select to authenticated using (true);
grant select on public.sports_events to authenticated;

create table if not exists public.app_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  event_key text not null references public.sports_events(event_key) on delete cascade,
  title text not null,
  body text not null default '',
  url text not null,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  unique(user_id, event_key)
);
create index if not exists app_notifications_user_created_idx on public.app_notifications(user_id, created_at desc);
alter table public.app_notifications enable row level security;
drop policy if exists "Own alerts" on public.app_notifications;
create policy "Own alerts" on public.app_notifications for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists "Read own alerts" on public.app_notifications;
create policy "Read own alerts" on public.app_notifications for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
grant select on public.app_notifications to authenticated;
revoke update on public.app_notifications from authenticated;
grant update(read_at) on public.app_notifications to authenticated;

-- Preserve delivery state when fixture dates/scores are refreshed.
create or replace function public.upsert_sports_events(items jsonb)
returns void language sql security definer set search_path = '' as $$
  insert into public.sports_events(event_key,title,body,url,competition,kind,starts_at,notify_at)
  select event_key,title,body,url,competition,kind,starts_at,notify_at
  from jsonb_to_recordset(items) as x(event_key text,title text,body text,url text,competition text,kind text,starts_at timestamptz,notify_at timestamptz)
  on conflict (event_key) do update set title=excluded.title,body=excluded.body,url=excluded.url,
    competition=excluded.competition,starts_at=excluded.starts_at,notify_at=excluded.notify_at;
$$;
revoke all on function public.upsert_sports_events(jsonb) from public, anon, authenticated;
grant execute on function public.upsert_sports_events(jsonb) to service_role;

create or replace function public.deliver_due_sports_notifications()
returns integer language plpgsql security definer set search_path = '' as $$
declare event_row public.sports_events; delivered integer := 0;
begin
  for event_row in select * from public.sports_events
    where delivered_at is null and notify_at <= now() and notify_at > now() - interval '1 hour'
    order by notify_at for update skip locked
  loop
    insert into public.app_notifications(user_id,event_key,title,body,url)
    select s.user_id,event_row.event_key,event_row.title,event_row.body,event_row.url
    from public.sports_alert_settings s where s.enabled
      and (event_row.kind <> 'news' or s.news_enabled)
      and (s.competition = 'ALL' or event_row.competition = 'ALL' or s.competition = event_row.competition)
    on conflict (user_id,event_key) do nothing;
    update public.sports_events set delivered_at = now() where event_key = event_row.event_key;
    delivered := delivered + 1;
  end loop;
  return delivered;
end;
$$;
revoke all on function public.deliver_due_sports_notifications() from public, anon, authenticated;
grant execute on function public.deliver_due_sports_notifications() to service_role;

create or replace function public.get_community_admin_dashboard()
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_current_user_admin() then raise exception 'Admin access required'; end if;
  return jsonb_build_object('users',(select count(*) from public.profiles),
    'conversations',(select count(distinct conversation_id) from public.conversation_participants),
    'messages',(select count(*) from public.messages),
    'events',(select count(*) from public.sports_events where kind = 'special' and starts_at > now()));
end;
$$;
revoke all on function public.get_community_admin_dashboard() from public;
grant execute on function public.get_community_admin_dashboard() to authenticated;

create or replace function public.publish_special_event(event_title text,event_body text,event_url text,event_start timestamptz,event_competition text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_current_user_admin() then raise exception 'Admin access required'; end if;
  if length(trim(event_title)) not between 1 and 120 or length(event_body) > 500 or event_start <= now()
    or event_competition not in ('ALL','PL','CL','PD','SA','BL1','FL1','WC')
    or event_url !~ '^https://(www\.)?(fifa\.com|plus\.fifa\.com|uefa\.com|uefa\.tv|premierleague\.com)(/|$)' then
    raise exception 'Use a future date, a valid title, and an official football source URL';
  end if;
  insert into public.sports_events(event_key,title,body,url,competition,kind,starts_at,notify_at)
  values ('special:' || gen_random_uuid()::text,trim(event_title),event_body,event_url,event_competition,'special',event_start,greatest(now(),event_start - interval '10 minutes'));
end;
$$;
revoke all on function public.publish_special_event(text,text,text,timestamptz,text) from public;
grant execute on function public.publish_special_event(text,text,text,timestamptz,text) to authenticated;

do $$
declare table_name text;
begin
  foreach table_name in array array['messages','friend_requests','app_notifications'] loop
    if not exists(select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = table_name) then
      execute format('alter publication supabase_realtime add table public.%I',table_name);
    end if;
  end loop;
end;
$$;
commit;
