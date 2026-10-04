begin;
-- Preserve all existing battle records. Handle conflicts before unique indexes fire.
create or replace function public.kaidra_battle_create(target_conversation uuid,target_user uuid,topic text,stance text,context jsonb default '{}',request_id uuid default gen_random_uuid())
returns uuid language plpgsql security definer set search_path='' as $$
declare existing public.battles; bid uuid; conflict_detail text;
begin
 if auth.uid() is null or not public.kaidra_can_send_message(target_conversation)
 or not public.kaidra_pair_allowed(auth.uid(),target_user)
 or (not public.kaidra_friends(auth.uid(),target_user) and not exists(select 1 from public.conversations where id=target_conversation and is_group))
 or not exists(select 1 from public.conversation_participants where conversation_id=target_conversation and user_id=target_user)
 then raise exception 'Challenge a friend in this conversation';end if;
 if not exists(select 1 from public.battle_identities where user_id=auth.uid()) then raise exception 'Awaken your battle identity before challenging';end if;
 if request_id is null then raise exception 'A challenge request ID is required';end if;
 if context is null or jsonb_typeof(context)<>'object' or coalesce(context->>'entry_type','direct') not in('direct','discussion') then raise exception 'Create a friendly duel or a Discussion challenge';end if;
 -- All creation paths take the pair lock before the conversation lock. This
 -- serializes cross-chat requests as well as the existing per-chat guard.
 perform pg_advisory_xact_lock(hashtextextended('kaidra:battle:'||least(auth.uid(),target_user)::text||greatest(auth.uid(),target_user)::text,0));
 perform 1 from public.conversations where id=target_conversation for update;
 select * into existing from public.battles where id=request_id;
 if found then
  if existing.challenger_id=auth.uid() and existing.challenged_id=target_user and existing.conversation_id=target_conversation
   and existing.type=coalesce(context->>'entry_type','direct')
   and (existing.type<>'discussion' or existing.discussion_message_id::text=context->>'discussion_message_id')
   and (existing.type<>'direct' or coalesce(existing.flavour_text,'')=coalesce(topic,'')) then return request_id;end if;
  raise exception 'This challenge request was already used. Start a new challenge';
 end if;
 perform public.kaidra_expire_conversation(target_conversation);
 -- A stale invitation in another chat must not occupy the global pair index.
 for bid in select id from public.battles where combat_version=1 and status='pending' and created_at<=now()-interval '10 minutes'
  and least(challenger_id,challenged_id)=least(auth.uid(),target_user) and greatest(challenger_id,challenged_id)=greatest(auth.uid(),target_user)
 loop perform public.kaidra_combat_expire(bid);end loop;
 select * into existing from public.battles where status in('pending','active')
  and (conversation_id=target_conversation and combat_version=1
   or least(challenger_id,challenged_id)=least(auth.uid(),target_user) and greatest(challenger_id,challenged_id)=greatest(auth.uid(),target_user)
    and (combat_version=1 or status='pending' or ends_at is null or ends_at>now()))
 order by created_at,id limit 1;
 if found then
  conflict_detail:=case when public.kaidra_battle_visible(existing.id) then jsonb_build_object('battle_id',existing.id)::text else '{}' end;
  if existing.conversation_id=target_conversation then
   raise exception using message='This conversation already has an open battle. Open it to respond, cancel or finish it',detail=conflict_detail;
  else
   raise exception using message='You already have an open battle with this person in another chat. Open it to respond, cancel or finish it',detail=conflict_detail;
  end if;
 end if;
 return public.kaidra_battle_create_preexpiry(target_conversation,target_user,topic,stance,context,request_id);
end $$;
create or replace function public.kaidra_battle_action(target_battle uuid,action text,value text default '')
returns void language plpgsql security definer set search_path='' as $$declare b public.battles;begin
 if not public.kaidra_battle_visible(target_battle) then raise exception 'Conversation membership required';end if;
 if action='close_legacy' then
  select * into b from public.battles where id=target_battle for update;
  if b.combat_version<>0 or b.type<>'direct' or auth.uid() not in(b.challenger_id,b.challenged_id) then raise exception 'Only a participant can close an old direct challenge';end if;
  if b.status in('pending','active') then update public.battles set status='cancelled' where id=b.id;end if;
  return;
 end if;
 if public.kaidra_combat_expire(target_battle) then return;end if;
 perform public.kaidra_battle_action_preexpiry(target_battle,action,value);
end $$;
-- CREATE OR REPLACE preserves the existing auth-only grants and private helpers.
notify pgrst,'reload schema';
commit;
