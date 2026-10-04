begin;
create table public.rpg_parties(id uuid primary key default gen_random_uuid(),name text not null check(length(trim(name)) between 2 and 40),leader_id uuid not null references auth.users(id) on delete cascade,conversation_id uuid not null unique references public.conversations(id) on delete cascade,emblem text not null default 'constellation' check(emblem in('constellation','eclipse','comet')),created_at timestamptz not null default now());
create table public.rpg_party_members(party_id uuid references public.rpg_parties(id) on delete cascade,user_id uuid references auth.users(id) on delete cascade,joined_at timestamptz not null default now(),primary key(party_id,user_id),unique(user_id));
create table public.rpg_party_invites(party_id uuid references public.rpg_parties(id) on delete cascade,user_id uuid references auth.users(id) on delete cascade,inviter_id uuid not null references auth.users(id) on delete cascade,status text not null default 'pending' check(status in('pending','accepted','declined')),created_at timestamptz not null default now(),primary key(party_id,user_id));
create table public.battle_rivalries(id uuid primary key default gen_random_uuid(),kind text not null check(kind in('duel','party')),side_a uuid not null,side_b uuid not null,battles integer not null default 0,wins_a integer not null default 0,wins_b integer not null default 0,streak integer not null default 0,streak_side uuid,last_battle uuid references public.battles(id) on delete set null,last_at timestamptz,recognized_a boolean not null default false,recognized_b boolean not null default false,unique(kind,side_a,side_b),check(side_a<side_b));
create table public.rivalry_battles(rivalry_id uuid references public.battle_rivalries(id) on delete cascade,battle_id uuid primary key references public.battles(id) on delete cascade);
alter table public.battle_teams add foreign key(party_id) references public.rpg_parties(id) on delete set null;
create function public.kaidra_party_visible(target_party uuid) returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.rpg_party_members where party_id=target_party and user_id=auth.uid()) or exists(select 1 from public.rpg_party_invites where party_id=target_party and user_id=auth.uid() and status='pending' and created_at>now()-interval '7 days');$$;
create function public.kaidra_rivalry_visible(target_rivalry uuid) returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.battle_rivalries r where id=target_rivalry and((kind='duel' and auth.uid() in(side_a,side_b)) or(kind='party' and exists(select 1 from public.rpg_party_members where party_id in(side_a,side_b) and user_id=auth.uid()))));$$;
do $$declare t text;begin foreach t in array array['rpg_parties','rpg_party_members','rpg_party_invites','battle_rivalries','rivalry_battles'] loop execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from public,anon,authenticated',t);execute format('grant all on public.%I to service_role',t);execute format('grant select on public.%I to authenticated',t);end loop;end $$;
create policy "Party members and invitees" on public.rpg_parties for select to authenticated using(public.kaidra_party_visible(id));
create policy "Party roster" on public.rpg_party_members for select to authenticated using(public.kaidra_party_visible(party_id));
create policy "Own party invites" on public.rpg_party_invites for select to authenticated using(user_id=auth.uid() or exists(select 1 from public.rpg_parties where id=party_id and leader_id=auth.uid()));
create policy "Involved rivals" on public.battle_rivalries for select to authenticated using(public.kaidra_rivalry_visible(id));
create policy "Involved rivalry history" on public.rivalry_battles for select to authenticated using(public.kaidra_rivalry_visible(rivalry_id));
create function public.kaidra_party_create(party_name text,emblem text default 'constellation',request_id uuid default gen_random_uuid()) returns uuid language plpgsql security definer set search_path='' as $$declare cid uuid;begin
 if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid() and not is_banned) or not exists(select 1 from public.battle_identities where user_id=auth.uid()) or length(trim(party_name)) not between 2 and 40 or emblem not in('constellation','eclipse','comet') then raise exception 'Awaken and choose a party name';end if;
 perform pg_advisory_xact_lock(hashtextextended('kaidra:party:'||auth.uid()::text,0));
 if exists(select 1 from public.rpg_parties where id=request_id and leader_id=auth.uid()) then return request_id;end if;
 if exists(select 1 from public.rpg_party_members where user_id=auth.uid()) then raise exception 'Leave your current party before creating another';end if;
 insert into public.conversations(is_group,title,created_by) values(true,trim(party_name),auth.uid()) returning id into cid;
 insert into public.conversation_participants(conversation_id,user_id,role) values(cid,auth.uid(),'owner');
 insert into public.rpg_parties values(request_id,trim(party_name),auth.uid(),cid,emblem,now());insert into public.rpg_party_members values(request_id,auth.uid(),now());return request_id;
end $$;
create function public.kaidra_party_invite(target_party uuid,target_user uuid) returns void language plpgsql security definer set search_path='' as $$declare party public.rpg_parties;begin
 select * into party from public.rpg_parties where id=target_party for update;
 if party.leader_id is distinct from auth.uid() or not public.kaidra_friends(auth.uid(),target_user) then raise exception 'Only the leader may invite a friend';end if;
 if (select count(*) from public.rpg_party_members where party_id=party.id)>=4 or exists(select 1 from public.rpg_party_members where user_id=target_user) then raise exception 'This party or friend is unavailable';end if;
 if exists(select 1 from public.rpg_party_invites where party_id=party.id and user_id=target_user and created_at>now()-interval '1 day') then raise exception 'This friend has already received an invitation today';end if;
 insert into public.rpg_party_invites values(party.id,target_user,auth.uid(),'pending',now()) on conflict(party_id,user_id) do update set status='pending',created_at=now(),inviter_id=excluded.inviter_id;
 perform public.kaidra_notify(target_user,'battle','party:'||party.id||':invite:'||extract(epoch from now())::text,'Party invitation',party.name,'party/'||party.id,jsonb_build_object('party_id',party.id));
end $$;
create function public.kaidra_party_action(target_party uuid,action text,target_user uuid default null) returns void language plpgsql security definer set search_path='' as $$declare p public.rpg_parties;is_leader boolean;begin
 select * into p from public.rpg_parties where id=target_party for update;if p.id is null then raise exception 'Party unavailable';end if;is_leader:=p.leader_id=auth.uid();
 if action in('accept','decline') then
 if not exists(select 1 from public.rpg_party_invites where party_id=p.id and user_id=auth.uid() and status='pending' and created_at>now()-interval '7 days') or not public.kaidra_friends(auth.uid(),p.leader_id) then raise exception 'An active friend invitation is required';end if;
 if action='accept' then
 perform pg_advisory_xact_lock(hashtextextended('kaidra:party:'||auth.uid()::text,0));
 if not exists(select 1 from public.battle_identities where user_id=auth.uid()) or exists(select 1 from public.rpg_party_members where user_id=auth.uid()) or (select count(*) from public.rpg_party_members where party_id=p.id)>=4 then raise exception 'Awaken first; parties support four members and one membership per account';end if;
 insert into public.rpg_party_members values(p.id,auth.uid(),now());insert into public.conversation_participants(conversation_id,user_id,role) values(p.conversation_id,auth.uid(),'participant');end if;
 update public.rpg_party_invites set status=case when action='accept' then 'accepted' else 'declined' end where party_id=p.id and user_id=auth.uid();
 elsif action='transfer' then
 if not is_leader or target_user=auth.uid() or not exists(select 1 from public.rpg_party_members where party_id=p.id and user_id=target_user) then raise exception 'Transfer leadership to another party member';end if;
 update public.rpg_parties set leader_id=target_user where id=p.id;update public.conversations set created_by=target_user where id=p.conversation_id;
 update public.conversation_participants set role=case when user_id=target_user then 'owner' else 'participant' end where conversation_id=p.conversation_id;
 elsif action in('leave','remove','disband') then
 if action='leave' then if is_leader then raise exception 'Transfer leadership or disband before leaving';end if;target_user:=auth.uid();
 elsif not is_leader or(action='remove' and target_user=p.leader_id) then raise exception 'Only the leader may manage party members';end if;
 if not exists(select 1 from public.rpg_party_members where party_id=p.id and user_id=coalesce(target_user,auth.uid())) then raise exception 'Party membership required';end if;
 if exists(select 1 from public.battle_participants bp join public.battles b on b.id=bp.battle_id join public.battle_teams t on t.battle_id=bp.battle_id and t.side=bp.team where t.party_id=p.id and b.status in('pending','active') and(action='disband' or bp.user_id=target_user)) then raise exception 'Finish or cancel the party battle first';end if;
 if action='disband' then delete from public.rpg_parties where id=p.id;update public.conversations set title=p.name||' · former party' where id=p.conversation_id;
 else delete from public.rpg_party_members where party_id=p.id and user_id=target_user;delete from public.conversation_participants where conversation_id=p.conversation_id and user_id=target_user;end if;
 else raise exception 'Unknown party action';end if;
end $$;
-- Party chats reuse normal group messaging. Membership must follow party consent.
create function public.kaidra_party_chat_guard() returns trigger language plpgsql security invoker set search_path='' as $$begin
 if current_user in('authenticated','anon') and exists(select 1 from public.rpg_parties where conversation_id=coalesce(new.conversation_id,old.conversation_id)) then raise exception 'Manage membership from your Party';end if;return case when tg_op='DELETE' then old else new end;
end $$;
create trigger kaidra_party_chat_guard before insert or update or delete on public.conversation_participants for each row execute function public.kaidra_party_chat_guard();
-- Generic group controls cannot bypass party invitations or leadership rules.
alter function public.kaidra_group_action(uuid,text,uuid,jsonb) rename to kaidra_group_action_nonparty;
alter function public.kaidra_add_group_members(uuid,uuid[]) rename to kaidra_add_group_members_nonparty;
revoke all on function public.kaidra_group_action_nonparty(uuid,text,uuid,jsonb),public.kaidra_add_group_members_nonparty(uuid,uuid[]) from public,anon,authenticated;
create function public.kaidra_group_action(target_conversation uuid,action text,target_user uuid default null,details jsonb default '{}') returns void language plpgsql security definer set search_path='' as $$begin
 if action in('promote','demote','transfer','remove','leave','delete') and exists(select 1 from public.rpg_parties where conversation_id=target_conversation) then raise exception 'Manage membership and leadership from your Party';end if;
 perform public.kaidra_group_action_nonparty(target_conversation,action,target_user,details);
end $$;
create function public.kaidra_add_group_members(target_conversation uuid,member_ids uuid[]) returns void language plpgsql security definer set search_path='' as $$begin
 if exists(select 1 from public.rpg_parties where conversation_id=target_conversation) then raise exception 'Invite friends from your Party';end if;
 perform public.kaidra_add_group_members_nonparty(target_conversation,member_ids);
end $$;
create or replace function public.kaidra_leave_group(target_conversation uuid) returns void language sql security definer set search_path='' as $$select public.kaidra_group_action(target_conversation,'leave');$$;
revoke all on function public.kaidra_group_action(uuid,text,uuid,jsonb),public.kaidra_add_group_members(uuid,uuid[]) from public,anon;
grant execute on function public.kaidra_group_action(uuid,text,uuid,jsonb),public.kaidra_add_group_members(uuid,uuid[]) to authenticated;
create function public.kaidra_party_state(target_party uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$begin
 if not public.kaidra_party_visible(target_party) then raise exception 'Party membership or invitation required';end if;
 return jsonb_build_object('party',(select to_jsonb(p) from public.rpg_parties p where id=target_party),'members',(select jsonb_agg(jsonb_build_object('id',u.id,'name',coalesce(u.display_name,u.username),'avatar_url',u.avatar_url,'identity',public.kaidra_battle_identity(u.id),'leader',p.leader_id=u.id)) from public.rpg_party_members m join public.profiles u on u.id=m.user_id join public.rpg_parties p on p.id=m.party_id where m.party_id=target_party),'own_invite',(select to_jsonb(i) from public.rpg_party_invites i where party_id=target_party and user_id=auth.uid()),'invites',case when exists(select 1 from public.rpg_parties where id=target_party and leader_id=auth.uid()) then (select jsonb_agg(to_jsonb(i)) from public.rpg_party_invites i where party_id=target_party and status='pending') end);
end $$;
create function public.kaidra_party_opponents() returns jsonb language sql stable security definer set search_path='' as $$select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'leader_id',p.leader_id,'members',(select jsonb_agg(jsonb_build_object('id',u.id,'name',coalesce(u.display_name,u.username),'identity',public.kaidra_battle_identity(u.id))) from public.rpg_party_members m join public.profiles u on u.id=m.user_id where m.party_id=p.id))),'[]'::jsonb) from public.rpg_parties p where public.kaidra_friends(auth.uid(),p.leader_id) and not exists(select 1 from public.rpg_party_members where party_id=p.id and user_id=auth.uid());$$;
create function public.kaidra_party_challenge(target_party uuid,own_teammate uuid,opponents uuid[],request_id uuid default gen_random_uuid(),rivalry_id uuid default null) returns uuid language plpgsql security definer set search_path='' as $$declare own public.rpg_parties;other public.rpg_parties;cid uuid;member uuid;result uuid;begin
 select p.* into own from public.rpg_parties p where leader_id=auth.uid();select * into other from public.rpg_parties where id=target_party;
 if own.id is null or other.id is null or own.id=other.id or cardinality(opponents)<>2 or not(other.leader_id=any(opponents)) or not public.kaidra_friends(auth.uid(),other.leader_id) or own_teammate=auth.uid() then raise exception 'Choose two members from each party, including both leaders';end if;
 if exists(select 1 from public.battles where id=request_id) then
 if exists(select 1 from public.battles b where b.id=request_id and b.challenger_id=auth.uid() and b.challenged_id=other.leader_id and b.context->>'party_a'=own.id::text and b.context->>'party_b'=other.id::text) and not exists(select 1 from public.battle_participants where battle_id=request_id and not(user_id=any(array[auth.uid(),own_teammate]||opponents))) then return request_id;end if;
 raise exception 'Challenge request conflicts with an existing battle';end if;
 if exists(select 1 from unnest(array[auth.uid(),own_teammate]) u where not exists(select 1 from public.rpg_party_members where party_id=own.id and user_id=u)) or exists(select 1 from unnest(opponents) u where not exists(select 1 from public.rpg_party_members where party_id=other.id and user_id=u)) or(select count(distinct u) from unnest(array[auth.uid(),own_teammate]||opponents) u)<>4 then raise exception 'All four fighters must belong to the selected parties';end if;
 if exists(select 1 from unnest(array[auth.uid(),own_teammate]||opponents) u where not exists(select 1 from public.battle_identities where user_id=u) or exists(select 1 from public.battle_participants bp join public.battles b on b.id=bp.battle_id where bp.user_id=u and b.status in('pending','active'))) then raise exception 'Every fighter must be awakened and available';end if;
 if exists(select 1 from unnest(array[auth.uid(),own_teammate]) a cross join unnest(opponents) b where not public.kaidra_pair_allowed(a,b)) then raise exception 'This matchup is not available';end if;
 -- Leaders agree to propose a shared battle chat; its roster grants visibility, not combat acceptance.
 select b.conversation_id into cid from public.battles b join public.conversations c on c.id=b.conversation_id where c.is_group and b.context->>'party_a'=own.id::text and b.context->>'party_b'=other.id::text and public.kaidra_is_conversation_member(c.id) order by b.created_at desc limit 1;
 if cid is null then insert into public.conversations(is_group,title,created_by) values(true,own.name||' vs '||other.name,auth.uid()) returning id into cid;end if;
 for member in select unnest(array[auth.uid(),own_teammate]||opponents) loop insert into public.conversation_participants(conversation_id,user_id,role) values(cid,member,case when member=auth.uid() then 'owner' else 'participant' end) on conflict do nothing;end loop;
 result:=public.kaidra_battle_create(cid,other.leader_id,'2v2 · '||own.name||' vs '||other.name,'','{"entry_type":"direct"}',request_id);
 if (select count(*) from public.battle_participants where battle_id=result)=4 then return result;end if;
 insert into public.battle_participants(battle_id,user_id,team,ready) values(result,own_teammate,1,false),(result,(select u from unnest(opponents) u where u<>other.leader_id),2,false);
 update public.battle_teams set party_id=case side when 1 then own.id else other.id end where battle_id=result;
 if rivalry_id is not null and not exists(select 1 from public.battle_rivalries r where r.id=rivalry_id and kind='party' and side_a=least(own.id,other.id) and side_b=greatest(own.id,other.id) and recognized_a and recognized_b) then raise exception 'Recognize this rivalry together first';end if;
 update public.battles set context=context||jsonb_build_object('party_battle',true,'party_a',own.id,'party_b',other.id,'party_a_name',own.name,'party_b_name',other.name,'rivalry_id',rivalry_id) where id=result;
 for member in select unnest(array[own_teammate]||opponents) loop perform public.kaidra_notify(member,'battle','battle:'||result||':pending','2v2 party challenge',own.name||' vs '||other.name,'battle/'||result,jsonb_build_object('battle_id',result));end loop;return result;
end $$;
create function public.kaidra_rivalry_record() returns trigger language plpgsql security definer set search_path='' as $$declare a uuid;b uuid;winner uuid;rival_kind text;rid uuid;begin
 if new.status='resolved' and old.status<>'resolved' and new.combat_version=1 and (select turn>=5 from public.battle_combat_state where battle_id=new.id) and (select count(*) from public.battle_events where battle_id=new.id and payload#>>'{intent,action}'='act')>=4 then
 rival_kind:=case when new.context->>'party_battle'='true' then 'party' else 'duel' end;a:=case when rival_kind='party' then(new.context->>'party_a')::uuid else new.challenger_id end;b:=case when rival_kind='party' then(new.context->>'party_b')::uuid else new.challenged_id end;
 winner:=case (select winning_team from public.battle_combat_state where battle_id=new.id) when 1 then a when 2 then b else null end;
 insert into public.battle_rivalries(kind,side_a,side_b,battles,wins_a,wins_b,streak,streak_side,last_battle,last_at) values(rival_kind,least(a,b),greatest(a,b),1,case when winner=least(a,b) then 1 else 0 end,case when winner=greatest(a,b) then 1 else 0 end,case when winner is null then 0 else 1 end,winner,new.id,now()) on conflict(kind,side_a,side_b) do update set battles=battle_rivalries.battles+1,wins_a=battle_rivalries.wins_a+excluded.wins_a,wins_b=battle_rivalries.wins_b+excluded.wins_b,streak=case when excluded.streak_side is null then 0 when battle_rivalries.streak_side=excluded.streak_side then battle_rivalries.streak+1 else 1 end,streak_side=excluded.streak_side,last_battle=new.id,last_at=now() returning id into rid;
 insert into public.rivalry_battles values(rid,new.id) on conflict do nothing;
 end if;return null;
end $$;
create trigger kaidra_rivalry_record after update on public.battles for each row execute function public.kaidra_rivalry_record();
create function public.kaidra_rivalry_recognize(target_rivalry uuid) returns void language plpgsql security definer set search_path='' as $$declare r public.battle_rivalries;own_side uuid;begin
 select * into r from public.battle_rivalries where id=target_rivalry for update;if r.battles<3 or not public.kaidra_rivalry_visible(r.id) then raise exception 'A rivalry forms after three meaningful battles';end if;
 if r.kind='duel' then own_side:=auth.uid();else select id into own_side from public.rpg_parties where id in(r.side_a,r.side_b) and leader_id=auth.uid();end if;
 if own_side=r.side_a then update public.battle_rivalries set recognized_a=true where id=r.id;elsif own_side=r.side_b then update public.battle_rivalries set recognized_b=true where id=r.id;else raise exception 'Only the competing users or party leaders recognize a rivalry';end if;
end $$;
alter function public.kaidra_battle_state(uuid) rename to kaidra_battle_state_preparty;
revoke all on function public.kaidra_battle_state_preparty(uuid) from public,anon,authenticated;
create function public.kaidra_battle_state(target_battle uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$declare result jsonb;begin
 result:=public.kaidra_battle_state_preparty(target_battle);
 if (result->>'combat_version')::integer=1 then
 result:=jsonb_set(result,'{participants}',coalesce((select jsonb_agg(jsonb_build_object('id',u.id,'username',u.username,'display_name',u.display_name,'avatar_url',u.avatar_url,'identity',public.kaidra_battle_identity(u.id),'team',p.team,'ready',p.ready) order by p.team,p.user_id) from public.battle_participants p join public.profiles u on u.id=p.user_id where p.battle_id=target_battle),'[]'));
 end if;return result;end $$;
revoke all on function public.kaidra_battle_state(uuid) from public,anon;
grant execute on function public.kaidra_battle_state(uuid) to authenticated;
create function public.kaidra_rival_duel(target_rivalry uuid,request_id uuid default gen_random_uuid()) returns uuid language plpgsql security definer set search_path='' as $$declare r public.battle_rivalries;opponent uuid;cid uuid;bid uuid;begin
 select * into r from public.battle_rivalries where id=target_rivalry;
 if r.kind is distinct from 'duel' or not public.kaidra_rivalry_visible(r.id) or not(r.recognized_a and r.recognized_b) then raise exception 'Recognize this rivalry together first';end if;
 opponent:=case when r.side_a=auth.uid() then r.side_b else r.side_a end;
 cid:=public.get_or_create_conversation(opponent);
 bid:=public.kaidra_battle_create(cid,opponent,'','','{"entry_type":"direct"}',request_id);
 update public.battles set context=context||jsonb_build_object('rivalry_id',r.id) where id=bid;return bid;
end $$;
-- Maintenance reuses the existing private Vault scheduler credential.
create function public.kaidra_schedule_combat_tick() returns bigint language plpgsql security definer set search_path='' as $$declare secret text;request_id bigint;begin
 if not exists(select 1 from public.battle_combat_state where phase='playing' and deadline<=now()) and not exists(select 1 from public.battles where combat_version=1 and status='pending' and created_at<=now()-interval '10 minutes') then return null;end if;
 select decrypted_secret into secret from vault.decrypted_secrets where name='kaidra_sports_sync' limit 1;if secret is null then return null;end if;
 select net.http_post(url:='https://skmlktywdmsbjyybtmhm.supabase.co/functions/v1/combat-api',headers:=jsonb_build_object('Content-Type','application/json','x-sync-secret',secret),body:='{}'::jsonb,timeout_milliseconds:=60000) into request_id;return request_id;
end $$;
select cron.schedule('kaidra-combat-timeouts','* * * * *','select public.kaidra_schedule_combat_tick()');
do $$declare fn record;begin for fn in select oid::regprocedure signature,proname from pg_proc where pronamespace='public'::regnamespace and proname in('kaidra_party_visible','kaidra_rivalry_visible','kaidra_party_create','kaidra_party_invite','kaidra_party_action','kaidra_party_chat_guard','kaidra_party_state','kaidra_party_opponents','kaidra_party_challenge','kaidra_rivalry_record','kaidra_rivalry_recognize','kaidra_rival_duel','kaidra_schedule_combat_tick') loop execute format('revoke all on function %s from public,anon,authenticated',fn.signature);execute format('grant execute on function %s to %I',fn.signature,case when fn.proname in('kaidra_party_chat_guard','kaidra_rivalry_record','kaidra_schedule_combat_tick') then 'service_role' else 'authenticated' end);end loop;end $$;
notify pgrst,'reload schema';
commit;
