begin;
create function pg_temp.assert_ok(ok boolean,label text) returns void language plpgsql as $$begin if ok is distinct from true then raise exception '%',label;end if;end $$;
create function pg_temp.denied(statement text) returns void language plpgsql as $$begin begin execute statement;exception when insufficient_privilege or raise_exception then return;end;raise exception using errcode='XX000',message='Unexpected permission: '||statement;end $$;
do $$declare a uuid:=gen_random_uuid();b uuid:=gen_random_uuid();cid uuid;bid uuid;sequence integer;winner uuid;begin
 insert into auth.users(id,email,created_at) select id,id||'@example.invalid',now()-interval '30 days' from unnest(array[a,b]) id;
 insert into public.profiles(id,username,display_name) select id,'qa_'||left(replace(id::text,'-',''),20),'QA battle' from unnest(array[a,b]) id;
 insert into public.friend_requests(requester_id,target_id,status) values(a,b,'accepted');
 perform set_config('request.jwt.claims',jsonb_build_object('sub',a,'role','authenticated')::text,true);execute 'set local role authenticated';
 cid:=public.get_or_create_conversation(b);execute 'reset role';
 for sequence in 1..6 loop
  insert into public.battles(conversation_id,challenger_id,challenged_id,topic,challenger_position,challenged_position,status,accepted_at,ends_at)
  values(cid,a,b,'QA progression','First side','Other side','active',now(),now()+interval '1 day') returning id into bid;
  execute 'set local role authenticated';
  if sequence=5 then
   perform set_config('request.jwt.claims',jsonb_build_object('sub',a,'role','authenticated')::text,true);perform public.kaidra_battle_action(bid,'draw');
   perform pg_temp.assert_ok((select status='active' from public.battles where id=bid),'A unilateral draw resolved the battle');
   perform set_config('request.jwt.claims',jsonb_build_object('sub',b,'role','authenticated')::text,true);perform public.kaidra_battle_action(bid,'draw');
  else
   winner:=case when sequence=3 then b else a end;
   perform set_config('request.jwt.claims',jsonb_build_object('sub',case when winner=a then b else a end,'role','authenticated')::text,true);
   perform public.kaidra_battle_action(bid,'concede');
  end if;
  perform pg_temp.denied(format('select public.kaidra_battle_action(%L,''concede'')',bid));
  perform pg_temp.denied(format('select public.kaidra_battle_resolve(%L,%L,''community_vote'')',bid,a));
  perform pg_temp.denied(format('update public.battle_stats set xp=9999,wins=999,streak=999 where user_id=%L',a));
  execute 'reset role';
  if sequence=2 then perform pg_temp.assert_ok((select streak=2 and best_streak=2 from public.battle_stats where user_id=a),'Consecutive wins did not extend streak');end if;
  if sequence in(3,5) then perform pg_temp.assert_ok((select streak=0 and best_streak=2 from public.battle_stats where user_id=a),'Loss/draw did not reset only the current streak');end if;
 end loop;
 perform pg_temp.assert_ok((select battles=6 and wins=4 and losses=1 and draws=1 and streak=1 and best_streak=2 and xp=0 from public.battle_stats where user_id=a),'Result counts, best streak or replay protection incorrect');
 perform pg_temp.assert_ok((select battles=6 and wins=1 and losses=4 and draws=1 and streak=0 and best_streak=1 and xp=0 from public.battle_stats where user_id=b),'Opponent counters incorrect');
 perform pg_temp.assert_ok((select count(*)=12 from public.battle_rewards where user_id in(a,b)),'Duplicate result rewards were persisted');
end $$;
rollback;
