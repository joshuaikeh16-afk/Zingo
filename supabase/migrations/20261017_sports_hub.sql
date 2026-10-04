begin;
-- API-Sports IDs never reuse football-data.org's numeric identity namespace.
create table public.sports_entities(sport text not null,provider text not null,entity_type text not null check(entity_type in('team','player','competition','event')),external_id text not null check(external_id ~ '^[0-9]{1,10}$'),display_name text not null check(length(display_name) between 1 and 300),snapshot jsonb not null,verified_at timestamptz not null default now(),primary key(sport,provider,entity_type,external_id),check(sport='football' and provider='api-sports'));
create table public.sports_follows(user_id uuid not null references auth.users(id) on delete cascade,sport text not null,provider text not null,entity_type text not null,external_id text not null,is_primary boolean not null default false,is_public boolean not null default false,created_at timestamptz not null default now(),primary key(user_id,sport,provider,entity_type,external_id),foreign key(sport,provider,entity_type,external_id) references public.sports_entities,check(not is_primary or entity_type='team'));
create unique index sports_one_primary on public.sports_follows(user_id,sport) where is_primary;
create table public.sports_side_support(user_id uuid not null references auth.users(id) on delete cascade,sport text not null,provider text not null,entity_type text not null default 'event' check(entity_type='event'),external_id text not null,side text not null check(side in('home','away','neutral')),is_public boolean not null default false,created_at timestamptz not null default now(),primary key(user_id,sport,provider,external_id),foreign key(sport,provider,entity_type,external_id) references public.sports_entities);
create table public.sports_notification_preferences(user_id uuid references auth.users(id) on delete cascade,sport text not null default 'football',enabled boolean not null default false,reminders boolean not null default false,results boolean not null default false,lineups boolean not null default false,primary key(user_id,sport),check(sport='football'));
create table public.sports_provider_cache(cache_key text primary key,data jsonb,fetched_at timestamptz,expires_at timestamptz,lease_until timestamptz,error_code text,error_until timestamptz);
create table public.sports_provider_budget(day date primary key,requests integer not null default 0,blocked_until timestamptz);
create table public.sports_request_limits(user_id uuid references auth.users(id) on delete cascade,minute timestamptz,requests integer not null default 0,primary key(user_id,minute));
do $$ declare t text;begin foreach t in array array['sports_entities','sports_follows','sports_side_support','sports_notification_preferences','sports_provider_cache','sports_provider_budget','sports_request_limits'] loop execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from public,anon,authenticated',t);execute format('grant all on public.%I to service_role',t);end loop;end $$;
grant select on public.sports_entities,public.sports_follows,public.sports_side_support,public.sports_notification_preferences to authenticated;
create policy "Verified sports metadata" on public.sports_entities for select to authenticated using(true);
create policy "Own sports follows" on public.sports_follows for select to authenticated using(user_id=(select auth.uid()));
create policy "Own match choice" on public.sports_side_support for select to authenticated using(user_id=(select auth.uid()));
create policy "Own sports notifications" on public.sports_notification_preferences for select to authenticated using(user_id=(select auth.uid()));
create function public.kaidra_sports_follow(entity jsonb,action text,public_choice boolean default false,expected_primary text default null) returns void language plpgsql security definer set search_path='' as $$
declare s text:=entity->>'sport';p text:=entity->>'provider';t text:=entity->>'entity_type';eid text:=entity->>'external_id';existing text;begin
 if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid() and not is_banned) then raise exception 'Sign in required';end if;
 if not exists(select 1 from public.sports_entities where sport=s and provider=p and entity_type=t and external_id=eid) then raise exception 'Open a verified sports page first';end if;
 perform pg_advisory_xact_lock(hashtextextended('sports-follow:'||auth.uid()::text||s,0));
 if action='support' then
 if t<>'team' then raise exception 'Choose a team';end if;
 select external_id into existing from public.sports_follows where user_id=auth.uid() and sport=s and is_primary;
 if existing is not null and existing<>eid and expected_primary is distinct from existing then raise exception 'Confirm changing your supported club';end if;
 update public.sports_follows set is_primary=false where user_id=auth.uid() and sport=s and is_primary;
 insert into public.sports_follows values(auth.uid(),s,p,t,eid,true,public_choice,now()) on conflict(user_id,sport,provider,entity_type,external_id) do update set is_primary=true,is_public=excluded.is_public;
 elsif action='follow' then insert into public.sports_follows values(auth.uid(),s,p,t,eid,false,public_choice,now()) on conflict do nothing;
 elsif action='privacy' then update public.sports_follows set is_public=public_choice where user_id=auth.uid() and sport=s and provider=p and entity_type=t and external_id=eid;
 elsif action='unfollow' then delete from public.sports_follows where user_id=auth.uid() and sport=s and provider=p and entity_type=t and external_id=eid;
 else raise exception 'Unknown sports action';end if;
end $$;
create function public.kaidra_sports_friends(entity jsonb) returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'username',p.username,'display_name',p.display_name,'avatar_url',p.avatar_url)),'[]'::jsonb) from public.sports_follows f join public.profiles p on p.id=f.user_id where f.is_primary and f.is_public and f.sport=entity->>'sport' and f.provider=entity->>'provider' and f.entity_type=entity->>'entity_type' and f.external_id=entity->>'external_id' and public.kaidra_friends(auth.uid(),f.user_id);
$$;
create function public.kaidra_sports_profile(target_user uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(e.snapshot||jsonb_build_object('is_public',f.is_public)),'[]'::jsonb) from public.sports_follows f join public.sports_entities e using(sport,provider,entity_type,external_id) where f.user_id=target_user and f.is_primary and (auth.uid()=target_user or(f.is_public and public.kaidra_pair_allowed(auth.uid(),target_user)));
$$;
create function public.kaidra_sports_side(entity jsonb,choice text,public_choice boolean default false) returns void language plpgsql security definer set search_path='' as $$
declare e public.sports_entities;begin
 select * into e from public.sports_entities where sport=entity->>'sport' and provider=entity->>'provider' and entity_type='event' and external_id=entity->>'external_id' for share;
 if auth.uid() is null or e.external_id is null or choice not in('home','away','neutral') or not exists(select 1 from public.profiles where id=auth.uid() and not is_banned) then raise exception 'Choose a verified match and side';end if;
 if e.verified_at<now()-interval '20 minutes' then raise exception 'Refresh the match before choosing a side';end if;
 if e.snapshot#>>'{fixture,status,short}' not in('NS','TBD','1H','HT','2H','ET','BT','P') then raise exception 'Support is locked for this match';end if;
 insert into public.sports_side_support values(auth.uid(),e.sport,e.provider,'event',e.external_id,choice,public_choice,now()) on conflict(user_id,sport,provider,external_id) do update set side=excluded.side,is_public=excluded.is_public;
end $$;
create function public.kaidra_sports_match_social(entity jsonb) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('own',(select jsonb_build_object('side',side,'is_public',is_public) from public.sports_side_support where user_id=auth.uid() and sport=entity->>'sport' and provider=entity->>'provider' and external_id=entity->>'external_id'),'friends',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',coalesce(p.display_name,p.username),'side',s.side)) from public.sports_side_support s join public.profiles p on p.id=s.user_id where s.sport=entity->>'sport' and s.provider=entity->>'provider' and s.external_id=entity->>'external_id' and s.is_public and public.kaidra_friends(auth.uid(),s.user_id)),'[]'::jsonb));
$$;
create function public.kaidra_sports_preferences(enabled boolean,reminders boolean,results boolean,lineups boolean) returns void language plpgsql security definer set search_path='' as $$begin
 if auth.uid() is null then raise exception 'Sign in required';end if;
 insert into public.sports_notification_preferences values(auth.uid(),'football',enabled,reminders,results,lineups) on conflict(user_id,sport) do update set enabled=excluded.enabled,reminders=excluded.reminders,results=excluded.results,lineups=excluded.lineups;
end $$;
-- Cross-instance leases + conservative shared daily budget (80 requests/day).
create function public.kaidra_sports_cache_claim(key text,actor uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.sports_provider_cache;n integer;b public.sports_provider_budget;begin
 if length(key)>500 then raise exception 'Invalid cache key';end if;
 if actor is not null then
 insert into public.sports_request_limits values(actor,date_trunc('minute',now()),1) on conflict(user_id,minute) do update set requests=sports_request_limits.requests+1 returning requests into n;
 if n>30 then return jsonb_build_object('state','limited');end if;
 end if;
 insert into public.sports_provider_cache(cache_key) values(key) on conflict do nothing;
 select * into c from public.sports_provider_cache where cache_key=key for update;
 if c.expires_at>now() then return jsonb_build_object('state','hit','data',c.data,'fetched_at',c.fetched_at,'expires_at',c.expires_at);end if;
 if c.error_until>now() then return jsonb_build_object('state','error','code',c.error_code,'data',c.data,'fetched_at',c.fetched_at);end if;
 if c.lease_until>now() then return jsonb_build_object('state','busy','data',c.data,'fetched_at',c.fetched_at);end if;
 insert into public.sports_provider_budget(day) values((now() at time zone 'UTC')::date) on conflict do nothing;
 select * into b from public.sports_provider_budget where day=(now() at time zone 'UTC')::date for update;
 if b.requests>=80 or b.blocked_until>now() then return jsonb_build_object('state','quota','data',c.data,'fetched_at',c.fetched_at);end if;
 update public.sports_provider_budget set requests=requests+1 where day=b.day;
 update public.sports_provider_cache set lease_until=now()+interval '30 seconds' where cache_key=key;
 delete from public.sports_request_limits where minute<now()-interval '1 day';
 return jsonb_build_object('state','fetch','data',c.data,'fetched_at',c.fetched_at);
end $$;
create function public.kaidra_sports_cache_store(key text,payload jsonb,ttl integer,code text default null,remaining integer default null) returns void language plpgsql security definer set search_path='' as $$begin
 if code is null then update public.sports_provider_cache set data=payload,fetched_at=now(),expires_at=now()+make_interval(secs=>least(greatest(ttl,60),604800)),error_code=null,error_until=null,lease_until=null where cache_key=key;
 else update public.sports_provider_cache set error_code=code,error_until=now()+interval '5 minutes',lease_until=null where cache_key=key;end if;
 if remaining<=5 then update public.sports_provider_budget set blocked_until=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC'+interval '1 day' where day=(now() at time zone 'UTC')::date;end if;
end $$;
-- Trusted references, including Discussion context; ordinary messages retain their APIs.
alter table public.messages add column sports_context jsonb;
alter table public.messages drop constraint kaidra_shared_content_shape;
alter table public.messages add constraint kaidra_shared_content_shape check(shared_content is null or(jsonb_typeof(shared_content)='object' and octet_length(shared_content::text)<20000 and coalesce(shared_content->>'kind' in('movie','tv','match','article','anime','manga','sports') and length(shared_content->>'title') between 1 and 300,false)));
create function public.kaidra_sports_message_guard() returns trigger language plpgsql security definer set search_path='' as $$declare ref jsonb;e public.sports_entities;begin
 ref:=case when new.shared_content->>'kind'='sports' then new.shared_content else new.sports_context end;
 if ref is not null then
 select * into e from public.sports_entities where sport=ref->>'sport' and provider=ref->>'provider' and entity_type=ref->>'entity_type' and external_id=ref->>'external_id';
 if e.external_id is null then raise exception 'Choose verified sports context';end if;
 ref:=jsonb_build_object('kind','sports','sport',e.sport,'provider',e.provider,'entity_type',e.entity_type,'external_id',e.external_id,'title',e.display_name,'image',e.snapshot->>'image');
 if new.shared_content->>'kind'='sports' then new.shared_content:=ref;else if new.message_type<>'discussion' then raise exception 'Sports context requires a Discussion';end if;new.sports_context:=ref;end if;
 end if;return new;
end $$;
create trigger kaidra_sports_message_guard before insert on public.messages for each row execute function public.kaidra_sports_message_guard();
create function public.kaidra_sports_battle_context() returns trigger language plpgsql security definer set search_path='' as $$declare ref jsonb;begin
 if new.discussion_message_id is not null then select sports_context into ref from public.messages where id=new.discussion_message_id and conversation_id=new.conversation_id; if ref is not null then new.context:=new.context||jsonb_build_object('sports',ref);end if;end if;return new;
end $$;
create trigger kaidra_sports_battle_context before insert on public.battles for each row execute function public.kaidra_sports_battle_context();
-- Reuse existing notifications/global football switch and its unique event key.
create function public.kaidra_sports_deliver(event_id text,category_name text,heading text,body_text text) returns integer language plpgsql security definer set search_path='' as $$declare e public.sports_entities;n integer;begin
 select * into e from public.sports_entities where sport='football' and provider='api-sports' and entity_type='event' and external_id=event_id;
 if e.external_id is null or category_name not in('reminders','results','lineups') then raise exception 'Invalid sports notification';end if;
 if category_name='reminders' and (e.snapshot#>>'{fixture,status,short}' not in('NS','TBD') or(e.snapshot#>>'{fixture,date}')::timestamptz not between now() and now()+interval '1 hour') then return 0;end if;
 if category_name='results' and e.snapshot#>>'{fixture,status,short}' not in('FT','AET','PEN') then return 0;end if;
 if category_name='lineups' and not exists(select 1 from public.sports_provider_cache where cache_key='football:lineups:'||event_id and expires_at>now() and jsonb_array_length(data->'response')>0) then return 0;end if;
 insert into public.app_notifications(user_id,event_key,category,title,body,url,payload)
 select distinct f.user_id,'sports:api-sports:'||event_id||':'||category_name,'football',left(heading,300),left(body_text,1000),'sports/football/event/'||event_id,jsonb_build_object('sports',jsonb_build_object('sport','football','provider','api-sports','entity_type','event','external_id',event_id))
 from public.sports_follows f join public.sports_notification_preferences p on p.user_id=f.user_id and p.sport=f.sport
 where f.sport='football' and f.provider='api-sports' and f.is_primary and f.external_id in(e.snapshot#>>'{teams,home,id}',e.snapshot#>>'{teams,away,id}') and p.enabled and case category_name when 'reminders' then p.reminders when 'results' then p.results when 'lineups' then p.lineups end
 and coalesce((select (notifications->>'football')::boolean from public.social_preferences where user_id=f.user_id),true)
 on conflict(user_id,event_key) do nothing;get diagnostics n=row_count;return n;
end $$;
do $$ declare fn record;begin for fn in select oid::regprocedure signature,proname from pg_proc where pronamespace='public'::regnamespace and proname in('kaidra_sports_follow','kaidra_sports_friends','kaidra_sports_profile','kaidra_sports_side','kaidra_sports_match_social','kaidra_sports_preferences','kaidra_sports_cache_claim','kaidra_sports_cache_store','kaidra_sports_deliver','kaidra_sports_message_guard','kaidra_sports_battle_context') loop execute format('revoke all on function %s from public,anon,authenticated',fn.signature);if fn.proname in('kaidra_sports_cache_claim','kaidra_sports_cache_store','kaidra_sports_deliver') then execute format('grant execute on function %s to service_role',fn.signature);elsif fn.proname not in('kaidra_sports_message_guard','kaidra_sports_battle_context') then execute format('grant execute on function %s to authenticated',fn.signature);end if;end loop;end $$;
notify pgrst,'reload schema';
commit;
