begin;
-- Existing active battles keep their state. Expiry never awards XP or a win/loss.
create function public.kaidra_combat_expire(target_battle uuid) returns boolean language plpgsql security definer set search_path='' as $$declare b public.battles;begin
 select * into b from public.battles where id=target_battle for update;
 if b.combat_version=1 and b.status='pending' and b.created_at<=now()-interval '10 minutes' then
 update public.battles set status='expired' where id=b.id;
 update public.battle_combat_state set phase='finished',active_id=null,deadline=null,revision=revision+1 where battle_id=b.id;
 return true;end if;return false;end $$;
create function public.kaidra_expire_conversation(target_conversation uuid) returns void language plpgsql security definer set search_path='' as $$declare bid uuid;begin
 if not public.kaidra_is_conversation_member(target_conversation) then raise exception 'Conversation membership required';end if;
 for bid in select id from public.battles where conversation_id=target_conversation and combat_version=1 and status='pending' and created_at<=now()-interval '10 minutes' loop perform public.kaidra_combat_expire(bid);end loop;
end $$;
do $$declare bid uuid;begin for bid in select id from public.battles where combat_version=1 and status='pending' and created_at<=now()-interval '10 minutes' loop perform public.kaidra_combat_expire(bid);end loop;end $$;
-- One pending OR active RPG battle per conversation, enforced across racing requests.
-- This also keeps a DM from receiving duplicate pending challenges.
create unique index battle_one_open_conversation on public.battles(conversation_id) where combat_version=1 and status in('pending','active');
alter function public.kaidra_battle_create(uuid,uuid,text,text,jsonb,uuid) rename to kaidra_battle_create_preexpiry;
revoke all on function public.kaidra_battle_create_preexpiry(uuid,uuid,text,text,jsonb,uuid) from public,anon,authenticated;
create function public.kaidra_battle_create(target_conversation uuid,target_user uuid,topic text,stance text,context jsonb default '{}',request_id uuid default gen_random_uuid()) returns uuid language plpgsql security definer set search_path='' as $$begin
 if coalesce(context->>'entry_type','direct') not in('direct','discussion') then raise exception 'Create a friendly duel or a Discussion challenge';end if;
 perform 1 from public.conversations where id=target_conversation for update;
 perform public.kaidra_expire_conversation(target_conversation);
 if exists(select 1 from public.battles where conversation_id=target_conversation and combat_version=1 and status in('pending','active') and id<>request_id) then raise exception 'This conversation already has an open battle. Finish it, cancel it, or wait for its invitation to expire';end if;
 return public.kaidra_battle_create_preexpiry(target_conversation,target_user,topic,stance,context,request_id);end $$;
alter function public.kaidra_battle_action(uuid,text,text) rename to kaidra_battle_action_preexpiry;
revoke all on function public.kaidra_battle_action_preexpiry(uuid,text,text) from public,anon,authenticated;
create function public.kaidra_battle_action(target_battle uuid,action text,value text default '') returns void language plpgsql security definer set search_path='' as $$begin
 if not public.kaidra_battle_visible(target_battle) then raise exception 'Conversation membership required';end if;
 if public.kaidra_combat_expire(target_battle) then return;end if;
 perform public.kaidra_battle_action_preexpiry(target_battle,action,value);end $$;
create function public.kaidra_battle_invitation_deadline() returns trigger language plpgsql security definer set search_path='' as $$begin
 if new.combat_version=1 and new.status='pending' then new.ends_at:=new.created_at+interval '10 minutes';end if;return new;end $$;
create trigger kaidra_battle_invitation_deadline before insert on public.battles for each row execute function public.kaidra_battle_invitation_deadline();
create function public.kaidra_combat_stop_closed() returns trigger language plpgsql security definer set search_path='' as $$begin
 if new.combat_version=1 and new.status in('cancelled','declined','expired') and new.status is distinct from old.status then
 update public.battle_combat_state set phase='finished',active_id=null,deadline=null,revision=revision+1 where battle_id=new.id and phase<>'finished';end if;return null;end $$;
create trigger kaidra_combat_stop_closed after update on public.battles for each row execute function public.kaidra_combat_stop_closed();
revoke all on function public.kaidra_combat_stop_closed() from public,anon,authenticated;
revoke all on function public.kaidra_combat_expire(uuid),public.kaidra_battle_invitation_deadline() from public,anon,authenticated;
grant execute on function public.kaidra_combat_expire(uuid) to service_role;
revoke all on function public.kaidra_expire_conversation(uuid),public.kaidra_battle_create(uuid,uuid,text,text,jsonb,uuid),public.kaidra_battle_action(uuid,text,text) from public,anon;
grant execute on function public.kaidra_expire_conversation(uuid),public.kaidra_battle_create(uuid,uuid,text,text,jsonb,uuid),public.kaidra_battle_action(uuid,text,text) to authenticated;
notify pgrst,'reload schema';
commit;
