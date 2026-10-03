begin;
do $$
declare uid uuid:=gen_random_uuid(); other_id uuid:=gen_random_uuid(); cid uuid; original uuid; reply uuid; mention uuid;
begin
 insert into auth.users(id,email) values(uid,uid||'@example.invalid'),(other_id,other_id||'@example.invalid');
 insert into public.profiles(id,username,display_name) values(uid,'qa_'||substr(replace(uid::text,'-',''),1,18),'QA'),(other_id,'qa_'||substr(replace(other_id::text,'-',''),1,18),'QA other');
 insert into public.friend_requests(requester_id,target_id,status) values(uid,other_id,'accepted');
 perform set_config('request.jwt.claims',jsonb_build_object('sub',uid,'role','authenticated')::text,true);execute 'set local role authenticated';
 perform public.kaidra_library_save('{"provider":"mal","kind":"movie","id":1,"title":"Legacy title"}','favorites',true);
 perform public.kaidra_library_save('{"provider":"tmdb","kind":"movie","id":1,"title":"Movie"}','watchlist',true);
 if (select count(*) from public.user_watchlist where user_id=uid and external_id='1')<>2 then raise exception 'Provider identities collided'; end if;
 cid:=public.kaidra_create_group('QA',array[other_id]);
 insert into public.messages(conversation_id,sender_id,content) values(cid,uid,'Original') returning id into original;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',other_id,'role','authenticated')::text,true);
 insert into public.messages(conversation_id,sender_id,content,external_ref_id) values(cid,other_id,'Reply',original::text) returning id into reply;
 insert into public.messages(conversation_id,sender_id,content,mention_ids) values(cid,other_id,'Mention',array[uid]) returning id into mention;
 if not exists(select 1 from public.messages where id=mention and mention_labels->0->>'user_id'=uid::text) then raise exception 'Mention identity snapshot missing'; end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',uid,'role','authenticated')::text,true);
 if not exists(select 1 from public.message_mentions where message_id=reply and user_id=uid) then raise exception 'Reply recipient not notified'; end if;
 execute 'reset role';
end $$;
rollback;
