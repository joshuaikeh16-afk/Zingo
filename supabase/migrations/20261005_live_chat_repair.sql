-- Apply after 20261003 and 20261004. Preserves existing chats and media.
begin;

alter table public.message_reads add column if not exists conversation_id uuid references public.conversations(id) on delete cascade;
update public.message_reads r set conversation_id=m.conversation_id from public.messages m where m.id=r.message_id and r.conversation_id is null;
alter table public.message_reads alter column conversation_id set not null;
create index if not exists message_reads_user_message_idx on public.message_reads(user_id,message_id);
create index if not exists message_reads_conversation_idx on public.message_reads(conversation_id);

-- Keep existing DM read markers and use separate receipts for every group member.
insert into public.message_reads(message_id,user_id,conversation_id,read_at)
select m.id,cp.user_id,m.conversation_id,m.read_at from public.messages m
join public.conversations c on c.id=m.conversation_id and not c.is_group
join public.conversation_participants cp on cp.conversation_id=m.conversation_id and cp.user_id<>m.sender_id
where m.read_at is not null on conflict do nothing;

drop function if exists public.kaidra_mark_read(uuid);
create or replace function public.kaidra_mark_read(target_conversation uuid, through_created_at timestamptz default null, through_message uuid default null)
returns void language plpgsql security definer set search_path = '' as $$
declare boundary public.messages;
begin
  if not public.kaidra_is_conversation_member(target_conversation) then raise exception 'Membership required'; end if;
  if through_message is not null then
    select * into boundary from public.messages where id=through_message and conversation_id=target_conversation;
    if not found or boundary.created_at is distinct from through_created_at then raise exception 'Invalid read boundary'; end if;
  else
    select * into boundary from public.messages where conversation_id=target_conversation order by created_at desc,id desc limit 1;
    if not found then return; end if;
  end if;
  insert into public.message_reads(message_id,user_id,conversation_id)
  select m.id,auth.uid(),m.conversation_id from public.messages m
  where m.conversation_id=target_conversation and m.sender_id<>auth.uid()
    and (m.created_at,m.id)<=(boundary.created_at,boundary.id)
    and not exists(select 1 from public.message_reads r where r.message_id=m.id and r.user_id=auth.uid())
  on conflict do nothing;
  if not exists(select 1 from public.conversations where id=target_conversation and is_group) then
    update public.messages set read_at=now() where conversation_id=target_conversation and sender_id<>auth.uid()
      and read_at is null and (created_at,id)<=(boundary.created_at,boundary.id);
  end if;
end;
$$;
revoke all on function public.kaidra_mark_read(uuid,timestamptz,uuid) from public,anon;
grant execute on function public.kaidra_mark_read(uuid,timestamptz,uuid) to authenticated;

create or replace function public.kaidra_inbox()
returns jsonb language sql stable security definer set search_path = '' as $$
 select coalesce(jsonb_agg(entry order by sent_at desc nulls last,conversation_id),'[]'::jsonb) from (
  select c.id as conversation_id,last_msg.created_at as sent_at,jsonb_build_object(
   'conversationId',c.id,'isGroup',c.is_group,'title',c.title,'createdBy',c.created_by,
   'profile',case when c.is_group then jsonb_build_object('id',c.id,'display_name',c.title,'username','group') else
    (select jsonb_build_object('id',p.id,'username',p.username,'display_name',p.display_name,'avatar_url',p.avatar_url)
     from public.conversation_participants cp join public.profiles p on p.id=cp.user_id
     where cp.conversation_id=c.id and cp.user_id<>auth.uid() limit 1) end,
   'lastMessage',to_jsonb(last_msg),
   'unreadCount',(select count(*) from public.messages m where m.conversation_id=c.id and m.sender_id<>auth.uid()
    and not exists(select 1 from public.message_reads r where r.message_id=m.id and r.user_id=auth.uid())
    and (c.is_group or m.read_at is null))) as entry
  from public.conversations c join public.conversation_participants mine on mine.conversation_id=c.id and mine.user_id=auth.uid()
  left join lateral(select * from public.messages where conversation_id=c.id order by created_at desc,id desc limit 1) last_msg on true
 ) records;
$$;

-- Limit interaction data to the messages actually loaded by the client.
drop function if exists public.kaidra_chat_state(uuid);
create or replace function public.kaidra_chat_state(target_conversation uuid, message_ids uuid[] default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare selected_ids uuid[];
begin
 if not public.kaidra_is_conversation_member(target_conversation) then raise exception 'Membership required'; end if;
 if coalesce(cardinality(message_ids),0)>1000 then raise exception 'Too many message IDs'; end if;
 select array_agg(id) into selected_ids from (select id from public.messages
  where conversation_id=target_conversation and (message_ids is null or id=any(message_ids))
  order by created_at desc,id desc limit 1000) loaded;
 return jsonb_build_object(
  'conversation',(select to_jsonb(c) from public.conversations c where id=target_conversation),
  'members',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'username',p.username,'display_name',p.display_name,'avatar_url',p.avatar_url))
    from public.conversation_participants cp join public.profiles p on p.id=cp.user_id where cp.conversation_id=target_conversation),'[]'::jsonb),
  'reactions',coalesce((select jsonb_agg(to_jsonb(r)) from public.message_reactions r where r.conversation_id=target_conversation and r.message_id=any(selected_ids) and r.emoji is not null),'[]'::jsonb),
  'reads',coalesce((select jsonb_agg(to_jsonb(r)) from public.message_reads r where r.conversation_id=target_conversation and r.message_id=any(selected_ids)),'[]'::jsonb));
end;
$$;
revoke all on function public.kaidra_chat_state(uuid,uuid[]) from public,anon;
grant execute on function public.kaidra_chat_state(uuid,uuid[]) to authenticated;

-- Serialize membership changes and count unique new people, not duplicate IDs.
create or replace function public.kaidra_add_group_members(target_conversation uuid, member_ids uuid[])
returns void language plpgsql security definer set search_path = '' as $$
declare actor uuid:=auth.uid(); member uuid; additions uuid[]; count_members integer;
begin
 perform 1 from public.conversations where id=target_conversation and is_group and created_by=actor for update;
 if not found or not public.kaidra_is_conversation_member(target_conversation) then raise exception 'Only the group creator can add people'; end if;
 select array_agg(distinct id) into additions from unnest(member_ids) id where id is not null
  and not exists(select 1 from public.conversation_participants cp where cp.conversation_id=target_conversation and cp.user_id=id);
 select count(*) into count_members from public.conversation_participants where conversation_id=target_conversation;
 if count_members+coalesce(cardinality(additions),0)>50 then raise exception 'Groups support up to 50 members'; end if;
 if additions is null then return; end if;
 foreach member in array additions loop
  if not exists(select 1 from public.friend_requests where status='accepted' and
   ((requester_id=actor and target_id=member) or (requester_id=member and target_id=actor))) then raise exception 'Only your friends can be added'; end if;
  insert into public.conversation_participants(conversation_id,user_id) values(target_conversation,member) on conflict do nothing;
 end loop;
end;
$$;

-- A shared group must never be returned when opening a direct conversation.
create or replace function public.get_or_create_conversation(other_user_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare actor uuid:=auth.uid(); result uuid;
begin
 if actor is null or other_user_id is null or actor=other_user_id then raise exception 'Choose another user'; end if;
 perform pg_advisory_xact_lock(hashtextextended(least(actor::text,other_user_id::text)||':'||greatest(actor::text,other_user_id::text),0));
 select c.id into result from public.conversations c
 join public.conversation_participants mine on mine.conversation_id=c.id and mine.user_id=actor
 join public.conversation_participants peer on peer.conversation_id=c.id and peer.user_id=other_user_id
 where not c.is_group and (select count(*) from public.conversation_participants where conversation_id=c.id)=2
 order by c.created_at,c.id limit 1;
 if result is not null then return result; end if;
 if not exists(select 1 from public.friend_requests where status='accepted' and
  ((requester_id=actor and target_id=other_user_id) or (requester_id=other_user_id and target_id=actor))) then raise exception 'Friendship required'; end if;
 if exists(select 1 from public.user_preferences where user_id=other_user_id and not allow_dms) then raise exception 'Direct messages are disabled'; end if;
 insert into public.conversations default values returning id into result;
 insert into public.conversation_participants(conversation_id,user_id) values(result,actor),(result,other_user_id);
 return result;
end;
$$;
revoke all on function public.get_or_create_conversation(uuid) from public,anon;
grant execute on function public.get_or_create_conversation(uuid) to authenticated;

-- Older permissive policies cannot expose rows to nonmembers.
drop policy if exists "Kaidra restrict conversation visibility" on public.conversations;
create policy "Kaidra restrict conversation visibility" on public.conversations as restrictive for select to authenticated using(public.kaidra_is_conversation_member(id));
drop policy if exists "Kaidra restrict membership visibility" on public.conversation_participants;
create policy "Kaidra restrict membership visibility" on public.conversation_participants as restrictive for select to authenticated using(public.kaidra_is_conversation_member(conversation_id));
grant select on public.conversations,public.conversation_participants to authenticated;
grant select,insert on public.messages to authenticated;
grant update(read_at) on public.messages to authenticated;

create or replace function public.kaidra_validate_message()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
 if new.message_type in ('text','voice_note') and new.external_ref_id is not null and not exists(
  select 1 from public.messages where id::text=new.external_ref_id and conversation_id=new.conversation_id
 ) then raise exception 'Reply must refer to this conversation'; end if;
 if new.message_type='voice_note' then
  if coalesce(new.media_url,new.content,'') !~ ('^'||new.conversation_id::text||'/[a-zA-Z0-9_-]+\.(webm|ogg|m4a|mp4|wav)$')
   or new.media_duration_seconds is null or new.media_duration_seconds not between 1 and 180 then raise exception 'Invalid voice note'; end if;
 end if;
 return new;
end;
$$;
drop trigger if exists kaidra_validate_message on public.messages;
create trigger kaidra_validate_message before insert on public.messages for each row execute function public.kaidra_validate_message();
revoke all on function public.kaidra_validate_message() from public,anon,authenticated;

-- Private voice recordings: original files remain available to conversation members.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('voice-notes','voice-notes',false,10485760,array['audio/webm','audio/ogg','audio/mp4','audio/wav','audio/x-wav'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

do $$
declare table_name text;
begin
 foreach table_name in array array['messages','message_reactions','message_reads','conversation_participants','friend_requests','app_notifications'] loop
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=table_name) then
   execute format('alter publication supabase_realtime add table public.%I',table_name);
  end if;
 end loop;
end;
$$;
notify pgrst,'reload schema';
commit;
