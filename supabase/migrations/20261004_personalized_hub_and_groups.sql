begin;
alter table public.profiles add column if not exists recommendation_preferences jsonb not null default '{}'::jsonb;
alter table public.conversations
  add column if not exists is_group boolean not null default false,
  add column if not exists title text,
  add column if not exists created_by uuid references auth.users(id) on delete set null;
alter table public.messages
  add column if not exists shared_content jsonb;
alter table public.messages drop constraint if exists kaidra_shared_content_shape;
alter table public.messages add constraint kaidra_shared_content_shape check (
  shared_content is null or (jsonb_typeof(shared_content) = 'object' and octet_length(shared_content::text) < 20000
    and coalesce(shared_content->>'kind' in ('movie','tv','match','article') and length(shared_content->>'title') between 1 and 300, false))
);

-- Member reads use a definer helper to avoid recursive participant policies.
alter table public.conversations enable row level security;
alter table public.conversation_participants enable row level security;
drop policy if exists "Kaidra read own conversations" on public.conversations;
create policy "Kaidra read own conversations" on public.conversations for select to authenticated using (public.kaidra_is_conversation_member(id));
drop policy if exists "Kaidra read conversation members" on public.conversation_participants;
create policy "Kaidra read conversation members" on public.conversation_participants for select to authenticated using (public.kaidra_is_conversation_member(conversation_id));

create table if not exists public.message_reactions (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  emoji text check (emoji is null or emoji in ('❤️','😂','🔥','😮','👏','⚽','👍')),
  unique(message_id,user_id)
);
create table if not exists public.message_reads (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key(message_id,user_id)
);
-- Older projects already have reactions without a conversation column.
alter table public.message_reactions add column if not exists conversation_id uuid references public.conversations(id) on delete cascade;
update public.message_reactions r set conversation_id=m.conversation_id from public.messages m where m.id=r.message_id and r.conversation_id is null;
alter table public.message_reactions alter column conversation_id set not null;
alter table public.message_reactions alter column emoji drop not null;
alter table public.message_reactions enable row level security;
alter table public.message_reads enable row level security;
create index if not exists message_reactions_conversation_idx on public.message_reactions(conversation_id);
drop policy if exists "Members read reactions" on public.message_reactions;
create policy "Members read reactions" on public.message_reactions for select to authenticated using (public.kaidra_is_conversation_member(conversation_id));
drop policy if exists "Members read receipts" on public.message_reads;
create policy "Members read receipts" on public.message_reads for select to authenticated using (
  exists(select 1 from public.messages m where m.id = message_id and public.kaidra_is_conversation_member(m.conversation_id))
);
revoke all on public.message_reactions, public.message_reads from anon, authenticated;
grant select on public.message_reactions, public.message_reads to authenticated;

create or replace function public.kaidra_create_group(group_title text, member_ids uuid[])
returns uuid language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); result uuid; member uuid; members uuid[];
begin
  if actor is null then raise exception 'Sign in required'; end if;
  if group_title is null or length(trim(group_title)) not between 1 and 80 then raise exception 'Give your group a name (1–80 characters)'; end if;
  select array_agg(distinct id) into members from unnest(member_ids) id where id <> actor;
  if coalesce(cardinality(members),0) not between 1 and 49 then raise exception 'Choose 1–49 friends'; end if;
  foreach member in array members loop
    if not exists(select 1 from public.friend_requests where status='accepted' and
      ((requester_id=actor and target_id=member) or (requester_id=member and target_id=actor))) then raise exception 'Only your friends can be added'; end if;
  end loop;
  insert into public.conversations(is_group,title,created_by) values (true,trim(group_title),actor) returning id into result;
  insert into public.conversation_participants(conversation_id,user_id) values (result,actor);
  insert into public.conversation_participants(conversation_id,user_id) select result, unnest(members);
  return result;
end;
$$;
create or replace function public.kaidra_add_group_members(target_conversation uuid, member_ids uuid[])
returns void language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); member uuid; count_members integer;
begin
  perform 1 from public.conversations where id=target_conversation and is_group and created_by=actor for update;
  if not found or not public.kaidra_is_conversation_member(target_conversation) then raise exception 'Only the group creator can add people'; end if;
  select count(*) into count_members from public.conversation_participants where conversation_id=target_conversation;
  if count_members + coalesce(cardinality(member_ids),0)>50 then raise exception 'Groups support up to 50 members'; end if;
  foreach member in array member_ids loop
    if not exists(select 1 from public.friend_requests where status='accepted' and
      ((requester_id=actor and target_id=member) or (requester_id=member and target_id=actor))) then raise exception 'Only your friends can be added'; end if;
    insert into public.conversation_participants(conversation_id,user_id) values(target_conversation,member) on conflict do nothing;
  end loop;
end;
$$;
create or replace function public.kaidra_leave_group(target_conversation uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); successor uuid;
begin
  perform 1 from public.conversations where id=target_conversation and is_group for update;
  if not found or not public.kaidra_is_conversation_member(target_conversation) then raise exception 'Group membership required'; end if;
  delete from public.conversation_participants where conversation_id=target_conversation and user_id=actor;
  select user_id into successor from public.conversation_participants where conversation_id=target_conversation order by user_id limit 1;
  update public.conversations set created_by=successor where id=target_conversation and created_by=actor;
end;
$$;
create or replace function public.kaidra_react(target_message uuid, reaction text)
returns void language plpgsql security definer set search_path = '' as $$
declare conversation uuid; existing_id uuid;
begin
  select conversation_id into conversation from public.messages where id=target_message;
  if not public.kaidra_is_conversation_member(conversation) then raise exception 'Membership required'; end if;
  if reaction is null or reaction not in ('❤️','😂','🔥','😮','👏','⚽','👍') then raise exception 'Invalid reaction'; end if;
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
create or replace function public.kaidra_mark_read(target_conversation uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.kaidra_is_conversation_member(target_conversation) then raise exception 'Membership required'; end if;
  insert into public.message_reads(message_id,user_id)
  select id,auth.uid() from public.messages where conversation_id=target_conversation and sender_id<>auth.uid() on conflict do nothing;
  -- Direct messages retain the existing read_at contract. Groups use individual receipts.
  if not exists(select 1 from public.conversations where id=target_conversation and is_group) then
    update public.messages set read_at=now() where conversation_id=target_conversation and sender_id<>auth.uid() and read_at is null;
  end if;
end;
$$;
create or replace function public.kaidra_chat_state(target_conversation uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare result jsonb;
begin
  if not public.kaidra_is_conversation_member(target_conversation) then raise exception 'Membership required'; end if;
  select jsonb_build_object(
    'conversation',(select to_jsonb(c) from public.conversations c where id=target_conversation),
    'members',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'username',p.username,'display_name',p.display_name,'avatar_url',p.avatar_url,'isCreator',p.id=(select created_by from public.conversations where id=target_conversation)))
      from public.conversation_participants cp join public.profiles p on p.id=cp.user_id where cp.conversation_id=target_conversation),'[]'::jsonb),
    'reactions',coalesce((select jsonb_agg(to_jsonb(r)) from public.message_reactions r where conversation_id=target_conversation and emoji is not null),'[]'::jsonb),
    'reads',coalesce((select jsonb_agg(to_jsonb(r)) from public.message_reads r join public.messages m on m.id=r.message_id where m.conversation_id=target_conversation),'[]'::jsonb)
  ) into result;
  return result;
end;
$$;
create or replace function public.kaidra_inbox()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(entry order by sent_at desc nulls last),'[]'::jsonb) from (
    select last_msg.created_at as sent_at,jsonb_build_object('conversationId',c.id,'isGroup',c.is_group,'title',c.title,'createdBy',c.created_by,
      'profile',case when c.is_group then jsonb_build_object('id',c.id,'display_name',c.title,'username','group') else
        (select jsonb_build_object('id',p.id,'username',p.username,'display_name',p.display_name,'avatar_url',p.avatar_url) from public.conversation_participants cp join public.profiles p on p.id=cp.user_id where cp.conversation_id=c.id and cp.user_id<>auth.uid() limit 1) end,
      'lastMessage',to_jsonb(last_msg),
      'unreadCount',(select count(*) from public.messages m where m.conversation_id=c.id and m.sender_id<>auth.uid() and
        case when c.is_group then not exists(select 1 from public.message_reads r where r.message_id=m.id and r.user_id=auth.uid()) else m.read_at is null end)
    ) as entry from public.conversations c
    join public.conversation_participants mine on mine.conversation_id=c.id and mine.user_id=auth.uid()
    left join lateral (select * from public.messages where conversation_id=c.id order by created_at desc,id desc limit 1) last_msg on true
  ) records;
$$;
-- DM preferences govern direct chats; participating in a group is its own opt-in.
create or replace function public.kaidra_can_send_message(target_conversation uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.kaidra_is_conversation_member(target_conversation) and (
    exists(select 1 from public.conversations where id=target_conversation and is_group) or not exists (
      select 1 from public.conversation_participants cp join public.user_preferences p on p.user_id=cp.user_id
      where cp.conversation_id=target_conversation and cp.user_id<>auth.uid() and not p.allow_dms
    )
  );
$$;
do $$
declare signature text;
begin
  foreach signature in array array['kaidra_create_group(text,uuid[])','kaidra_add_group_members(uuid,uuid[])','kaidra_leave_group(uuid)','kaidra_react(uuid,text)','kaidra_mark_read(uuid)','kaidra_chat_state(uuid)','kaidra_inbox()'] loop
    execute 'revoke all on function public.' || signature || ' from public, anon';
    execute 'grant execute on function public.' || signature || ' to authenticated';
  end loop;
end;
$$;
do $$
begin
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='message_reactions') then
    alter publication supabase_realtime add table public.message_reactions;
  end if;
end;
$$;
commit;
