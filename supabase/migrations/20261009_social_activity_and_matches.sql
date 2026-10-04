begin;
-- Extend existing notifications without losing their football-event lifecycle.
alter table public.app_notifications add column category text not null default 'football' check(category in('football','social','battle','relationship','friend')),
 add column payload jsonb not null default '{}' check(jsonb_typeof(payload)='object' and octet_length(payload::text)<20000),
 add column dismissed_at timestamptz, add column sports_event_key text references public.sports_events(event_key) on delete cascade;
update public.app_notifications set sports_event_key=event_key;
do $$ declare name text;begin for name in select conname from pg_constraint where conrelid='public.app_notifications'::regclass and confrelid='public.sports_events'::regclass and conkey=array[(select attnum from pg_attribute where attrelid='public.app_notifications'::regclass and attname='event_key')] loop execute format('alter table public.app_notifications drop constraint %I',name);end loop;end $$;
grant update(dismissed_at) on public.app_notifications to authenticated;
create table public.social_preferences(user_id uuid primary key references auth.users(id) on delete cascade,
 activity_visibility text not null default 'private' check(activity_visibility in('private','friends','public')),
 notifications jsonb not null default '{"social":true,"battle":true,"relationship":true,"friend":true,"football":true}' check(jsonb_typeof(notifications)='object'),updated_at timestamptz not null default now());
create table public.user_blocks(user_id uuid references auth.users(id) on delete cascade,blocked_user uuid references auth.users(id) on delete cascade,created_at timestamptz not null default now(),primary key(user_id,blocked_user),check(user_id<>blocked_user));
create index user_blocks_target_idx on public.user_blocks(blocked_user);
create table public.social_signals(user_id uuid primary key references auth.users(id) on delete cascade,revision bigint not null default 1,updated_at timestamptz not null default clock_timestamp());
create function public.kaidra_social_signal(target uuid) returns void language sql security definer set search_path='' as $$
 insert into public.social_signals(user_id) values(target) on conflict(user_id) do update set revision=social_signals.revision+1,updated_at=clock_timestamp();
$$;
create function public.kaidra_pair_allowed(a uuid,b uuid) returns boolean language sql stable security definer set search_path='' as $$
 select a is not null and b is not null and a<>b and not exists(select 1 from public.user_blocks where (user_id=a and blocked_user=b) or(user_id=b and blocked_user=a)) and not exists(select 1 from public.profiles where id in(a,b) and is_banned);
$$;
create function public.kaidra_friends(a uuid,b uuid) returns boolean language sql stable security definer set search_path='' as $$
 select public.kaidra_pair_allowed(a,b) and exists(select 1 from public.friend_requests where status='accepted' and ((requester_id=a and target_id=b) or(requester_id=b and target_id=a)));
$$;
create function public.kaidra_contact_allowed(target_user uuid) returns boolean language sql stable security definer set search_path='' as $$
 select public.kaidra_pair_allowed(auth.uid(),target_user);
$$;
create function public.kaidra_activity_visible(owner_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid()=owner_id or (public.kaidra_pair_allowed(auth.uid(),owner_id) and exists(select 1 from public.social_preferences where user_id=owner_id and (activity_visibility='public' or(activity_visibility='friends' and public.kaidra_friends(auth.uid(),owner_id)))));
$$;
create function public.kaidra_notify(recipient uuid,kind text,key text,heading text,body text,route text,details jsonb default '{}') returns void language plpgsql security definer set search_path='' as $$
begin
 if coalesce((select (notifications->>kind)::boolean from public.social_preferences where user_id=recipient),true) then
 insert into public.app_notifications(user_id,event_key,category,title,body,url,payload) values(recipient,key,kind,heading,body,route,details) on conflict(user_id,event_key) do nothing;
 end if;
end $$;
create function public.kaidra_notification_compat() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.category='football' then
  if not coalesce((select (notifications->>'football')::boolean from public.social_preferences where user_id=new.user_id),true) then return null;end if;
  if exists(select 1 from public.sports_events where event_key=new.event_key) then new.sports_event_key:=new.event_key;end if;
 end if;return new;
end $$;
create trigger kaidra_notification_compat before insert on public.app_notifications for each row execute function public.kaidra_notification_compat();
create function public.kaidra_social_settings(visibility text,notifications jsonb) returns void language plpgsql security definer set search_path='' as $$
declare key text; value jsonb; old_visibility text;begin
 if auth.uid() is null or visibility not in('private','friends','public') or jsonb_typeof(notifications)<>'object' then raise exception 'Invalid preferences';end if;
 for key,value in select * from jsonb_each(notifications) loop if key not in('social','battle','relationship','friend','football') or jsonb_typeof(value)<>'boolean' then raise exception 'Invalid notification preference';end if;end loop;
 select activity_visibility into old_visibility from public.social_preferences where user_id=auth.uid();
 insert into public.social_preferences(user_id,activity_visibility,notifications) values(auth.uid(),visibility,'{"social":true,"battle":true,"relationship":true,"friend":true,"football":true}'::jsonb||notifications)
 on conflict(user_id) do update set activity_visibility=excluded.activity_visibility,notifications=excluded.notifications,updated_at=now();
 perform public.kaidra_social_signal(auth.uid());
 -- Friends receive only an invalidation, never a private title or support choice.
 perform public.kaidra_social_signal(case when requester_id=auth.uid() then target_id else requester_id end) from public.friend_requests where status='accepted' and auth.uid() in(requester_id,target_id);
end $$;
create function public.kaidra_block(target_user uuid,blocked boolean) returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or target_user=auth.uid() or not exists(select 1 from public.profiles where id=target_user) then raise exception 'Invalid person';end if;
 if blocked then insert into public.user_blocks values(auth.uid(),target_user,now()) on conflict do nothing;else delete from public.user_blocks where user_id=auth.uid() and blocked_user=target_user;end if;
 perform public.kaidra_social_signal(auth.uid());perform public.kaidra_social_signal(target_user);
end $$;
create function public.kaidra_friend_mutation_guard() returns trigger language plpgsql set search_path='' as $$
begin
 if current_user='authenticated' then
  if not public.kaidra_contact_allowed(case when new.requester_id=auth.uid() then new.target_id else new.requester_id end) then raise exception 'This connection is unavailable';end if;
  if tg_op='INSERT' then if new.requester_id<>auth.uid() or new.status<>'pending' then raise exception 'Send a pending friend request';end if;
  else
   if new.requester_id<>old.requester_id or new.target_id<>old.target_id or new.id<>old.id or new.created_at<>old.created_at then raise exception 'Friend request identity cannot change';end if;
   if new.status is distinct from old.status and not(old.status='pending' and ((auth.uid()=old.target_id and new.status in('accepted','declined')) or(auth.uid()=old.requester_id and new.status='cancelled'))) then raise exception 'Only the recipient can accept or decline';end if;
  end if;
 end if;return new;
end $$;
create trigger kaidra_friend_mutation_guard before insert or update on public.friend_requests for each row execute function public.kaidra_friend_mutation_guard();
create function public.kaidra_friend_accepted() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.status='accepted' and old.status='pending' then perform public.kaidra_notify(new.requester_id,'friend','friend:'||new.id,'You’re connected','Your friend request was accepted.','user/'||new.target_id,jsonb_build_object('user_id',new.target_id));end if;return null;
end $$;
create trigger kaidra_friend_accepted after update on public.friend_requests for each row execute function public.kaidra_friend_accepted();
create function public.kaidra_dm_block_guard() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.message_type<>'system' and exists(select 1 from public.conversations where id=new.conversation_id and not is_group) and exists(select 1 from public.conversation_participants where conversation_id=new.conversation_id and user_id<>new.sender_id and not public.kaidra_pair_allowed(new.sender_id,user_id)) then raise exception 'This conversation is unavailable';end if;return new;
end $$;
create trigger kaidra_dm_block_guard before insert on public.messages for each row execute function public.kaidra_dm_block_guard();
create table public.content_reports(id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,conversation_id uuid not null references public.conversations(id) on delete cascade,message_id uuid references public.messages(id) on delete set null,reason text not null check(length(reason) between 1 and 500),created_at timestamptz not null default now());
create function public.kaidra_report(target_message uuid,reason text) returns void language plpgsql security definer set search_path='' as $$
declare cid uuid;begin
 select conversation_id into cid from public.messages where id=target_message;
 if not public.kaidra_is_conversation_member(cid) or length(trim(reason)) not between 1 and 500 then raise exception 'Invalid report';end if;
 if (select count(*) from public.content_reports where user_id=auth.uid() and created_at>now()-interval '1 hour')>=10 then raise exception 'Please wait before sending more reports';end if;
 insert into public.content_reports(user_id,conversation_id,message_id,reason) values(auth.uid(),cid,target_message,trim(reason));
end $$;
-- The existing library stays owner-only. Friend context is aggregated by authorized RPCs.
create table public.social_recommendations(user_id uuid references auth.users(id) on delete cascade,provider text,media_type text,external_id text,item jsonb not null,friend_count integer not null check(friend_count>=3),state text not null default 'surfaced' check(state in('surfaced','dismissed','not_interested')),created_at timestamptz not null default now(),primary key(user_id,provider,media_type,external_id));
create index user_watchlist_social_idx on public.user_watchlist(provider,media_type,external_id,user_id) where is_favorite or is_watchlisted;
create function public.kaidra_social_recommendations() returns jsonb language plpgsql security definer set search_path='' as $$
declare count_friends integer;candidate record;inserted integer;begin
 if auth.uid() is null then raise exception 'Sign in required';end if;
 perform pg_advisory_xact_lock(hashtextextended('kaidra:recommendations:'||auth.uid(),0));
 select count(distinct case when requester_id=auth.uid() then target_id else requester_id end) into count_friends from public.friend_requests where status='accepted' and auth.uid() in(requester_id,target_id) and public.kaidra_friends(requester_id,target_id);
 if count_friends>=3 then
 for candidate in
 select w.provider,w.media_type,w.external_id,max(w.snapshot::text)::jsonb as item,count(distinct w.user_id)::integer as friend_count from public.user_watchlist w
 where (w.is_favorite or w.is_watchlisted) and public.kaidra_friends(auth.uid(),w.user_id) and public.kaidra_activity_visible(w.user_id)
 and not exists(select 1 from public.user_watchlist mine where mine.user_id=auth.uid() and mine.provider=w.provider and mine.media_type=w.media_type and mine.external_id=w.external_id and (mine.is_favorite or mine.is_watchlisted or mine.status in('completed','watching','dropped')))
 and not exists(select 1 from public.social_recommendations s where s.user_id=auth.uid() and s.provider=w.provider and s.media_type=w.media_type and s.external_id=w.external_id)
 group by w.provider,w.media_type,w.external_id having count(distinct w.user_id)>=greatest(3,ceil(count_friends*.25)) order by count(distinct w.user_id) desc limit 5
 loop
 insert into public.social_recommendations values(auth.uid(),candidate.provider,candidate.media_type,candidate.external_id,candidate.item,candidate.friend_count,'surfaced',now()) on conflict do nothing;get diagnostics inserted=row_count;
 if inserted=1 and not exists(select 1 from public.app_notifications where user_id=auth.uid() and category='social' and created_at>now()-interval '1 day') then perform public.kaidra_notify(auth.uid(),'social','social:'||candidate.provider||':'||candidate.media_type||':'||candidate.external_id,'Your friends are onto something 👀',candidate.friend_count||' friends saved '||coalesce(candidate.item->>'title','this title'),case when candidate.provider='mal' then 'title/mal-' else 'title/' end||candidate.media_type||'/'||candidate.external_id,jsonb_build_object('item',candidate.item||jsonb_build_object('provider',candidate.provider,'kind',candidate.media_type,'id',candidate.external_id)));end if;
 end loop;
 end if;
 -- Recompute visible counts on every read, so changed privacy cannot leak stale counts.
 return coalesce((select jsonb_agg(entry) from(select jsonb_build_object('item',s.item||jsonb_build_object('provider',s.provider,'kind',s.media_type,'id',s.external_id),'friend_count',visible.n,'state',s.state) entry from public.social_recommendations s
 cross join lateral(select count(distinct w.user_id)::integer n from public.user_watchlist w where w.provider=s.provider and w.media_type=s.media_type and w.external_id=s.external_id and (w.is_favorite or w.is_watchlisted) and public.kaidra_friends(auth.uid(),w.user_id) and public.kaidra_activity_visible(w.user_id))visible
 where s.user_id=auth.uid() and s.state='surfaced' and visible.n>=greatest(3,ceil(count_friends*.25)) and not exists(select 1 from public.user_watchlist mine where mine.user_id=auth.uid() and mine.provider=s.provider and mine.media_type=s.media_type and mine.external_id=s.external_id and (mine.is_favorite or mine.is_watchlisted or mine.status in('completed','watching','dropped'))) order by s.created_at desc limit 10)rows),'[]'::jsonb);
end $$;
create function public.kaidra_social_dismiss(provider text,media_type text,external_id text,not_interested boolean default true) returns void language plpgsql security definer set search_path='' as $$
begin update public.social_recommendations s set state=case when not_interested then 'not_interested' else 'dismissed' end where s.user_id=auth.uid() and s.provider=kaidra_social_dismiss.provider and s.media_type=kaidra_social_dismiss.media_type and s.external_id=kaidra_social_dismiss.external_id;
 update public.app_notifications n set dismissed_at=now(),read_at=coalesce(read_at,now()) where user_id=auth.uid() and event_key='social:'||provider||':'||media_type||':'||external_id;end $$;
create function public.kaidra_title_social(provider text,media_type text,external_id text) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('count',count(*),'friends',coalesce(jsonb_agg(jsonb_build_object('id',p.id,'display_name',p.display_name,'username',p.username,'avatar_url',p.avatar_url,'completed',w.status='completed')),'[]'::jsonb)) from public.user_watchlist w join public.profiles p on p.id=w.user_id where w.provider=kaidra_title_social.provider and w.media_type=kaidra_title_social.media_type and w.external_id=kaidra_title_social.external_id and (w.is_favorite or w.is_watchlisted or w.status='completed') and public.kaidra_friends(auth.uid(),w.user_id) and public.kaidra_activity_visible(w.user_id);
$$;
create function public.kaidra_library_activity_signal() returns trigger language plpgsql security definer set search_path='' as $$
declare actor uuid;begin actor:=case when tg_op='DELETE' then old.user_id else new.user_id end;perform public.kaidra_social_signal(actor);
 perform public.kaidra_social_signal(case when requester_id=actor then target_id else requester_id end) from public.friend_requests where status='accepted' and actor in(requester_id,target_id);return null;end $$;
create trigger kaidra_library_activity_signal after insert or update or delete on public.user_watchlist for each row execute function public.kaidra_library_activity_signal();
create table public.provider_matches(match_id bigint primary key,home_id bigint not null,away_id bigint not null,status text not null,snapshot jsonb not null,verified_at timestamptz not null default now(),locked_at timestamptz,check(home_id<>away_id));
create table public.match_support(match_id bigint references public.provider_matches(match_id) on delete cascade,user_id uuid references auth.users(id) on delete cascade,side text not null check(side in('home','away','neutral')),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),primary key(match_id,user_id));
create index match_support_user_idx on public.match_support(user_id,match_id);
create function public.kaidra_match_ingest(snapshot jsonb) returns void language plpgsql security definer set search_path='' as $$
begin
 if jsonb_typeof(snapshot)<>'object' or snapshot->>'id' !~ '^\d+$' or snapshot->>'homeId' !~ '^\d+$' or snapshot->>'awayId' !~ '^\d+$' or snapshot->>'status' not in('SCHEDULED','TIMED','IN_PLAY','PAUSED','EXTRA_TIME','PENALTY_SHOOTOUT','FINISHED','AWARDED','POSTPONED','CANCELLED','SUSPENDED') then raise exception 'Invalid provider snapshot';end if;
 insert into public.provider_matches(match_id,home_id,away_id,status,snapshot,locked_at) values((snapshot->>'id')::bigint,(snapshot->>'homeId')::bigint,(snapshot->>'awayId')::bigint,snapshot->>'status',snapshot,case when snapshot->>'status' in('FINISHED','AWARDED','CANCELLED') then now() end)
 on conflict(match_id) do update set status=excluded.status,snapshot=excluded.snapshot,verified_at=now(),locked_at=coalesce(provider_matches.locked_at,excluded.locked_at);
end $$;
create function public.kaidra_match_support(target_match bigint,side text) returns void language plpgsql security definer set search_path='' as $$
declare game public.provider_matches;begin
 if auth.uid() is null or side not in('home','away','neutral') then raise exception 'Choose a side';end if;
 select * into game from public.provider_matches where match_id=target_match for update;
 if not found or game.verified_at<now()-interval '2 minutes' then raise exception 'Refresh the match before choosing support';end if;
 if game.locked_at is not null then raise exception 'Support is locked after the final whistle';end if;
 insert into public.match_support(match_id,user_id,side) values(target_match,auth.uid(),side) on conflict(match_id,user_id) do update set side=excluded.side,updated_at=now();
 perform public.kaidra_social_signal(auth.uid());perform public.kaidra_social_signal(case when requester_id=auth.uid() then target_id else requester_id end) from public.friend_requests where status='accepted' and auth.uid() in(requester_id,target_id);
end $$;
create function public.kaidra_match_social(target_match bigint) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('own_support',(select side from public.match_support where match_id=target_match and user_id=auth.uid()),'locked',coalesce((select locked_at is not null from public.provider_matches where match_id=target_match),true),'friends',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'display_name',p.display_name,'avatar_url',p.avatar_url,'side',s.side)) from public.match_support s join public.profiles p on p.id=s.user_id where s.match_id=target_match and public.kaidra_friends(auth.uid(),s.user_id) and public.kaidra_activity_visible(s.user_id)),'[]'::jsonb));
$$;
do $$ declare t text;begin foreach t in array array['social_preferences','user_blocks','social_signals','content_reports','social_recommendations','provider_matches','match_support'] loop execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from anon,authenticated',t);execute format('grant select on public.%I to authenticated',t);end loop;end $$;
create policy "Own social preferences" on public.social_preferences for select to authenticated using(user_id=auth.uid());
create policy "Own blocks" on public.user_blocks for select to authenticated using(user_id=auth.uid());
create policy "Own social invalidations" on public.social_signals for select to authenticated using(user_id=auth.uid());
create policy "Own reports" on public.content_reports for select to authenticated using(user_id=auth.uid());
create policy "Own recommendation decisions" on public.social_recommendations for select to authenticated using(user_id=auth.uid());
create policy "Public provider metadata" on public.provider_matches for select to authenticated using(true);
create policy "Visible match support" on public.match_support for select to authenticated using(public.kaidra_activity_visible(user_id));
do $$ declare signature text;begin
 foreach signature in array array['kaidra_social_signal(uuid)','kaidra_pair_allowed(uuid,uuid)','kaidra_friends(uuid,uuid)','kaidra_contact_allowed(uuid)','kaidra_activity_visible(uuid)','kaidra_notify(uuid,text,text,text,text,text,jsonb)','kaidra_social_settings(text,jsonb)','kaidra_block(uuid,boolean)','kaidra_report(uuid,text)','kaidra_social_recommendations()','kaidra_social_dismiss(text,text,text,boolean)','kaidra_title_social(text,text,text)','kaidra_match_ingest(jsonb)','kaidra_match_support(bigint,text)','kaidra_match_social(bigint)'] loop execute 'revoke all on function public.'||signature||' from public,anon,authenticated';end loop;
 foreach signature in array array['kaidra_contact_allowed(uuid)','kaidra_activity_visible(uuid)','kaidra_social_settings(text,jsonb)','kaidra_block(uuid,boolean)','kaidra_report(uuid,text)','kaidra_social_recommendations()','kaidra_social_dismiss(text,text,text,boolean)','kaidra_title_social(text,text,text)','kaidra_match_support(bigint,text)','kaidra_match_social(bigint)'] loop execute 'grant execute on function public.'||signature||' to authenticated';end loop;
end $$;
grant execute on function public.kaidra_match_ingest(jsonb) to service_role;
alter publication supabase_realtime add table public.social_signals,public.match_support;
create or replace function public.kaidra_react(target_message uuid, reaction text)
returns void language plpgsql security definer set search_path = '' as $$
declare conversation uuid; existing_id uuid;
begin
  select conversation_id into conversation from public.messages where id=target_message;
  if not public.kaidra_is_conversation_member(conversation) then raise exception 'Membership required'; end if;
  if exists(select 1 from public.conversations c join public.conversation_participants cp on cp.conversation_id=c.id where c.id=conversation and not c.is_group and cp.user_id<>auth.uid() and not public.kaidra_pair_allowed(auth.uid(),cp.user_id)) then raise exception 'This conversation is unavailable';end if;
  if reaction is null or reaction not in ('❤️','😂','🔥','😮','👏','⚽','👍','👎') then raise exception 'Invalid reaction'; end if;
  perform pg_advisory_xact_lock(hashtextextended(target_message::text||':'||auth.uid()::text,0));
  if exists(select 1 from public.message_reactions where message_id=target_message and user_id=auth.uid() and emoji=reaction) then
    update public.message_reactions set emoji=null where message_id=target_message and user_id=auth.uid();
  else
    update public.message_reactions set emoji=null where message_id=target_message and user_id=auth.uid();
    select id into existing_id from public.message_reactions where message_id=target_message and user_id=auth.uid() order by id limit 1;
    if existing_id is not null then
      update public.message_reactions set emoji=reaction where id=existing_id;
    else
      insert into public.message_reactions(message_id,conversation_id,user_id,emoji) values(target_message,conversation,auth.uid(),reaction);
    end if;
  end if;
end;
$$;

notify pgrst,'reload schema';
commit;
