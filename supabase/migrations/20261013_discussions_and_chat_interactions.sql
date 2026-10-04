begin;
alter table public.messages drop constraint messages_message_type_check;
alter table public.messages add constraint messages_message_type_check check(message_type in('text','image','voice_note','sticker','status_reply','forwarded_video','forwarded_news','forwarded_sotd','poll','system','discussion'));
alter table public.messages add column discussion_locked_at timestamptz, add column edited_at timestamptz, add column deleted_at timestamptz;
alter table public.messages add constraint kaidra_discussion_body check(message_type<>'discussion' or deleted_at is not null or (length(trim(content)) between 1 and 4000 and shared_content is null));
create table public.discussion_positions(discussion_message_id uuid not null references public.messages(id) on delete cascade,user_id uuid not null references auth.users(id) on delete cascade,conversation_id uuid not null references public.conversations(id) on delete cascade,position text not null check(position in('agree','disagree')),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),primary key(discussion_message_id,user_id));
create index discussion_positions_chat_idx on public.discussion_positions(conversation_id,discussion_message_id);
alter table public.discussion_positions enable row level security;
revoke all on public.discussion_positions from public,anon,authenticated;
grant select on public.discussion_positions to authenticated;
-- Raw rows are own-only: pre-vote clients cannot reconstruct the split.
create policy "Own accessible position" on public.discussion_positions for select to authenticated using(user_id=auth.uid() and public.kaidra_is_conversation_member(conversation_id));
create function public.kaidra_discussion_position(target_message uuid,choice text) returns void language plpgsql security definer set search_path='' as $$
declare m public.messages;uid uuid;begin
 select * into m from public.messages where id=target_message for update;
 if m.id is null or m.message_type<>'discussion' or m.deleted_at is not null or not public.kaidra_can_send_message(m.conversation_id) or m.sender_id=auth.uid() then raise exception 'Only other conversation members may take a side';end if;
 if choice is null then delete from public.discussion_positions where discussion_message_id=m.id and user_id=auth.uid();
 elsif choice in('agree','disagree') then
 insert into public.discussion_positions(discussion_message_id,user_id,conversation_id,position) values(m.id,auth.uid(),m.conversation_id,choice) on conflict(discussion_message_id,user_id) do update set position=excluded.position,updated_at=now();
 update public.messages set discussion_locked_at=coalesce(discussion_locked_at,now()) where id=m.id;
 else raise exception 'Choose Agree or Disagree';end if;
 for uid in select user_id from public.conversation_participants where conversation_id=m.conversation_id loop
 insert into public.chat_signals(user_id,conversation_id,reason,updated_at) values(uid,m.conversation_id,'discussion',now()) on conflict(user_id,conversation_id) do update set reason=excluded.reason,updated_at=excluded.updated_at;
 end loop;
end $$;
create function public.kaidra_discussion_state(target_conversation uuid,message_ids uuid[] default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;begin
 if not public.kaidra_is_conversation_member(target_conversation) or coalesce(cardinality(message_ids),0)>1000 then raise exception 'Conversation membership required';end if;
 select coalesce(jsonb_agg(jsonb_build_object('message_id',m.id,'total',votes.total,'own_position',own.position,'locked',m.discussion_locked_at is not null,
 'agree',case when own.position is not null then votes.agree end,'disagree',case when own.position is not null then votes.disagree end,
 'dm_response',case when not c.is_group then (select jsonb_build_object('user_id',dp.user_id,'position',dp.position,'name',coalesce(p.display_name,p.username)) from public.discussion_positions dp join public.profiles p on p.id=dp.user_id where dp.discussion_message_id=m.id limit 1) end,
 'opponents',coalesce((select jsonb_agg(jsonb_build_object('id',cp.user_id,'name',coalesce(p.display_name,p.username))) from public.conversation_participants cp join public.profiles p on p.id=cp.user_id left join public.discussion_positions dp on dp.discussion_message_id=m.id and dp.user_id=cp.user_id where cp.conversation_id=m.conversation_id and cp.user_id<>auth.uid() and public.kaidra_pair_allowed(auth.uid(),cp.user_id) and (c.is_group or public.kaidra_friends(auth.uid(),cp.user_id)) and (case when auth.uid()=m.sender_id then 'agree' else own.position end) is not null and (case when cp.user_id=m.sender_id then 'agree' else dp.position end)<>(case when auth.uid()=m.sender_id then 'agree' else own.position end)),'[]'::jsonb))), '[]'::jsonb) into result
 from public.messages m join public.conversations c on c.id=m.conversation_id left join public.discussion_positions own on own.discussion_message_id=m.id and own.user_id=auth.uid()
 cross join lateral(select count(*) total,count(*) filter(where dp.position='agree') agree,count(*) filter(where dp.position='disagree') disagree from public.discussion_positions dp join public.conversation_participants cp on cp.user_id=dp.user_id and cp.conversation_id=m.conversation_id where dp.discussion_message_id=m.id) votes
 where m.conversation_id=target_conversation and m.message_type='discussion' and m.deleted_at is null and (message_ids is null or m.id=any(message_ids));return result;
end $$;
-- Expected recipients are recorded at send time. Acknowledgement, not presence, means delivered.
create table public.message_deliveries(message_id uuid not null references public.messages(id) on delete cascade,user_id uuid not null references auth.users(id) on delete cascade,conversation_id uuid not null references public.conversations(id) on delete cascade,delivered_at timestamptz,primary key(message_id,user_id));
create index message_deliveries_chat_idx on public.message_deliveries(conversation_id,message_id);
alter table public.message_deliveries enable row level security;
revoke all on public.message_deliveries from public,anon,authenticated;
grant select on public.message_deliveries to authenticated;
create policy "Conversation delivery receipts" on public.message_deliveries for select to authenticated using(public.kaidra_is_conversation_member(conversation_id));
insert into public.message_deliveries select m.id,cp.user_id,m.conversation_id,r.read_at from public.messages m join public.conversation_participants cp on cp.conversation_id=m.conversation_id and cp.user_id<>m.sender_id left join public.message_reads r on r.message_id=m.id and r.user_id=cp.user_id;
create function public.kaidra_message_recipients() returns trigger language plpgsql security definer set search_path='' as $$begin
 insert into public.message_deliveries(message_id,user_id,conversation_id) select new.id,user_id,new.conversation_id from public.conversation_participants where conversation_id=new.conversation_id and user_id<>new.sender_id;return null;end $$;
create trigger kaidra_message_recipients after insert on public.messages for each row execute function public.kaidra_message_recipients();
create function public.kaidra_message_ack(target_conversation uuid,message_ids uuid[],seen boolean default false) returns void language plpgsql security definer set search_path='' as $$begin
 if not public.kaidra_is_conversation_member(target_conversation) or coalesce(cardinality(message_ids),0)>1000 then raise exception 'Conversation membership required';end if;
 insert into public.message_deliveries(message_id,user_id,conversation_id,delivered_at) select id,auth.uid(),conversation_id,now() from public.messages where conversation_id=target_conversation and id=any(message_ids) and sender_id<>auth.uid() on conflict(message_id,user_id) do update set delivered_at=coalesce(message_deliveries.delivered_at,excluded.delivered_at);
 if seen then
 insert into public.message_reads(message_id,user_id,conversation_id) select id,auth.uid(),conversation_id from public.messages where conversation_id=target_conversation and id=any(message_ids) and sender_id<>auth.uid() on conflict do nothing;
 if not exists(select 1 from public.conversations where id=target_conversation and is_group) then update public.messages set read_at=now() where conversation_id=target_conversation and id=any(message_ids) and sender_id<>auth.uid() and read_at is null;end if;
 end if;
end $$;
-- Definer mutations validate ownership explicitly; raw authenticated writes still only allow read_at.
create or replace function public.kaidra_guard_message_update() returns trigger language plpgsql set search_path='' as $$begin
 if current_user in('authenticated','anon') then
 if old.sender_id=auth.uid() or not public.kaidra_is_conversation_member(old.conversation_id) or (to_jsonb(new)-'read_at') is distinct from (to_jsonb(old)-'read_at') then raise exception 'Only recipients may update a read receipt';end if;
 new.read_at=coalesce(old.read_at,now());end if;return new;end $$;
create function public.kaidra_message_change(target_message uuid,action text,body text default '') returns void language plpgsql security definer set search_path='' as $$declare m public.messages;begin
 select * into m from public.messages where id=target_message for update;
 if m.id is null or m.sender_id<>auth.uid() or not public.kaidra_can_send_message(m.conversation_id) or m.message_type='system' or m.deleted_at is not null then raise exception 'Only the author may change this message';end if;
 if action='edit' then
 if m.message_type not in('text','discussion') or length(trim(body)) not between 1 and 4000 or m.discussion_locked_at is not null then raise exception 'A discussion with responses cannot be edited. Delete and repost it';end if;
 update public.messages set content=trim(body),edited_at=now() where id=m.id;
 elsif action='delete' then update public.messages set content='',shared_content=null,media_url=null,deleted_at=now() where id=m.id;
 else raise exception 'Unknown message action';end if;
end $$;
create or replace function public.kaidra_guard_structured_message() returns trigger language plpgsql set search_path='' as $$
begin
 if current_user in ('authenticated','anon') then
  perform public.kaidra_lock_send(new.conversation_id);
  if new.message_type in ('system','poll') or new.event_data is not null or new.discussion_locked_at is not null or new.edited_at is not null or new.deleted_at is not null then raise exception 'Use the authorized action for structured messages'; end if;
 end if;
 if cardinality(new.mention_ids)>50 or exists(select 1 from unnest(new.mention_ids) uid where not exists(select 1 from public.conversation_participants where conversation_id=new.conversation_id and user_id=uid)) then raise exception 'Mentions must refer to conversation participants'; end if;
 return new;
end $$;
CREATE OR REPLACE FUNCTION public.kaidra_chat_state(target_conversation uuid, message_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare ids uuid[]; begin
 if not public.kaidra_is_conversation_member(target_conversation) then raise exception 'Membership required'; end if;
 if coalesce(cardinality(message_ids),0)>1000 then raise exception 'Too many messages'; end if;
 select array_agg(id) into ids from (select id from public.messages where conversation_id=target_conversation and (message_ids is null or id=any(message_ids)) order by created_at desc,id desc limit 1000) m;
 return jsonb_build_object(
 'discussions',public.kaidra_discussion_state(target_conversation,ids),
 'deliveries',coalesce((select jsonb_agg(to_jsonb(d)) from public.message_deliveries d where conversation_id=target_conversation and message_id=any(ids)),'[]'::jsonb),
 'conversation',(select to_jsonb(c) from public.conversations c where id=target_conversation),
 'members',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'username',p.username,'display_name',p.display_name,'avatar_url',p.avatar_url,'role',cp.role,'muted',case when p.id=auth.uid() then cp.muted else null end)) from public.conversation_participants cp join public.profiles p on p.id=cp.user_id where cp.conversation_id=target_conversation),'[]'::jsonb),
 'reactions',coalesce((select jsonb_agg(to_jsonb(r)) from public.message_reactions r where conversation_id=target_conversation and message_id=any(ids) and emoji is not null),'[]'::jsonb),
 'reads',coalesce((select jsonb_agg(to_jsonb(r)) from public.message_reads r where conversation_id=target_conversation and message_id=any(ids)),'[]'::jsonb),
 'polls',coalesce((select jsonb_agg(to_jsonb(p)||jsonb_build_object('votes',coalesce((select jsonb_agg(to_jsonb(v)) from public.poll_votes v where v.message_id=p.message_id),'[]'::jsonb))) from public.chat_polls p where conversation_id=target_conversation and message_id=any(ids)),'[]'::jsonb),
 'pins',coalesce((select jsonb_agg(to_jsonb(m)||jsonb_build_object('pinned_by',p.pinned_by)) from public.message_pins p join public.messages m on m.id=p.message_id where p.conversation_id=target_conversation and p.is_pinned),'[]'::jsonb),
 'quotes',coalesce((select jsonb_agg(to_jsonb(m)) from public.messages m where m.conversation_id=target_conversation and m.id::text in(select external_ref_id from public.messages where id=any(ids))),'[]'::jsonb));
end $function$
;
alter table public.battles drop constraint battles_type_check;
alter table public.battles add constraint battles_type_check check(type in('opinion','direct','discussion'));
alter table public.battles alter column challenger_position drop not null;
alter table public.battles add column discussion_message_id uuid references public.messages(id) on delete set null,add column flavour_text text check(length(flavour_text)<=240);
CREATE OR REPLACE FUNCTION public.kaidra_battle_create(target_conversation uuid, target_user uuid, topic text, stance text, context jsonb DEFAULT '{}'::jsonb, request_id uuid DEFAULT gen_random_uuid())
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare expired record; m public.messages; entry text; side_a text; side_b text;begin
 perform 1 from public.conversations where id=target_conversation for share;
 if not public.kaidra_can_send_message(target_conversation) or not public.kaidra_pair_allowed(auth.uid(),target_user) or (not public.kaidra_friends(auth.uid(),target_user) and not exists(select 1 from public.conversations where id=target_conversation and is_group)) or not exists(select 1 from public.conversation_participants where conversation_id=target_conversation and user_id=target_user) then raise exception 'Challenge a friend in this conversation';end if;
 if exists(select 1 from public.battles where id=request_id and challenger_id=auth.uid() and challenged_id=target_user and conversation_id=target_conversation) then return request_id;end if;
 if context is null or jsonb_typeof(context)<>'object' or octet_length(context::text)>=12000 then raise exception 'Invalid challenge context';end if;
 entry:=coalesce(context->>'entry_type','opinion');
 if entry='discussion' then
 select * into m from public.messages where id=(context->>'discussion_message_id')::uuid for update;
 if m.conversation_id is distinct from target_conversation or m.message_type<>'discussion' or m.deleted_at is not null then raise exception 'Choose an accessible discussion';end if;
 side_a:=case when auth.uid()=m.sender_id then 'agree' else (select position from public.discussion_positions where discussion_message_id=m.id and user_id=auth.uid()) end;
 side_b:=case when target_user=m.sender_id then 'agree' else (select position from public.discussion_positions where discussion_message_id=m.id and user_id=target_user) end;
 if side_a is null or side_b is null or side_a=side_b then raise exception 'Choose someone on the opposing side';end if;
 topic:=left(m.content,240);stance:=side_a;context:=jsonb_build_object('entry_type','discussion','discussion_message_id',m.id,'statement',m.content,'opponent_position',side_b);
 elsif entry='direct' then
 if length(coalesce(topic,''))>240 then raise exception 'Keep challenge text under 240 characters';end if;
 context:=jsonb_build_object('entry_type','direct','flavour_text',coalesce(topic,''));topic:='Friendly battle';stance:=null;
 elsif entry='opinion' then
 if topic is null or length(trim(topic)) not between 1 and 240 or stance is null or length(trim(stance)) not between 1 and 1200 then raise exception 'Add a topic and your stance';end if;
 else raise exception 'Unknown challenge entry';end if;
 perform pg_advisory_xact_lock(hashtextextended('kaidra:battle:'||least(auth.uid(),target_user)::text||greatest(auth.uid(),target_user)::text,0));
 update public.battles set status='expired' where status='active' and type='direct' and ends_at<=now() and least(challenger_id,challenged_id)=least(auth.uid(),target_user) and greatest(challenger_id,challenged_id)=greatest(auth.uid(),target_user);
 for expired in select id from public.battles where type<>'direct' and status='active' and ends_at<=now() and least(challenger_id,challenged_id)=least(auth.uid(),target_user) and greatest(challenger_id,challenged_id)=greatest(auth.uid(),target_user) loop perform public.kaidra_battle_action(expired.id,'finish');end loop;
 update public.battles set status='expired' where status='pending' and created_at<now()-interval '1 day' and auth.uid() in(challenger_id,challenged_id);
 if (select count(*) from public.battle_attempts where challenger_id=auth.uid() and created_at>now()-interval '1 day')>=5 or exists(select 1 from public.battle_attempts where least(challenger_id,challenged_id)=least(auth.uid(),target_user) and greatest(challenger_id,challenged_id)=greatest(auth.uid(),target_user) and created_at>now()-interval '12 hours') then raise exception 'Give this matchup a break. Try another friend later';end if;
 insert into public.battles(id,conversation_id,challenger_id,challenged_id,topic,challenger_position,context,type,discussion_message_id,flavour_text) values(request_id,target_conversation,auth.uid(),target_user,trim(topic),trim(stance),context,entry,m.id,case when entry='direct' then context->>'flavour_text' end);return request_id;
end $function$
;
CREATE OR REPLACE FUNCTION public.kaidra_battle_action(target_battle uuid, action text, value text DEFAULT ''::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare b public.battles;cid uuid;count_a integer;count_b integer;winner uuid;begin
 select conversation_id into cid from public.battles where id=target_battle;perform 1 from public.conversations where id=cid for share;
 if not public.kaidra_is_conversation_member(cid) then raise exception 'Conversation membership required';end if;
 select * into b from public.battles where id=target_battle for update;
 if not public.kaidra_pair_allowed(b.challenger_id,b.challenged_id) or (not public.kaidra_friends(b.challenger_id,b.challenged_id) and not exists(select 1 from public.conversations where id=b.conversation_id and is_group)) then raise exception 'This matchup is no longer available';end if;
 if b.type='direct' and action not in('accept','decline','cancel') then raise exception 'This action is unavailable for a direct challenge';end if;
 if action='accept' then
  if auth.uid()<>b.challenged_id or b.status<>'pending' or b.created_at<now()-interval '1 day' or (b.type='opinion' and (value is null or length(trim(value)) not between 1 and 1200)) then raise exception 'Only the invited friend can accept with a stance';end if;
  update public.battles set status='active',challenged_position=case when b.type='discussion' then b.context->>'opponent_position' when b.type='opinion' then trim(value) else null end,accepted_at=now(),ends_at=now()+interval '1 day' where id=b.id;
 elsif action in('decline','cancel') then
  if b.status<>'pending' or (action='decline' and auth.uid()<>b.challenged_id) or (action='cancel' and auth.uid()<>b.challenger_id) then raise exception 'This challenge cannot be changed';end if;
  update public.battles set status=case when action='decline' then 'declined' else 'cancelled' end where id=b.id;
 elsif action='vote' then
  if b.type='direct' then raise exception 'Direct challenges do not have discussion votes';end if;
  if b.status<>'active' or now()>=b.ends_at or auth.uid() in(b.challenger_id,b.challenged_id) or value not in(b.challenger_id::text,b.challenged_id::text) or not public.kaidra_battle_voter_eligible(b.id,auth.uid()) then raise exception 'Only eligible spectators can vote on an active debate';end if;
  if exists(select 1 from public.battle_votes where battle_id=b.id and user_id=auth.uid() and side=value::uuid) then return;end if;
  if exists(select 1 from public.battle_votes where battle_id=b.id and user_id=auth.uid() and created_at>now()-interval '2 seconds') then raise exception 'Take a moment before changing your vote';end if;
  insert into public.battle_votes values(b.id,auth.uid(),value::uuid,now()) on conflict(battle_id,user_id) do update set side=excluded.side,created_at=now();
  perform public.kaidra_social_signal(b.challenger_id);perform public.kaidra_social_signal(b.challenged_id);
 elsif action='post' then
  if b.type='direct' then raise exception 'Direct challenges do not require arguments';end if;
  if b.status<>'active' or now()>=b.ends_at or auth.uid() not in(b.challenger_id,b.challenged_id) or length(trim(value)) not between 1 and 1200 then raise exception 'Only participants can add a stance';end if;
  if (select count(*) from public.battle_posts where battle_id=b.id and user_id=auth.uid())>=6 or exists(select 1 from public.battle_posts where battle_id=b.id and user_id=auth.uid() and created_at>now()-interval '1 minute') then raise exception 'Take a moment before adding another argument';end if;
  insert into public.battle_posts(battle_id,user_id,body) values(b.id,auth.uid(),trim(value));
 elsif action='concede' then
  if b.status<>'active' or auth.uid() not in(b.challenger_id,b.challenged_id) then raise exception 'Only a participant can concede';end if;
  perform public.kaidra_battle_resolve(b.id,case when auth.uid()=b.challenger_id then b.challenged_id else b.challenger_id end,'concession');
 elsif action='draw' then
  if b.status<>'active' or auth.uid() not in(b.challenger_id,b.challenged_id) then raise exception 'Only participants can agree a draw';end if;
  if b.draw_offered_by is not null and b.draw_offered_by<>auth.uid() then perform public.kaidra_battle_resolve(b.id,null,'draw');else update public.battles set draw_offered_by=auth.uid() where id=b.id;end if;
 elsif action='finish' then
  if b.status<>'active' or (now()<b.ends_at and (auth.uid() not in(b.challenger_id,b.challenged_id) or now()<b.accepted_at+interval '5 minutes')) then raise exception 'Voting is still open';end if;
  select count(*) filter(where v.side=b.challenger_id),count(*) filter(where v.side=b.challenged_id) into count_a,count_b from public.battle_votes v join public.conversation_participants cp on cp.user_id=v.user_id and cp.conversation_id=b.conversation_id where v.battle_id=b.id and public.kaidra_battle_voter_eligible(b.id,v.user_id);
  if count_a+count_b<3 and now()<b.ends_at then raise exception 'At least three spectators need to vote';end if;
  winner:=case when count_a+count_b<3 or count_a=count_b then null when count_a>count_b then b.challenger_id else b.challenged_id end;
  perform public.kaidra_battle_resolve(b.id,winner,case when winner is null then 'draw' else 'community_vote' end);
 else raise exception 'Unknown battle action';end if;
end $function$
;
-- Only conversation members can join private ephemeral typing channels.
create function public.kaidra_typing_topic(topic text) returns boolean language plpgsql stable security definer set search_path='' as $$begin
 if topic !~ '^typing:[0-9a-fA-F-]{36}$' then return false;end if;
 return public.kaidra_is_conversation_member(substring(topic from 8)::uuid);
exception when invalid_text_representation then return false;end $$;
create policy "Chat typing receive" on realtime.messages for select to authenticated using(extension='presence' and public.kaidra_typing_topic(realtime.topic()));
create policy "Chat typing publish" on realtime.messages for insert to authenticated with check(extension='presence' and public.kaidra_typing_topic(realtime.topic()));
revoke all on function public.kaidra_discussion_position(uuid,text) from public,anon;
grant execute on function public.kaidra_discussion_position(uuid,text) to authenticated;
revoke all on function public.kaidra_discussion_state(uuid,uuid[]) from public,anon;
grant execute on function public.kaidra_discussion_state(uuid,uuid[]) to authenticated;
revoke all on function public.kaidra_message_ack(uuid,uuid[],boolean) from public,anon;
grant execute on function public.kaidra_message_ack(uuid,uuid[],boolean) to authenticated;
revoke all on function public.kaidra_message_change(uuid,text,text) from public,anon;
grant execute on function public.kaidra_message_change(uuid,text,text) to authenticated;
revoke all on function public.kaidra_typing_topic(text) from public,anon;
grant execute on function public.kaidra_typing_topic(text) to authenticated;
revoke all on function public.kaidra_message_recipients() from public,anon,authenticated;
alter publication supabase_realtime add table public.message_deliveries;
notify pgrst,'reload schema';
commit;
