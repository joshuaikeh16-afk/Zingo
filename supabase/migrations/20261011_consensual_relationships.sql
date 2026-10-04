begin;
create table public.relationship_types(key text primary key,label text not null,active boolean not null default true);
insert into public.relationship_types(key,label) values('close_friend','Close friends'),('partner','Partners'),('rival','Friendly rivals');
create table public.relationships(id uuid primary key default gen_random_uuid(),requester_id uuid not null references auth.users(id) on delete cascade,target_id uuid not null references auth.users(id) on delete cascade,type text not null references public.relationship_types(key),conversation_id uuid not null references public.conversations(id) on delete cascade,
 status text not null default 'pending' check(status in('pending','accepted','declined','cancelled','ended')),
 requester_visibility text not null check(requester_visibility in('private','friends','public')),target_visibility text not null default 'private' check(target_visibility in('private','friends','public')),
 requester_notify boolean not null default false,target_notify boolean not null default false,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),check(requester_id<>target_id));
create unique index relationships_open_pair_idx on public.relationships(least(requester_id,target_id),greatest(requester_id,target_id)) where status in('pending','accepted');
create index relationships_target_status_idx on public.relationships(target_id,status);
create function public.kaidra_relationship_visible(target_relationship uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.relationships r where r.id=target_relationship and (auth.uid() in(r.requester_id,r.target_id) or(r.status='accepted' and public.kaidra_pair_allowed(auth.uid(),r.requester_id) and public.kaidra_pair_allowed(auth.uid(),r.target_id) and r.requester_visibility<>'private' and r.target_visibility<>'private' and ((r.requester_visibility='public' and r.target_visibility='public') or(public.kaidra_friends(auth.uid(),r.requester_id) and public.kaidra_friends(auth.uid(),r.target_id))))));
$$;
create function public.kaidra_relationship_event() returns trigger language plpgsql security definer set search_path='' as $$
declare uid uuid;label text;begin
 if new.status in('pending','accepted') and (tg_op='INSERT' or old.status is distinct from new.status) then
 label:=case when new.status='pending' then 'Relationship request' else 'Connection accepted' end||' · '||(select t.label from public.relationship_types t where t.key=new.type);
 insert into public.messages(conversation_id,sender_id,content,message_type,event_data) values(new.conversation_id,coalesce(auth.uid(),new.requester_id),label,'system',jsonb_build_object('kind','relationship','relationship_id',new.id));
 if new.status='pending' then perform public.kaidra_notify(new.target_id,'relationship','relationship:'||new.id||':request','A relationship request',label,'inbox/'||new.conversation_id,jsonb_build_object('relationship_id',new.id,'conversation_id',new.conversation_id));
 else
 update public.app_notifications set read_at=coalesce(read_at,now()) where category='relationship' and payload->>'relationship_id'=new.id::text;
 perform public.kaidra_notify(new.requester_id,'relationship','relationship:'||new.id||':accepted','Your connection was accepted',label,'inbox/'||new.conversation_id,jsonb_build_object('relationship_id',new.id,'conversation_id',new.conversation_id));
 end if;
 end if;
 -- Remove earlier friend-facing activity whenever privacy tightens or consent ends.
 delete from public.app_notifications where category='relationship' and payload->>'relationship_id'=new.id::text and user_id not in(new.requester_id,new.target_id);
 if new.status in('declined','cancelled','ended') then update public.app_notifications set read_at=coalesce(read_at,now()),dismissed_at=now() where category='relationship' and payload->>'relationship_id'=new.id::text;end if;
 if new.status='accepted' and new.requester_notify and new.target_notify and new.requester_visibility<>'private' and new.target_visibility<>'private' and (tg_op='INSERT' or old.status is distinct from new.status) then
 for uid in select distinct case when requester_id in(new.requester_id,new.target_id) then target_id else requester_id end from public.friend_requests where status='accepted' and (requester_id in(new.requester_id,new.target_id) or target_id in(new.requester_id,new.target_id)) loop
 if uid not in(new.requester_id,new.target_id) and public.kaidra_pair_allowed(uid,new.requester_id) and public.kaidra_pair_allowed(uid,new.target_id) and ((new.requester_visibility='public' and new.target_visibility='public') or(public.kaidra_friends(uid,new.requester_id) and public.kaidra_friends(uid,new.target_id))) then
 perform public.kaidra_notify(uid,'relationship','relationship:'||new.id||':friends',(select display_name from public.profiles where id=new.requester_id)||' and '||(select display_name from public.profiles where id=new.target_id)||' connected',(select t.label from public.relationship_types t where t.key=new.type),'user/'||new.requester_id,jsonb_build_object('relationship_id',new.id,'user_id',new.requester_id));end if;
 end loop;end if;
 perform public.kaidra_social_signal(new.requester_id);perform public.kaidra_social_signal(new.target_id);
 if new.status='accepted' or(tg_op='UPDATE' and old.status='accepted') then
 perform public.kaidra_social_signal(case when requester_id in(new.requester_id,new.target_id) then target_id else requester_id end) from public.friend_requests where status='accepted' and (requester_id in(new.requester_id,new.target_id) or target_id in(new.requester_id,new.target_id));end if;
 return null;
end $$;
create trigger kaidra_relationship_event after insert or update on public.relationships for each row execute function public.kaidra_relationship_event();
create function public.kaidra_relationship_request(target_user uuid,relationship_type text,visibility text,notify_friends boolean default false,request_id uuid default gen_random_uuid()) returns uuid language plpgsql security definer set search_path='' as $$
declare cid uuid;begin
 if not public.kaidra_friends(auth.uid(),target_user) or visibility not in('private','friends','public') or not exists(select 1 from public.relationship_types where key=relationship_type and active) then raise exception 'Choose a friend and a valid connection';end if;
 perform pg_advisory_xact_lock(hashtextextended('kaidra:relationship:'||least(auth.uid(),target_user)::text||greatest(auth.uid(),target_user)::text,0));
 if exists(select 1 from public.relationships where id=request_id and requester_id=auth.uid() and target_id=target_user) then return request_id;end if;
 if (select count(*) from public.relationships where requester_id=auth.uid() and created_at>now()-interval '1 day')>=3 or exists(select 1 from public.relationships where least(requester_id,target_id)=least(auth.uid(),target_user) and greatest(requester_id,target_id)=greatest(auth.uid(),target_user) and created_at>now()-interval '1 day') then raise exception 'Give this person some space before requesting again';end if;
 cid:=public.get_or_create_conversation(target_user);if not public.kaidra_can_send_message(cid) then raise exception 'This conversation is unavailable';end if;
 insert into public.relationships(id,requester_id,target_id,type,conversation_id,requester_visibility,requester_notify) values(request_id,auth.uid(),target_user,relationship_type,cid,visibility,notify_friends);return request_id;
end $$;
create function public.kaidra_relationship_action(target_relationship uuid,action text,visibility text default 'private',notify_friends boolean default false) returns void language plpgsql security definer set search_path='' as $$
declare r public.relationships;begin
 select * into r from public.relationships where id=target_relationship for update;
 if not found or auth.uid() not in(r.requester_id,r.target_id) then raise exception 'Only participants may change this relationship';end if;
 if action in('accept','privacy') and visibility not in('private','friends','public') then raise exception 'Choose valid visibility';end if;
 if action='accept' then
 if auth.uid()<>r.target_id or r.status<>'pending' or not public.kaidra_friends(r.requester_id,r.target_id) then raise exception 'Only the invited friend can accept';end if;
 update public.relationships set status='accepted',target_visibility=visibility,target_notify=notify_friends,updated_at=now() where id=r.id;
 elsif action='decline' then
 if auth.uid()<>r.target_id or r.status<>'pending' then raise exception 'Only the invited friend can decline';end if;update public.relationships set status='declined',updated_at=now() where id=r.id;
 elsif action='cancel' then
 if auth.uid()<>r.requester_id or r.status<>'pending' then raise exception 'Only the sender can cancel';end if;update public.relationships set status='cancelled',updated_at=now() where id=r.id;
 elsif action='end' then
 if r.status<>'accepted' then raise exception 'This connection is not active';end if;update public.relationships set status='ended',updated_at=now() where id=r.id;
 elsif action='privacy' then
 if r.status not in('pending','accepted') then raise exception 'This connection is closed';end if;
 update public.relationships set requester_visibility=case when auth.uid()=requester_id then visibility else requester_visibility end,target_visibility=case when auth.uid()=target_id then visibility else target_visibility end,requester_notify=case when auth.uid()=requester_id then notify_friends else requester_notify end,target_notify=case when auth.uid()=target_id then notify_friends else target_notify end,updated_at=now() where id=r.id;
 else raise exception 'Unknown relationship action';end if;
end $$;
create function public.kaidra_profile_social(target_user uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('stats',(select to_jsonb(s) from public.battle_stats s where user_id=target_user),'relationships',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'type',r.type,'label',t.label,'status',r.status,'own_visibility',case when auth.uid()=r.requester_id then r.requester_visibility when auth.uid()=r.target_id then r.target_visibility end,'own_notify',case when auth.uid()=r.requester_id then r.requester_notify when auth.uid()=r.target_id then r.target_notify end,'requester_id',r.requester_id,'target_id',r.target_id,'partner',jsonb_build_object('id',p.id,'display_name',p.display_name,'username',p.username,'avatar_url',p.avatar_url))) from public.relationships r join public.relationship_types t on t.key=r.type join public.profiles p on p.id=case when r.requester_id=target_user then r.target_id else r.requester_id end where target_user in(r.requester_id,r.target_id) and r.status in('pending','accepted') and public.kaidra_relationship_visible(r.id)),'[]'::jsonb));
$$;
create function public.kaidra_connection_cleanup() returns trigger language plpgsql security definer set search_path='' as $$
declare a uuid;b uuid;begin
 if tg_table_name='user_blocks' then a:=new.user_id;b:=new.blocked_user;
 else
 a:=old.requester_id;b:=old.target_id;
 if old.status<>'accepted' or (tg_op='UPDATE' and new.status='accepted') or exists(select 1 from public.friend_requests where status='accepted' and ((requester_id=a and target_id=b) or(requester_id=b and target_id=a))) then return null;end if;
 end if;
 update public.relationships set status='ended',updated_at=now() where least(requester_id,target_id)=least(a,b) and greatest(requester_id,target_id)=greatest(a,b) and status in('pending','accepted');
 update public.battles set status='cancelled' where least(challenger_id,challenged_id)=least(a,b) and greatest(challenger_id,challenged_id)=greatest(a,b) and status in('pending','active');
 perform public.kaidra_social_signal(a);perform public.kaidra_social_signal(b);return null;
end $$;
create trigger kaidra_unfriend_cleanup after delete or update on public.friend_requests for each row execute function public.kaidra_connection_cleanup();
create trigger kaidra_block_cleanup after insert on public.user_blocks for each row execute function public.kaidra_connection_cleanup();
alter table public.relationship_types enable row level security;alter table public.relationships enable row level security;
revoke all on public.relationship_types,public.relationships from anon,authenticated;grant select on public.relationship_types,public.relationships to authenticated;
create policy "Connection types" on public.relationship_types for select to authenticated using(active);
create policy "Consented visible relationships" on public.relationships for select to authenticated using(auth.uid() in(requester_id,target_id));
do $$ declare signature text;begin foreach signature in array array['kaidra_relationship_visible(uuid)','kaidra_relationship_request(uuid,text,text,boolean,uuid)','kaidra_relationship_action(uuid,text,text,boolean)','kaidra_profile_social(uuid)'] loop execute 'revoke all on function public.'||signature||' from public,anon';execute 'grant execute on function public.'||signature||' to authenticated';end loop;end $$;
alter publication supabase_realtime add table public.relationships;
notify pgrst,'reload schema';
commit;
