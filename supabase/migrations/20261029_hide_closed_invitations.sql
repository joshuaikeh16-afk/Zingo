begin;
-- Remove invitation cards and alerts when an unplayed challenge closes.
-- Battle attempts remain for abuse limits; completed battles and rewards are untouched.
create function public.kaidra_remove_closed_invitation() returns trigger language plpgsql security definer set search_path='' as $$
declare uid uuid;
begin
 if new.status not in('expired','cancelled','declined') or new.status is not distinct from old.status then return null;end if;
 delete from public.messages where conversation_id=new.conversation_id and message_type='system'
  and event_data->>'kind'='battle' and event_data->>'battle_id'=new.id::text;
 delete from public.app_notifications where category='battle' and payload->>'battle_id'=new.id::text;
 for uid in select user_id from public.conversation_participants where conversation_id=new.conversation_id loop
  perform public.kaidra_social_signal(uid);
 end loop;
 return null;
end $$;
create trigger zz_kaidra_remove_closed_invitation after update of status on public.battles
 for each row execute function public.kaidra_remove_closed_invitation();
revoke all on function public.kaidra_remove_closed_invitation() from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
