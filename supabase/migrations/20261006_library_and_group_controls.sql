begin;
-- Extend the existing collection rather than replacing users' historical saves.
alter table public.user_watchlist alter column anime_id drop not null;
alter table public.user_watchlist add column provider text not null default 'mal', add column external_id text,
 add column is_favorite boolean not null default false, add column is_watchlisted boolean not null default true,
 add column snapshot jsonb not null default '{}';
update public.user_watchlist set external_id=coalesce(mal_id,anime_id)::text, is_favorite=status='favourite', is_watchlisted=status<>'favourite';
alter table public.user_watchlist alter column external_id set not null;
alter table public.user_watchlist add constraint library_identity unique(user_id,provider,media_type,external_id),
 add constraint library_metadata check(length(external_id) between 1 and 2048 and length(provider) between 1 and 30 and jsonb_typeof(snapshot)='object' and octet_length(snapshot::text)<20000);
insert into public.user_watchlist(user_id,provider,external_id,media_type,title,cover_url,status,is_favorite,is_watchlisted,snapshot)
 select p.id,'tmdb',f->>'id',coalesce(f->>'type',f->>'kind','movie'),f->>'title',f->>'image','planned',true,false,
 f || jsonb_build_object('kind',coalesce(f->>'type',f->>'kind','movie'))
 from public.profiles p cross join lateral jsonb_array_elements(case when jsonb_typeof(p.recommendation_preferences->'favorites')='array' then p.recommendation_preferences->'favorites' else '[]'::jsonb end) f
 where f->>'id' is not null and coalesce(f->>'type',f->>'kind','movie') in ('movie','tv') on conflict(user_id,provider,media_type,external_id) do nothing;
alter table public.user_watchlist enable row level security;
create policy "Library owner boundary" on public.user_watchlist as restrictive for all to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
revoke all on public.user_watchlist from anon; grant select,insert,update,delete on public.user_watchlist to authenticated;

alter table public.conversations add column avatar_url text, add column description text not null default '',
 add column permissions jsonb not null default '{"edit_info":"admins","add_people":"admins","send_messages":"everyone","create_polls":"everyone"}';
alter table public.conversation_participants add column role text not null default 'participant' check(role in ('owner','admin','participant')),
 add column muted boolean not null default false;
-- Repair older groups with a missing creator by choosing an existing participant once.
update public.conversations c set created_by=(select user_id from public.conversation_participants where conversation_id=c.id order by user_id limit 1)
 where is_group and not exists(select 1 from public.conversation_participants where conversation_id=c.id and user_id=c.created_by);
update public.conversation_participants cp set role='owner' from public.conversations c where c.id=cp.conversation_id and c.is_group and c.created_by=cp.user_id;
create unique index conversation_one_owner on public.conversation_participants(conversation_id) where role='owner';
revoke insert,update,delete on public.conversations,public.conversation_participants from authenticated,anon;
alter table public.messages drop constraint messages_message_type_check;
alter table public.messages add constraint messages_message_type_check check(message_type in ('text','image','voice_note','sticker','status_reply','forwarded_video','forwarded_news','forwarded_sotd','poll','system'));
alter table public.messages add column event_data jsonb, add column mention_ids uuid[] not null default '{}';

create table public.chat_signals(user_id uuid references auth.users(id) on delete cascade, conversation_id uuid not null,
 reason text not null, updated_at timestamptz not null default clock_timestamp(), primary key(user_id,conversation_id));
create table public.message_mentions(message_id uuid references public.messages(id) on delete cascade, user_id uuid references auth.users(id) on delete cascade,
 conversation_id uuid not null references public.conversations(id) on delete cascade, primary key(message_id,user_id));
create table public.chat_polls(message_id uuid primary key references public.messages(id) on delete cascade,
 conversation_id uuid not null references public.conversations(id) on delete cascade, question text not null,
 options jsonb not null, multiple boolean not null default false);
create table public.poll_votes(message_id uuid references public.chat_polls(message_id) on delete cascade, user_id uuid references auth.users(id) on delete cascade,
 conversation_id uuid not null references public.conversations(id) on delete cascade, choice_ids uuid[] not null,
 primary key(message_id,user_id));
create table public.message_pins(message_id uuid primary key references public.messages(id) on delete cascade,
 conversation_id uuid not null references public.conversations(id) on delete cascade, pinned_by uuid references auth.users(id) on delete set null,
 is_pinned boolean not null default true, created_at timestamptz not null default now());
do $$ declare t text; begin
 foreach t in array array['chat_signals','message_mentions','chat_polls','poll_votes','message_pins'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from anon,authenticated',t);
 execute format('grant select on public.%I to authenticated',t);
 end loop;
end $$;
create policy "Own access signals" on public.chat_signals for select to authenticated using(user_id=auth.uid());
create policy "Own mentions" on public.message_mentions for select to authenticated using(user_id=auth.uid() and public.kaidra_is_conversation_member(conversation_id));
create policy "Members read polls" on public.chat_polls for select to authenticated using(public.kaidra_is_conversation_member(conversation_id));
create policy "Members read votes" on public.poll_votes for select to authenticated using(public.kaidra_is_conversation_member(conversation_id));
create policy "Members read pins" on public.message_pins for select to authenticated using(public.kaidra_is_conversation_member(conversation_id));

create or replace function public.kaidra_group_allowed(target_conversation uuid, capability text)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.conversations c join public.conversation_participants cp on cp.conversation_id=c.id
 where c.id=target_conversation and c.is_group and cp.user_id=auth.uid() and
 (cp.role in ('owner','admin') or c.permissions->>capability='everyone'));
$$;
create or replace function public.kaidra_can_send_message(target_conversation uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select public.kaidra_is_conversation_member(target_conversation) and case when exists(select 1 from public.conversations where id=target_conversation and is_group)
 then public.kaidra_group_allowed(target_conversation,'send_messages') else not exists(select 1 from public.conversation_participants cp join public.user_preferences p on p.user_id=cp.user_id where cp.conversation_id=target_conversation and cp.user_id<>auth.uid() and not p.allow_dms) end;
$$;
-- Internal events cannot be forged using the authenticated REST role.
create function public.kaidra_system_event(cid uuid, event_kind text, label text, target_user uuid default null)
returns void language sql security definer set search_path='' as $$
 insert into public.messages(conversation_id,sender_id,content,message_type,event_data)
 values(cid,auth.uid(),label,'system',jsonb_build_object('kind',event_kind,'actor_id',auth.uid(),'target_id',target_user));
$$;
revoke all on function public.kaidra_system_event(uuid,text,text,uuid) from public,anon,authenticated;
create function public.kaidra_signal_member() returns trigger language plpgsql security definer set search_path='' as $$
declare cid uuid; uid uuid; begin
 cid:=case when tg_op='DELETE' then old.conversation_id else new.conversation_id end;
 uid:=case when tg_op='DELETE' then old.user_id else new.user_id end;
 insert into public.chat_signals(user_id,conversation_id,reason) values(uid,cid,case when tg_op='DELETE' then 'access_changed' else 'membership_changed' end)
 on conflict(user_id,conversation_id) do update set reason=excluded.reason,updated_at=clock_timestamp();
 return null;
end $$;
create trigger kaidra_member_signal after insert or update or delete on public.conversation_participants for each row execute function public.kaidra_signal_member();
create function public.kaidra_lock_send(cid uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.conversations where id=cid for share;
 if not public.kaidra_can_send_message(cid) then raise exception 'You cannot send messages in this conversation'; end if;
end $$;
revoke all on function public.kaidra_lock_send(uuid) from public,anon;
grant execute on function public.kaidra_lock_send(uuid) to authenticated;
create function public.kaidra_guard_structured_message() returns trigger language plpgsql set search_path='' as $$
begin
 if current_user in ('authenticated','anon') then
  perform public.kaidra_lock_send(new.conversation_id);
  if new.message_type in ('system','poll') or new.event_data is not null then raise exception 'Use the authorized action for structured messages'; end if;
 end if;
 if cardinality(new.mention_ids)>50 or exists(select 1 from unnest(new.mention_ids) uid where not exists(select 1 from public.conversation_participants where conversation_id=new.conversation_id and user_id=uid)) then raise exception 'Mentions must refer to conversation participants'; end if;
 return new;
end $$;
create trigger kaidra_structured_message before insert on public.messages for each row execute function public.kaidra_guard_structured_message();
create function public.kaidra_store_mentions() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.message_mentions(message_id,user_id,conversation_id) select new.id,uid,new.conversation_id from unnest(new.mention_ids) uid where uid<>new.sender_id on conflict do nothing;
 return null;
end $$;
create trigger kaidra_message_mentions after insert on public.messages for each row execute function public.kaidra_store_mentions();

create or replace function public.kaidra_create_group(group_title text, member_ids uuid[]) returns uuid language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); result uuid; members uuid[]; begin
 if actor is null then raise exception 'Sign in required'; end if;
 if group_title is null or length(trim(group_title)) not between 1 and 80 then raise exception 'Give your group a name (1–80 characters)'; end if;
 select array_agg(distinct id) into members from unnest(member_ids) id where id<>actor;
 if coalesce(cardinality(members),0) not between 1 and 49 then raise exception 'Choose 1–49 friends'; end if;
 if exists(select 1 from unnest(members) m where not exists(select 1 from public.friend_requests where status='accepted' and ((requester_id=actor and target_id=m) or (target_id=actor and requester_id=m)))) then raise exception 'Only your friends can be added'; end if;
 insert into public.conversations(is_group,title,created_by) values(true,trim(group_title),actor) returning id into result;
 insert into public.conversation_participants(conversation_id,user_id,role) values(result,actor,'owner');
 insert into public.conversation_participants(conversation_id,user_id) select result,unnest(members);
 perform public.kaidra_system_event(result,'group_created','Group created'); return result;
end $$;
create or replace function public.kaidra_add_group_members(target_conversation uuid, member_ids uuid[]) returns void language plpgsql security definer set search_path='' as $$
declare uid uuid; members uuid[]; begin
 perform 1 from public.conversations where id=target_conversation for update;
 if not public.kaidra_group_allowed(target_conversation,'add_people') then raise exception 'Only admins can add people'; end if;
 select array_agg(distinct id) into members from unnest(member_ids) id where not exists(select 1 from public.conversation_participants where conversation_id=target_conversation and user_id=id);
 if coalesce(cardinality(members),0)=0 then return; end if;
 if (select count(*) from public.conversation_participants where conversation_id=target_conversation)+cardinality(members)>50 then raise exception 'Groups support up to 50 people'; end if;
 foreach uid in array members loop
  if not exists(select 1 from public.friend_requests where status='accepted' and ((requester_id=auth.uid() and target_id=uid) or (target_id=auth.uid() and requester_id=uid))) then raise exception 'Only your friends can be added'; end if;
  insert into public.conversation_participants(conversation_id,user_id) values(target_conversation,uid);
  perform public.kaidra_system_event(target_conversation,'member_added',coalesce((select display_name from public.profiles where id=uid),'A participant')||' joined',uid);
 end loop;
end $$;
-- One serialized authority boundary for role/ownership/info/permissions/leave operations.
create function public.kaidra_group_action(target_conversation uuid, action text, target_user uuid default null, details jsonb default '{}')
returns void language plpgsql security definer set search_path='' as $$
declare actor_role text; target_role text; key text; value text; label text; begin
 perform 1 from public.conversations where id=target_conversation and is_group for update;
 if not found then raise exception 'Group unavailable'; end if;
 select role into actor_role from public.conversation_participants where conversation_id=target_conversation and user_id=auth.uid();
 if actor_role is null then raise exception 'Group membership required'; end if;
 select role into target_role from public.conversation_participants where conversation_id=target_conversation and user_id=target_user;
 label:=coalesce((select display_name from public.profiles where id=target_user),'Participant');
 if action in ('promote','demote','transfer') then
  if actor_role<>'owner' or target_role is null or target_user=auth.uid() then raise exception 'Only the owner can change roles or transfer ownership'; end if;
  if action='transfer' then
   update public.conversation_participants set role='admin' where conversation_id=target_conversation and user_id=auth.uid();
   update public.conversation_participants set role='owner' where conversation_id=target_conversation and user_id=target_user;
   update public.conversations set created_by=target_user where id=target_conversation;
   perform public.kaidra_system_event(target_conversation,'ownership_transferred',label||' is now the owner',target_user);
  else
   update public.conversation_participants set role=case when action='promote' then 'admin' else 'participant' end where conversation_id=target_conversation and user_id=target_user;
   perform public.kaidra_system_event(target_conversation,'role_changed',label||case when action='promote' then ' became an admin' else ' is no longer an admin' end,target_user);
  end if;
 elsif action='remove' then
  if target_role is null or target_role='owner' or target_user=auth.uid() or not(actor_role='owner' or actor_role='admin' and target_role='participant') then raise exception 'You cannot remove this participant'; end if;
  delete from public.conversation_participants where conversation_id=target_conversation and user_id=target_user;
  perform public.kaidra_system_event(target_conversation,'member_removed',label||' was removed',target_user);
 elsif action='leave' then
  if actor_role='owner' then raise exception 'Transfer ownership before leaving'; end if;
  perform public.kaidra_system_event(target_conversation,'member_left',coalesce((select display_name from public.profiles where id=auth.uid()),'A participant')||' left',auth.uid());
  delete from public.conversation_participants where conversation_id=target_conversation and user_id=auth.uid();
 elsif action='delete' then
  if actor_role<>'owner' then raise exception 'Only the owner can delete a group'; end if;
  delete from public.conversations where id=target_conversation;
 elsif action='permissions' then
  if actor_role<>'owner' then raise exception 'Only the owner can change permissions'; end if;
  for key,value in select * from jsonb_each_text(details) loop
   if key not in ('edit_info','add_people','send_messages','create_polls') or value not in ('everyone','admins') then raise exception 'Invalid permission'; end if;
  end loop;
  update public.conversations set permissions=permissions||details where id=target_conversation;
  perform public.kaidra_system_event(target_conversation,'permissions_changed','Group permissions updated');
 elsif action='info' then
  if not public.kaidra_group_allowed(target_conversation,'edit_info') then raise exception 'Only admins can edit group information'; end if;
  if details ? 'title' and length(trim(details->>'title')) not between 1 and 80 then raise exception 'Name must be 1–80 characters'; end if;
  if length(coalesce(details->>'description',''))>500 or length(coalesce(details->>'avatar_url',''))>2048 then raise exception 'Group information is too long'; end if;
  update public.conversations set title=coalesce(trim(details->>'title'),title),description=coalesce(details->>'description',description),avatar_url=coalesce(details->>'avatar_url',avatar_url) where id=target_conversation;
  perform public.kaidra_system_event(target_conversation,'info_changed','Group information updated');
 elsif action='mute' then
  update public.conversation_participants set muted=coalesce((details->>'muted')::boolean,false) where conversation_id=target_conversation and user_id=auth.uid();
 else raise exception 'Unknown group action'; end if;
end $$;
create or replace function public.kaidra_leave_group(target_conversation uuid) returns void language sql security definer set search_path='' as $$
 select public.kaidra_group_action(target_conversation,'leave');
$$;

create function public.kaidra_create_poll(target_conversation uuid, question text, options text[], multiple boolean default false, request_id uuid default gen_random_uuid())
returns uuid language plpgsql security definer set search_path='' as $$
declare choices jsonb; begin
 perform 1 from public.conversations where id=target_conversation for share;
 if not public.kaidra_group_allowed(target_conversation,'create_polls') or not public.kaidra_can_send_message(target_conversation) then raise exception 'Polls are limited to authorized group participants'; end if;
 if exists(select 1 from public.messages where id=request_id and conversation_id=target_conversation and sender_id=auth.uid() and message_type='poll') then return request_id; end if;
 if question is null or length(trim(question)) not between 1 and 240 or coalesce(cardinality(options),0) not between 2 and 10 or exists(select 1 from unnest(options) o where o is null or length(trim(o)) not between 1 and 120) or (select count(distinct lower(trim(o))) from unnest(options) o)<>cardinality(options) then raise exception 'Use a question and 2–10 different options'; end if;
 select jsonb_agg(jsonb_build_object('id',gen_random_uuid(),'label',trim(o))) into choices from unnest(options) o;
 insert into public.messages(id,conversation_id,sender_id,content,message_type) values(request_id,target_conversation,auth.uid(),trim(question),'poll');
 insert into public.chat_polls values(request_id,target_conversation,trim(question),choices,multiple); return request_id;
end $$;
create function public.kaidra_vote(target_message uuid, choices uuid[]) returns void language plpgsql security definer set search_path='' as $$
declare poll public.chat_polls; begin
 select * into poll from public.chat_polls where message_id=target_message;
 perform 1 from public.conversations where id=poll.conversation_id for share;
 if not public.kaidra_is_conversation_member(poll.conversation_id) then raise exception 'Membership required'; end if;
 if choices is null or cardinality(choices)>(case when poll.multiple then 10 else 1 end) or (select count(distinct c) from unnest(choices) c)<>cardinality(choices) or exists(select 1 from unnest(choices) c where not exists(select 1 from jsonb_array_elements(poll.options) o where o->>'id'=c::text)) then raise exception 'Invalid poll choices'; end if;
 insert into public.poll_votes(message_id,user_id,conversation_id,choice_ids) values(target_message,auth.uid(),poll.conversation_id,choices)
 on conflict(message_id,user_id) do update set choice_ids=excluded.choice_ids;
end $$;
create function public.kaidra_pin(target_message uuid, pinned boolean) returns void language plpgsql security definer set search_path='' as $$
declare cid uuid; begin
 select conversation_id into cid from public.messages where id=target_message and message_type<>'system';
 perform 1 from public.conversations where id=cid for share;
 if not public.kaidra_group_allowed(cid,'pin_messages') then raise exception 'Only group admins can pin messages'; end if;
 insert into public.message_pins(message_id,conversation_id,pinned_by,is_pinned) values(target_message,cid,auth.uid(),pinned)
 on conflict(message_id) do update set is_pinned=excluded.is_pinned,pinned_by=excluded.pinned_by,created_at=now();
end $$;
create or replace function public.kaidra_chat_state(target_conversation uuid, message_ids uuid[] default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare ids uuid[]; begin
 if not public.kaidra_is_conversation_member(target_conversation) then raise exception 'Membership required'; end if;
 if coalesce(cardinality(message_ids),0)>1000 then raise exception 'Too many messages'; end if;
 select array_agg(id) into ids from (select id from public.messages where conversation_id=target_conversation and (message_ids is null or id=any(message_ids)) order by created_at desc,id desc limit 1000) m;
 return jsonb_build_object(
 'conversation',(select to_jsonb(c) from public.conversations c where id=target_conversation),
 'members',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'username',p.username,'display_name',p.display_name,'avatar_url',p.avatar_url,'role',cp.role,'muted',case when p.id=auth.uid() then cp.muted else null end)) from public.conversation_participants cp join public.profiles p on p.id=cp.user_id where cp.conversation_id=target_conversation),'[]'::jsonb),
 'reactions',coalesce((select jsonb_agg(to_jsonb(r)) from public.message_reactions r where conversation_id=target_conversation and message_id=any(ids) and emoji is not null),'[]'::jsonb),
 'reads',coalesce((select jsonb_agg(to_jsonb(r)) from public.message_reads r where conversation_id=target_conversation and message_id=any(ids)),'[]'::jsonb),
 'polls',coalesce((select jsonb_agg(to_jsonb(p)||jsonb_build_object('votes',coalesce((select jsonb_agg(to_jsonb(v)) from public.poll_votes v where v.message_id=p.message_id),'[]'::jsonb))) from public.chat_polls p where conversation_id=target_conversation and message_id=any(ids)),'[]'::jsonb),
 'pins',coalesce((select jsonb_agg(to_jsonb(m)||jsonb_build_object('pinned_by',p.pinned_by)) from public.message_pins p join public.messages m on m.id=p.message_id where p.conversation_id=target_conversation and p.is_pinned),'[]'::jsonb),
 'quotes',coalesce((select jsonb_agg(to_jsonb(m)) from public.messages m where m.conversation_id=target_conversation and m.id::text in(select external_ref_id from public.messages where id=any(ids))),'[]'::jsonb));
end $$;
create or replace function public.kaidra_inbox() returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(entry order by sent_at desc nulls last),'[]'::jsonb) from (
 select last_msg.created_at sent_at,jsonb_build_object('conversationId',c.id,'isGroup',c.is_group,'title',c.title,'createdBy',c.created_by,'muted',mine.muted,
 'profile',case when c.is_group then jsonb_build_object('id',c.id,'display_name',c.title,'username','group','avatar_url',c.avatar_url) else
 (select jsonb_build_object('id',p.id,'username',p.username,'display_name',p.display_name,'avatar_url',p.avatar_url) from public.conversation_participants cp join public.profiles p on p.id=cp.user_id where cp.conversation_id=c.id and cp.user_id<>auth.uid() limit 1) end,
 'lastMessage',to_jsonb(last_msg),
 'mentionCount',(select count(*) from public.message_mentions mm where mm.conversation_id=c.id and mm.user_id=auth.uid() and not exists(select 1 from public.message_reads r where r.message_id=mm.message_id and r.user_id=auth.uid())),
 'unreadCount',(select count(*) from public.messages m where m.conversation_id=c.id and m.sender_id<>auth.uid() and m.message_type<>'system' and not exists(select 1 from public.message_reads r where r.message_id=m.id and r.user_id=auth.uid()) and (c.is_group or m.read_at is null))
 ) entry from public.conversations c join public.conversation_participants mine on mine.conversation_id=c.id and mine.user_id=auth.uid()
 left join lateral(select * from public.messages where conversation_id=c.id order by created_at desc,id desc limit 1) last_msg on true) records;
$$;
create function public.kaidra_shared_history(target_conversation uuid, category text default 'entertainment', before_time timestamptz default null, before_id uuid default null)
returns setof public.messages language plpgsql stable security definer set search_path='' as $$
begin
 if not public.kaidra_is_conversation_member(target_conversation) then raise exception 'Membership required'; end if;
 return query select * from public.messages m where conversation_id=target_conversation
 and (before_time is null or (m.created_at,m.id)<(before_time,before_id))
 and case category when 'entertainment' then m.shared_content is not null when 'media' then m.message_type in ('image','voice_note') when 'links' then m.content ~ 'https?://' else false end
 order by m.created_at desc,m.id desc limit 30;
end $$;
create function public.kaidra_library_save(item jsonb, collection text, saved boolean) returns public.user_watchlist language plpgsql security definer set search_path='' as $$
declare result public.user_watchlist; provider_name text; kind text; eid text; begin
 if auth.uid() is null then raise exception 'Sign in required'; end if;
 kind:=coalesce(item->>'kind',item->>'type'); provider_name:=case kind when 'movie' then 'tmdb' when 'tv' then 'tmdb' when 'match' then 'football-data' when 'article' then 'news' when 'anime' then 'mal' end;
 eid:=case when kind='article' then item->>'url' else item->>'id' end;
 if collection not in ('favorites','watchlist') or saved is null or provider_name is null or eid is null or length(eid) not between 1 and 2048 or length(coalesce(item->>'title','')) not between 1 and 300 or octet_length(item::text)>=20000 then raise exception 'Invalid saved item'; end if;
 if collection='watchlist' and kind not in ('movie','tv','anime') then raise exception 'Watchlist is for movies and series'; end if;
 insert into public.user_watchlist(user_id,provider,media_type,external_id,status,title,cover_url,snapshot,is_favorite,is_watchlisted)
 values(auth.uid(),provider_name,kind,eid,'planned',item->>'title',item->>'image',item,collection='favorites' and saved,collection='watchlist' and saved)
 on conflict(user_id,provider,media_type,external_id) do update set title=excluded.title,cover_url=excluded.cover_url,snapshot=excluded.snapshot,
 is_favorite=case when collection='favorites' then saved else user_watchlist.is_favorite end,
 is_watchlisted=case when collection='watchlist' then saved else user_watchlist.is_watchlisted end,updated_at=now() returning * into result;
 return result;
end $$;
do $$ declare signature text; t text; begin
 foreach signature in array array['kaidra_group_allowed(uuid,text)','kaidra_group_action(uuid,text,uuid,jsonb)','kaidra_create_poll(uuid,text,text[],boolean,uuid)','kaidra_vote(uuid,uuid[])','kaidra_pin(uuid,boolean)','kaidra_shared_history(uuid,text,timestamptz,uuid)','kaidra_library_save(jsonb,text,boolean)'] loop
 execute 'revoke all on function public.'||signature||' from public,anon'; execute 'grant execute on function public.'||signature||' to authenticated';
 end loop;
 foreach t in array array['chat_signals','message_mentions','chat_polls','poll_votes','message_pins','conversations','user_watchlist'] loop
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=t) then execute format('alter publication supabase_realtime add table public.%I',t); end if;
 end loop;
end $$;
notify pgrst,'reload schema';
commit;
