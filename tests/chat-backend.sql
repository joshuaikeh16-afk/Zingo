-- Run after the 20261003–20261006 migrations. All fixtures roll back.
begin;
do $$
declare
 actor uuid:=gen_random_uuid(); friend_a uuid:=gen_random_uuid(); friend_b uuid:=gen_random_uuid(); outsider uuid:=gen_random_uuid();
 group_a uuid; group_b uuid; direct_id uuid; boundary uuid; last_id uuid; stamp timestamptz; remaining integer; total integer; successor uuid;
begin
 insert into auth.users(id,email) values(actor,actor::text||'@example.invalid'),(friend_a,friend_a::text||'@example.invalid'),(friend_b,friend_b::text||'@example.invalid'),(outsider,outsider::text||'@example.invalid');
 insert into public.profiles(id,username,display_name) values(actor,'qa_'||left(replace(actor::text,'-',''),20),'QA Actor'),(friend_a,'qa_'||left(replace(friend_a::text,'-',''),20),'QA A'),(friend_b,'qa_'||left(replace(friend_b::text,'-',''),20),'QA B'),(outsider,'qa_'||left(replace(outsider::text,'-',''),20),'QA Outsider') on conflict(id) do nothing;
 insert into public.friend_requests(requester_id,target_id,status) values(actor,friend_a,'accepted'),(actor,friend_b,'accepted');
 perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
 execute 'set local role authenticated';
 group_a:=public.kaidra_create_group('QA recommendations',array[friend_a,friend_b]);
 group_b:=public.kaidra_create_group('QA two people',array[friend_a]);
 direct_id:=public.get_or_create_conversation(friend_a);
 if direct_id in (group_a,group_b) then raise exception 'DM returned an existing group'; end if;
 if public.get_or_create_conversation(friend_a)<>direct_id then raise exception 'DM retry created a duplicate'; end if;
 perform public.kaidra_add_group_members(group_b,array[friend_b,friend_b]);
 if (select count(*) from public.conversation_participants where conversation_id=group_b)<>3 then raise exception 'Duplicate member IDs changed group size'; end if;
 begin
  perform public.kaidra_create_group('Invalid',array[outsider]);
  raise exception using errcode='XX000',message='Nonfriend was added to a group';
 exception when raise_exception then
  if sqlerrm<>'Only your friends can be added' then raise; end if;
 end;

 perform set_config('request.jwt.claims',jsonb_build_object('sub',friend_a,'role','authenticated')::text,true);
 for i in 1..7 loop
  stamp:=clock_timestamp();
  insert into public.messages(conversation_id,sender_id,content,created_at) values(group_a,friend_a,'QA pick '||i,stamp) returning id into last_id;
  if i=3 then boundary:=last_id; end if;
 end loop;
 for i in 1..3 loop insert into public.messages(conversation_id,sender_id,content) values(group_b,friend_a,'QA news '||i); end loop;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
 select sum((entry->>'unreadCount')::integer) into total from jsonb_array_elements(public.kaidra_inbox()) entry;
 if total<>10 then raise exception 'Expected 7+3=10 unread messages, got %',total; end if;
 select created_at into stamp from public.messages where id=boundary;
 perform public.kaidra_mark_read(group_a,stamp,boundary);
 select (entry->>'unreadCount')::integer into remaining from jsonb_array_elements(public.kaidra_inbox()) entry where entry->>'conversationId'=group_a::text;
 if remaining<>4 then raise exception 'Read boundary consumed unseen messages'; end if;
 select created_at into stamp from public.messages where id=last_id;
 perform public.kaidra_mark_read(group_a,stamp,last_id);
 perform public.kaidra_mark_read(group_a,stamp,last_id);
 select sum((entry->>'unreadCount')::integer) into total from jsonb_array_elements(public.kaidra_inbox()) entry;
 if total<>3 then raise exception 'Opening a chat did not clear its individual unread messages'; end if;
 if (select count(*) from public.message_reads r join public.messages m on m.id=r.message_id where r.conversation_id=group_a and r.user_id=actor and m.message_type<>'system')<>7 then raise exception 'Read retry duplicated receipts'; end if;
 perform public.kaidra_react(last_id,'❤️');
 perform public.kaidra_react(last_id,'❤️');
 if exists(select 1 from public.message_reactions where message_id=last_id and user_id=actor and emoji is not null) then raise exception 'Reaction toggle failed'; end if;
 perform public.kaidra_react(last_id,'👍');

 perform set_config('request.jwt.claims',jsonb_build_object('sub',friend_b,'role','authenticated')::text,true);
 select (entry->>'unreadCount')::integer into remaining from jsonb_array_elements(public.kaidra_inbox()) entry where entry->>'conversationId'=group_a::text;
 if remaining<>7 then raise exception 'One person marked the group read for everyone'; end if;
 begin
  perform public.kaidra_add_group_members(group_a,array[outsider]);
  raise exception using errcode='XX000',message='Noncreator changed membership';
 exception when raise_exception then
  if sqlerrm<>'Only admins can add people' then raise; end if;
 end;
 perform public.kaidra_leave_group(group_a);
 if exists(select 1 from public.messages where conversation_id=group_a) then raise exception 'Former member retained message access'; end if;

 perform set_config('request.jwt.claims',jsonb_build_object('sub',outsider,'role','authenticated')::text,true);
 if exists(select 1 from public.messages where conversation_id in (group_a,group_b,direct_id)) or exists(select 1 from public.conversation_participants where conversation_id in (group_a,group_b,direct_id)) then raise exception 'Nonmember can read private chat data'; end if;
 if jsonb_array_length(public.kaidra_inbox())<>0 then raise exception 'Nonmember inbox leaked conversations'; end if;
 begin
  perform public.kaidra_chat_state(group_a);
  raise exception using errcode='XX000',message='Nonmember accessed group state';
 exception when raise_exception then
  if sqlerrm<>'Membership required' then raise; end if;
 end;
 begin
  insert into public.messages(conversation_id,sender_id,content) values(group_a,outsider,'Forbidden');
  raise exception using errcode='XX000',message='Nonmember sent a message';
 exception when insufficient_privilege then null; when raise_exception then if sqlerrm<>'You cannot send messages in this conversation' then raise; end if;
 end;

 perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
 perform public.kaidra_group_action(group_a,'transfer',friend_a);
 perform public.kaidra_leave_group(group_a);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',friend_a,'role','authenticated')::text,true);
 select created_by into successor from public.conversations where id=group_a;
 if successor is distinct from friend_a then raise exception 'Leaving creator did not transfer ownership'; end if;
 execute 'reset role';
end;
$$;
rollback;
