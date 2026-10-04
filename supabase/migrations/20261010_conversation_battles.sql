begin;
create table public.battles(id uuid primary key default gen_random_uuid(),conversation_id uuid not null references public.conversations(id) on delete cascade,
 challenger_id uuid not null references auth.users(id) on delete cascade,challenged_id uuid not null references auth.users(id) on delete cascade,
 type text not null default 'opinion' check(type='opinion'),topic text not null check(length(topic) between 1 and 240),context jsonb not null default '{}' check(jsonb_typeof(context)='object' and octet_length(context::text)<12000),
 challenger_position text not null check(length(challenger_position) between 1 and 1200),challenged_position text check(length(challenged_position) between 1 and 1200),
 status text not null default 'pending' check(status in('pending','active','declined','cancelled','expired','resolved')),
 winner_id uuid references auth.users(id) on delete set null,outcome text check(outcome in('community_vote','concession','draw')),
 draw_offered_by uuid references auth.users(id) on delete set null,created_at timestamptz not null default now(),accepted_at timestamptz,ends_at timestamptz,resolved_at timestamptz,
 check(challenger_id<>challenged_id),check(winner_id is null or winner_id in(challenger_id,challenged_id)));
create unique index battles_open_pair_idx on public.battles(least(challenger_id,challenged_id),greatest(challenger_id,challenged_id)) where status in('pending','active');
create index battles_conversation_idx on public.battles(conversation_id,created_at desc);
create table public.battle_votes(battle_id uuid references public.battles(id) on delete cascade,user_id uuid references auth.users(id) on delete cascade,side uuid not null references auth.users(id) on delete cascade,created_at timestamptz not null default now(),primary key(battle_id,user_id));
create table public.battle_posts(id uuid primary key default gen_random_uuid(),battle_id uuid not null references public.battles(id) on delete cascade,user_id uuid not null references auth.users(id) on delete cascade,body text not null check(length(body) between 1 and 1200),created_at timestamptz not null default now());
create index battle_posts_order_idx on public.battle_posts(battle_id,created_at);
create table public.battle_stats(user_id uuid primary key references auth.users(id) on delete cascade,xp integer not null default 0 check(xp>=0),level integer generated always as(1+xp/100) stored,battles integer not null default 0,wins integer not null default 0,losses integer not null default 0,draws integer not null default 0,streak integer not null default 0,updated_at timestamptz not null default now());
create table public.battle_rewards(battle_id uuid references public.battles(id) on delete cascade,user_id uuid references auth.users(id) on delete cascade,opponent_id uuid not null references auth.users(id) on delete cascade,xp integer not null check(xp between 0 and 25),created_at timestamptz not null default now(),primary key(battle_id,user_id));
create index battle_rewards_abuse_idx on public.battle_rewards(user_id,opponent_id,created_at);
create function public.kaidra_battle_visible(target_battle uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.battles b where b.id=target_battle and public.kaidra_is_conversation_member(b.conversation_id));
$$;
create function public.kaidra_battle_event() returns trigger language plpgsql security definer set search_path='' as $$
declare label text;uid uuid;begin
 if tg_op='INSERT' or new.status is distinct from old.status then
 label:=case new.status when 'pending' then 'A friendly challenge was issued' when 'active' then 'Debate started' when 'resolved' then case when new.winner_id is null then 'The debate ended in a draw' else 'The debate has a winner' end when 'declined' then 'Challenge declined' when 'cancelled' then 'Challenge cancelled' else 'Challenge expired' end;
 insert into public.messages(conversation_id,sender_id,content,message_type,event_data) values(new.conversation_id,coalesce(auth.uid(),new.challenger_id),label||' · '||new.topic,'system',jsonb_build_object('kind','battle','battle_id',new.id,'status',new.status));
 for uid in select user_id from public.conversation_participants where conversation_id=new.conversation_id loop perform public.kaidra_social_signal(uid);end loop;
 if new.status='pending' then perform public.kaidra_notify(new.challenged_id,'battle','battle:'||new.id||':pending','You’ve been challenged',new.topic,'inbox/'||new.conversation_id,jsonb_build_object('battle_id',new.id,'conversation_id',new.conversation_id));
 elsif new.status in('active','declined','resolved') then
 for uid in select unnest(array[new.challenger_id,new.challenged_id]) loop
 perform public.kaidra_notify(uid,'battle','battle:'||new.id||':'||new.status,label,new.topic,'inbox/'||new.conversation_id,jsonb_build_object('battle_id',new.id,'conversation_id',new.conversation_id));end loop;
 end if;
 end if;return null;
end $$;
create trigger kaidra_battle_event after insert or update on public.battles for each row execute function public.kaidra_battle_event();
create function public.kaidra_battle_create(target_conversation uuid,target_user uuid,topic text,stance text,context jsonb default '{}',request_id uuid default gen_random_uuid()) returns uuid language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.conversations where id=target_conversation for share;
 if not public.kaidra_can_send_message(target_conversation) or not public.kaidra_friends(auth.uid(),target_user) or not exists(select 1 from public.conversation_participants where conversation_id=target_conversation and user_id=target_user) then raise exception 'Challenge a friend in this conversation';end if;
 if exists(select 1 from public.battles where id=request_id and challenger_id=auth.uid() and challenged_id=target_user and conversation_id=target_conversation) then return request_id;end if;
 if topic is null or length(trim(topic)) not between 1 and 240 or stance is null or length(trim(stance)) not between 1 and 1200 or jsonb_typeof(context)<>'object' or octet_length(context::text)>=12000 then raise exception 'Add a topic and your stance';end if;
 perform pg_advisory_xact_lock(hashtextextended('kaidra:battle:'||least(auth.uid(),target_user)::text||greatest(auth.uid(),target_user)::text,0));
 update public.battles set status='expired' where status='pending' and created_at<now()-interval '1 day' and auth.uid() in(challenger_id,challenged_id);
 if (select count(*) from public.battles where challenger_id=auth.uid() and created_at>now()-interval '1 day')>=5 or exists(select 1 from public.battles where least(challenger_id,challenged_id)=least(auth.uid(),target_user) and greatest(challenger_id,challenged_id)=greatest(auth.uid(),target_user) and created_at>now()-interval '12 hours') then raise exception 'Give this matchup a break. Try another friend later';end if;
 insert into public.battles(id,conversation_id,challenger_id,challenged_id,topic,challenger_position,context) values(request_id,target_conversation,auth.uid(),target_user,trim(topic),trim(stance),context);return request_id;
end $$;
create function public.kaidra_battle_resolve(target_battle uuid,winner uuid,mechanism text) returns void language plpgsql security definer set search_path='' as $$
declare b public.battles;uid uuid;opponent uuid;amount integer;eligible boolean;begin
 select * into b from public.battles where id=target_battle for update;if b.status<>'active' then return;end if;
 if winner is not null and winner not in(b.challenger_id,b.challenged_id) then raise exception 'Invalid winner';end if;
 eligible:=winner is not null and mechanism='community_vote' and (select count(*) from public.battle_votes v join public.conversation_participants cp on cp.user_id=v.user_id and cp.conversation_id=b.conversation_id join auth.users u on u.id=v.user_id where v.battle_id=b.id and coalesce(u.created_at,now())<now()-interval '7 days' and (public.kaidra_friends(v.user_id,b.challenger_id) or public.kaidra_friends(v.user_id,b.challenged_id)))>=3 and not exists(select 1 from auth.users where id in(b.challenger_id,b.challenged_id) and coalesce(created_at,now())>now()-interval '7 days');
 for uid in select unnest(array[b.challenger_id,b.challenged_id]) order by 1 loop perform pg_advisory_xact_lock(hashtextextended('kaidra:xp:'||uid,0));end loop;
 for uid in select unnest(array[b.challenger_id,b.challenged_id]) loop
 opponent:=case when uid=b.challenger_id then b.challenged_id else b.challenger_id end;
 amount:=case when eligible and not exists(select 1 from public.battle_rewards where user_id=uid and opponent_id=opponent and xp>0 and created_at>now()-interval '7 days') then least(case when uid=winner then 25 else 5 end,greatest(0,50-coalesce((select sum(xp) from public.battle_rewards where user_id=uid and created_at>=date_trunc('day',now())),0)::integer)) else 0 end;
 insert into public.battle_rewards values(b.id,uid,opponent,amount,now()) on conflict do nothing;
 insert into public.battle_stats(user_id,xp,battles,wins,losses,draws,streak) values(uid,amount,1,case when uid=winner then 1 else 0 end,case when winner is not null and uid<>winner then 1 else 0 end,case when winner is null then 1 else 0 end,case when uid=winner then 1 else 0 end)
 on conflict(user_id) do update set xp=battle_stats.xp+excluded.xp,battles=battle_stats.battles+1,wins=battle_stats.wins+excluded.wins,losses=battle_stats.losses+excluded.losses,draws=battle_stats.draws+excluded.draws,streak=case when uid=winner then battle_stats.streak+1 else 0 end,updated_at=now();
 end loop;
 update public.battles set status='resolved',winner_id=winner,outcome=mechanism,resolved_at=now() where id=b.id;
end $$;
create function public.kaidra_battle_action(target_battle uuid,action text,value text default '') returns void language plpgsql security definer set search_path='' as $$
declare b public.battles;cid uuid;count_a integer;count_b integer;winner uuid;begin
 select conversation_id into cid from public.battles where id=target_battle;perform 1 from public.conversations where id=cid for share;
 if not public.kaidra_is_conversation_member(cid) then raise exception 'Conversation membership required';end if;
 select * into b from public.battles where id=target_battle for update;
 if not public.kaidra_friends(b.challenger_id,b.challenged_id) then raise exception 'This matchup is no longer available';end if;
 if action='accept' then
  if auth.uid()<>b.challenged_id or b.status<>'pending' or b.created_at<now()-interval '1 day' or length(trim(value)) not between 1 and 1200 then raise exception 'Only the invited friend can accept with a stance';end if;
  update public.battles set status='active',challenged_position=trim(value),accepted_at=now(),ends_at=now()+interval '1 day' where id=b.id;
 elsif action in('decline','cancel') then
  if b.status<>'pending' or (action='decline' and auth.uid()<>b.challenged_id) or (action='cancel' and auth.uid()<>b.challenger_id) then raise exception 'This challenge cannot be changed';end if;
  update public.battles set status=case when action='decline' then 'declined' else 'cancelled' end where id=b.id;
 elsif action='vote' then
  if b.status<>'active' or now()>=b.ends_at or auth.uid() in(b.challenger_id,b.challenged_id) or value not in(b.challenger_id::text,b.challenged_id::text) or not(public.kaidra_friends(auth.uid(),b.challenger_id) or public.kaidra_friends(auth.uid(),b.challenged_id)) then raise exception 'Only eligible spectators can vote on an active debate';end if;
  insert into public.battle_votes values(b.id,auth.uid(),value::uuid,now()) on conflict(battle_id,user_id) do update set side=excluded.side;
  perform public.kaidra_social_signal(b.challenger_id);perform public.kaidra_social_signal(b.challenged_id);
 elsif action='post' then
  if b.status<>'active' or now()>=b.ends_at or auth.uid() not in(b.challenger_id,b.challenged_id) or length(trim(value)) not between 1 and 1200 then raise exception 'Only participants can add a stance';end if;
  if (select count(*) from public.battle_posts where battle_id=b.id and user_id=auth.uid())>=6 or exists(select 1 from public.battle_posts where battle_id=b.id and user_id=auth.uid() and created_at>now()-interval '1 minute') then raise exception 'Take a moment before adding another argument';end if;
  insert into public.battle_posts(battle_id,user_id,body) values(b.id,auth.uid(),trim(value));
 elsif action='concede' then
  if b.status<>'active' or auth.uid() not in(b.challenger_id,b.challenged_id) then raise exception 'Only a participant can concede';end if;
  perform public.kaidra_battle_resolve(b.id,case when auth.uid()=b.challenger_id then b.challenged_id else b.challenger_id end,'concession');
 elsif action='draw' then
  if b.status<>'active' or auth.uid() not in(b.challenger_id,b.challenged_id) then raise exception 'Only participants can agree a draw';end if;
  if b.draw_offered_by is not null and b.draw_offered_by<>auth.uid() then perform public.kaidra_battle_resolve(b.id,null,'draw');else update public.battles set draw_offered_by=auth.uid() where id=b.id;end if;
 elsif action='finish' then
  if b.status<>'active' or (now()<b.ends_at and (auth.uid() not in(b.challenger_id,b.challenged_id) or now()<b.accepted_at+interval '5 minutes')) then raise exception 'Voting is still open';end if;
  select count(*) filter(where v.side=b.challenger_id),count(*) filter(where v.side=b.challenged_id) into count_a,count_b from public.battle_votes v join public.conversation_participants cp on cp.user_id=v.user_id and cp.conversation_id=b.conversation_id where v.battle_id=b.id and (public.kaidra_friends(v.user_id,b.challenger_id) or public.kaidra_friends(v.user_id,b.challenged_id));
  if count_a+count_b<3 and now()<b.ends_at then raise exception 'At least three spectators need to vote';end if;
  winner:=case when count_a+count_b<3 or count_a=count_b then null when count_a>count_b then b.challenger_id else b.challenged_id end;
  perform public.kaidra_battle_resolve(b.id,winner,case when winner is null then 'draw' else 'community_vote' end);
 else raise exception 'Unknown battle action';end if;
end $$;
create function public.kaidra_battle_state(target_battle uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare b public.battles;begin
 if not public.kaidra_battle_visible(target_battle) then raise exception 'Conversation membership required';end if;
 select * into b from public.battles where id=target_battle;
 return to_jsonb(b)||jsonb_build_object('participants',(select jsonb_agg(jsonb_build_object('id',id,'display_name',display_name,'username',username,'avatar_url',avatar_url)) from public.profiles where id in(b.challenger_id,b.challenged_id)),'votes',coalesce((select jsonb_agg(jsonb_build_object('side',side,'count',n)) from(select side,count(*) n from public.battle_votes v join public.conversation_participants cp on cp.user_id=v.user_id and cp.conversation_id=b.conversation_id where battle_id=b.id and (public.kaidra_friends(v.user_id,b.challenger_id) or public.kaidra_friends(v.user_id,b.challenged_id)) group by side) counts),'[]'::jsonb),'own_vote',(select side from public.battle_votes where battle_id=b.id and user_id=auth.uid()),'posts',coalesce((select jsonb_agg(to_jsonb(p) order by created_at) from public.battle_posts p where battle_id=b.id),'[]'::jsonb),'rewards',coalesce((select jsonb_agg(jsonb_build_object('user_id',user_id,'xp',xp)) from public.battle_rewards where battle_id=b.id),'[]'::jsonb));
end $$;
create function public.kaidra_battle_membership() returns trigger language plpgsql security definer set search_path='' as $$
begin update public.battles set status='cancelled' where conversation_id=old.conversation_id and old.user_id in(challenger_id,challenged_id) and status in('pending','active');return null;end $$;
create trigger kaidra_battle_membership after delete on public.conversation_participants for each row execute function public.kaidra_battle_membership();
do $$ declare t text;begin foreach t in array array['battles','battle_votes','battle_posts','battle_stats','battle_rewards'] loop execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from anon,authenticated',t);execute format('grant select on public.%I to authenticated',t);end loop;end $$;
create policy "Conversation battles" on public.battles for select to authenticated using(public.kaidra_battle_visible(id));
create policy "Conversation votes" on public.battle_votes for select to authenticated using(public.kaidra_battle_visible(battle_id));
create policy "Conversation arguments" on public.battle_posts for select to authenticated using(public.kaidra_battle_visible(battle_id));
create policy "Profile progression" on public.battle_stats for select to authenticated using(true);
create policy "Own rewards" on public.battle_rewards for select to authenticated using(user_id=auth.uid());
do $$ declare signature text;begin foreach signature in array array['kaidra_battle_visible(uuid)','kaidra_battle_create(uuid,uuid,text,text,jsonb,uuid)','kaidra_battle_resolve(uuid,uuid,text)','kaidra_battle_action(uuid,text,text)','kaidra_battle_state(uuid)'] loop execute 'revoke all on function public.'||signature||' from public,anon,authenticated';end loop;
 foreach signature in array array['kaidra_battle_visible(uuid)','kaidra_battle_create(uuid,uuid,text,text,jsonb,uuid)','kaidra_battle_action(uuid,text,text)','kaidra_battle_state(uuid)'] loop execute 'grant execute on function public.'||signature||' to authenticated';end loop;end $$;
alter publication supabase_realtime add table public.battles,public.battle_votes,public.battle_posts;
notify pgrst,'reload schema';
commit;
