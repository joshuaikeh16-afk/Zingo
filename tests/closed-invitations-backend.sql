begin;
do $$declare a uuid:=gen_random_uuid();b uuid:=gen_random_uuid();cid uuid;bid uuid;visible integer;begin
 insert into auth.users(id,email,created_at) select u,u||'@example.invalid',now()-interval '30 days' from unnest(array[a,b]) u;
 insert into public.profiles(id,username,display_name) select u,'qa_'||left(replace(u::text,'-',''),16),'QA inbox' from unnest(array[a,b]) u;
 insert into public.battle_identities(user_id,class_id,determination_version) values(a,'warrior',1),(b,'ninja',1);
 insert into public.friend_requests(requester_id,target_id,status) values(a,b,'accepted');
 perform set_config('request.jwt.claims',jsonb_build_object('sub',a,'role','authenticated')::text,true);execute 'set local role authenticated';cid:=public.get_or_create_conversation(b);bid:=public.kaidra_battle_create(cid,b,'','','{"entry_type":"direct"}');
 select count(*) into visible from public.messages where event_data->>'battle_id'=bid::text;if visible<1 then raise exception 'Invitation card missing';end if;
 perform public.kaidra_battle_action(bid,'cancel');
 if exists(select 1 from public.messages where event_data->>'battle_id'=bid::text) or exists(select 1 from public.app_notifications where payload->>'battle_id'=bid::text) then raise exception 'Closed invitation still occupies the chat';end if;
 execute 'reset role';
 if not exists(select 1 from public.battle_attempts where id=bid) or exists(select 1 from public.battle_rewards where battle_id=bid) then raise exception 'Safety history or XP rule changed';end if;
end $$;
rollback;
