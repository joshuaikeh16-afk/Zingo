begin;
do $$
declare uid uuid:=gen_random_uuid(); other_id uuid:=gen_random_uuid(); name text:='qa_'||substr(replace(gen_random_uuid()::text,'-',''),1,15); payload jsonb;
begin
 insert into auth.users(id,email) values(uid,uid||'@example.invalid'),(other_id,other_id||'@example.invalid');
 perform set_config('request.jwt.claims',jsonb_build_object('sub',uid,'role','authenticated')::text,true);execute 'set local role authenticated';
 if public.kaidra_username_available('ADMIN') then raise exception 'Reserved name available'; end if;
 payload:=jsonb_build_object('username',upper(name),'display_name','QA setup','categories',jsonb_build_array('movie','football'),'genres',jsonb_build_array('comedy'),'country','NG','language','any','favorites',jsonb_build_array(jsonb_build_object('id',550,'kind','movie','title','QA favorite')));
 perform public.kaidra_onboarding_save(payload,1,false);
 if not exists(select 1 from public.onboarding_drafts where user_id=uid and stage=1) then raise exception 'Draft missing'; end if;
 if exists(select 1 from public.profiles where id=uid) then raise exception 'Partial setup created public profile'; end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',other_id,'role','authenticated')::text,true);
 if exists(select 1 from public.onboarding_drafts where user_id=uid) then raise exception 'Another account can read draft'; end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',uid,'role','authenticated')::text,true);
 perform public.kaidra_onboarding_save(payload,3,true);perform public.kaidra_onboarding_save(payload,3,true);
 if not exists(select 1 from public.profiles where id=uid and username=name and onboarding_completed and 'football'=any(interests)) then raise exception 'Completion failed'; end if;
 if exists(select 1 from public.onboarding_drafts where user_id=uid) then raise exception 'Completed draft retained'; end if;
 if (select count(*) from public.user_watchlist where user_id=uid and is_favorite)<>1 then raise exception 'Favorite duplicated or missing'; end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',other_id,'role','authenticated')::text,true);
 if public.kaidra_username_available(upper(name)) then raise exception 'Case-insensitive username collision'; end if;
 begin perform public.kaidra_onboarding_save(payload,3,true);raise exception using errcode='XX000',message='Duplicate username accepted';exception when unique_violation then null;end;
 execute 'reset role';
end $$;
rollback;
