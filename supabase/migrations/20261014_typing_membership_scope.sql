begin;
-- Realtime authorization is cached for a channel connection. Rotate the private
-- topic on membership changes so a removed client cannot hear future typing.
alter table public.conversations add column typing_revision bigint not null default 1;
create function public.kaidra_typing_membership() returns trigger language plpgsql security definer set search_path='' as $$begin
 update public.conversations set typing_revision=typing_revision+1 where id=case when tg_op='DELETE' then old.conversation_id else new.conversation_id end;
 return null;
end $$;
create trigger kaidra_typing_membership after insert or delete on public.conversation_participants for each row execute function public.kaidra_typing_membership();
revoke all on function public.kaidra_typing_membership() from public,anon,authenticated;
create or replace function public.kaidra_typing_topic(topic text) returns boolean language plpgsql stable security definer set search_path='' as $$declare cid uuid;revision bigint;begin
 if topic !~ '^typing:[0-9a-fA-F-]{36}:[0-9]{1,18}$' then return false;end if;
 cid:=split_part(topic,':',2)::uuid;revision:=split_part(topic,':',3)::bigint;
 return public.kaidra_is_conversation_member(cid) and exists(select 1 from public.conversations where id=cid and typing_revision=revision);
exception when invalid_text_representation or numeric_value_out_of_range then return false;end $$;
-- Serialize authorization and edits against membership changes and vote locks.
create or replace function public.kaidra_discussion_position(target_message uuid,choice text) returns void language plpgsql security definer set search_path='' as $$
declare m public.messages;uid uuid;cid uuid;begin
 select conversation_id into cid from public.messages where id=target_message;perform public.kaidra_lock_send(cid);
 select * into m from public.messages where id=target_message for update;
 if m.id is null or m.message_type<>'discussion' or m.deleted_at is not null or m.sender_id=auth.uid() then raise exception 'Only other conversation members may take a side';end if;
 if choice is null then delete from public.discussion_positions where discussion_message_id=m.id and user_id=auth.uid();
 elsif choice in('agree','disagree') then
 insert into public.discussion_positions(discussion_message_id,user_id,conversation_id,position) values(m.id,auth.uid(),m.conversation_id,choice) on conflict(discussion_message_id,user_id) do update set position=excluded.position,updated_at=now();
 update public.messages set discussion_locked_at=coalesce(discussion_locked_at,now()) where id=m.id;
 else raise exception 'Choose Agree or Disagree';end if;
 for uid in select user_id from public.conversation_participants where conversation_id=m.conversation_id loop
 insert into public.chat_signals(user_id,conversation_id,reason,updated_at) values(uid,m.conversation_id,'discussion',clock_timestamp()) on conflict(user_id,conversation_id) do update set reason=excluded.reason,updated_at=excluded.updated_at;
 end loop;
end $$;
notify pgrst,'reload schema';
commit;
