begin;
-- Extend private conversation media without changing existing photos or recordings.
alter table public.messages add column media_metadata jsonb not null default '{}';
alter table public.messages add constraint messenger_metadata_size check(jsonb_typeof(media_metadata)='object' and octet_length(media_metadata::text)<4096);
alter table public.messages drop constraint messages_message_type_check;
alter table public.messages add constraint messages_message_type_check check(message_type in('text','image','voice_note','sticker','video','document','status_reply','forwarded_video','forwarded_news','forwarded_sotd','poll','system','discussion'));
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values
 ('chat-media','chat-media',false,26214400,array['image/webp','image/png','image/gif','image/jpeg','video/mp4','video/webm','application/pdf','text/plain','application/zip','application/octet-stream','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.presentationml.presentation']),
 ('user-stickers','user-stickers',false,2097152,array['image/webp','image/png','image/gif']) on conflict(id) do nothing;
create function public.kaidra_media_access(object_path text, writing boolean default false) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.conversation_participants cp where cp.user_id=auth.uid() and cp.conversation_id::text=split_part(object_path,'/',1) and (not writing or public.kaidra_can_send_message(cp.conversation_id))) and object_path ~ '^[0-9a-f-]{36}/[a-zA-Z0-9_-]+\.[a-z0-9]{1,10}$';
$$;
revoke all on function public.kaidra_media_access(text,boolean) from public,anon;
grant execute on function public.kaidra_media_access(text,boolean) to authenticated;
create policy "Conversation media read" on storage.objects for select to authenticated using(bucket_id='chat-media' and public.kaidra_media_access(name));
create policy "Conversation media upload" on storage.objects for insert to authenticated with check(bucket_id='chat-media' and public.kaidra_media_access(name,true));
create policy "Own unused media cleanup" on storage.objects for delete to authenticated using(bucket_id='chat-media' and owner_id=auth.uid()::text and public.kaidra_media_access(name) and not exists(select 1 from public.messages where media_url=objects.name and message_type in('video','document','sticker')));
create policy "Private sticker files" on storage.objects for all to authenticated using(bucket_id='user-stickers' and split_part(name,'/',1)=auth.uid()::text) with check(bucket_id='user-stickers' and split_part(name,'/',1)=auth.uid()::text);
create table public.user_stickers(id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,label text not null check(length(label) between 1 and 100),path text not null unique,created_at timestamptz not null default now(),check(path ~ '^[0-9a-f-]{36}/[a-zA-Z0-9_-]+\.(webp|png|gif)$' and split_part(path,'/',1)=user_id::text));
alter table public.user_stickers enable row level security;
grant select,insert,delete on public.user_stickers to authenticated;
create policy "Own sticker library" on public.user_stickers for all to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
create function public.kaidra_validate_messenger_media() returns trigger language plpgsql security definer set search_path='' as $$
declare object_meta jsonb; mime text; bytes bigint; filename text;begin
 if new.message_type not in('video','document','sticker') or new.media_url is null and new.message_type='sticker' then return new;end if;
 if new.media_url is null or new.media_url !~ ('^'||new.conversation_id::text||'/[a-zA-Z0-9_-]+\.[a-z0-9]{1,10}$') then raise exception 'Media must belong to this conversation';end if;
 select metadata into object_meta from storage.objects where bucket_id='chat-media' and name=new.media_url;
 if object_meta is null then raise exception 'Upload media before sending';end if;
 mime:=object_meta->>'mimetype';bytes:=(object_meta->>'size')::bigint;
 if bytes is null or bytes<=0 or bytes>26214400 or mime is null then raise exception 'Invalid uploaded media';end if;
 if new.message_type='sticker' and (mime not in('image/webp','image/png','image/gif') or bytes>2097152) or new.message_type='video' and mime not in('video/mp4','video/webm') or new.message_type='document' and (mime not in('application/pdf','text/plain','application/zip','application/octet-stream','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.presentationml.presentation') or bytes>20971520) then raise exception 'Unsupported media format or size';end if;
 filename:=left(coalesce(nullif(new.media_metadata->>'name',''),'Attachment'),150);
 new.media_metadata:=jsonb_build_object('name',filename,'mime',mime,'size',bytes);
 return new;
end $$;
create trigger kaidra_messenger_media before insert on public.messages for each row execute function public.kaidra_validate_messenger_media();
revoke all on function public.kaidra_validate_messenger_media() from public,anon,authenticated;
create or replace function public.kaidra_shared_history(target_conversation uuid,category text default 'entertainment',before_time timestamptz default null,before_id uuid default null) returns setof public.messages language plpgsql stable security definer set search_path='' as $$begin
 if not public.kaidra_is_conversation_member(target_conversation) then raise exception 'Membership required';end if;
 return query select * from public.messages m where m.conversation_id=target_conversation and m.deleted_at is null and (before_time is null or (m.created_at,m.id)<(before_time,before_id)) and case category when 'entertainment' then m.shared_content is not null when 'media' then m.message_type in('image','video','voice_note','sticker') when 'docs' then m.message_type='document' when 'links' then m.content ~ 'https?://' else false end order by m.created_at desc,m.id desc limit 30;
end $$;
-- Tokens are bearer invitations. Only hashes are stored; rotating invalidates prior links.
alter table public.conversations add column join_approval boolean not null default false;
create table public.group_invite_links(conversation_id uuid primary key references public.conversations(id) on delete cascade,token_hash text not null unique,created_by uuid not null references auth.users(id) on delete cascade,expires_at timestamptz not null,created_at timestamptz not null default now());
create table public.group_join_requests(conversation_id uuid references public.conversations(id) on delete cascade,user_id uuid references auth.users(id) on delete cascade,created_at timestamptz not null default now(),primary key(conversation_id,user_id));
alter table public.group_invite_links enable row level security;
alter table public.group_join_requests enable row level security;
revoke all on public.group_invite_links,public.group_join_requests from anon,authenticated;
grant select on public.group_join_requests to authenticated;
create policy "Own requests or group admins" on public.group_join_requests for select to authenticated using(user_id=auth.uid() or exists(select 1 from public.conversation_participants cp where cp.conversation_id=group_join_requests.conversation_id and cp.user_id=auth.uid() and cp.role in('owner','admin')));
create function public.kaidra_group_link_manage(target_conversation uuid,operation text default 'status',approval boolean default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare token text; item public.group_invite_links;begin
 if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid() and not is_banned) then raise exception 'Sign in required';end if;
 perform 1 from public.conversations where id=target_conversation and is_group for update;
 if not found or not public.kaidra_is_conversation_member(target_conversation) or exists(select 1 from public.rpg_parties where conversation_id=target_conversation) then raise exception 'Group invite links unavailable';end if;
 if operation='status' then
 select * into item from public.group_invite_links where conversation_id=target_conversation;
 return jsonb_build_object('active',item.expires_at>now(),'expires_at',item.expires_at,'approval',(select join_approval from public.conversations where id=target_conversation));
 end if;
 if not exists(select 1 from public.conversation_participants where conversation_id=target_conversation and user_id=auth.uid() and role in('owner','admin')) then raise exception 'Only admins can manage links and approval';end if;
 if operation='create' then
 token:=encode(extensions.gen_random_bytes(32),'hex');
 insert into public.group_invite_links(conversation_id,token_hash,created_by,expires_at) values(target_conversation,encode(extensions.digest(token,'sha256'),'hex'),auth.uid(),now()+interval '7 days') on conflict(conversation_id) do update set token_hash=excluded.token_hash,created_by=excluded.created_by,expires_at=excluded.expires_at,created_at=now();
 return jsonb_build_object('token',token,'expires_at',now()+interval '7 days');
 elsif operation='revoke' then delete from public.group_invite_links where conversation_id=target_conversation;
 elsif operation='approval' and approval is not null then
 update public.conversations set join_approval=approval where id=target_conversation;
 perform public.kaidra_system_event(target_conversation,'permissions_changed','Join approval updated');
 else raise exception 'Unknown invite action';end if;
 return jsonb_build_object('ok',true);
end $$;
create function public.kaidra_group_join(invite_token text,join_now boolean default false) returns jsonb language plpgsql security definer set search_path='' as $$
declare cid uuid; grp public.conversations; count_members integer; request_count integer;begin
 if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid() and not is_banned and onboarding_completed) then raise exception 'Complete your account first';end if;
 if invite_token is null or invite_token !~ '^[0-9a-f]{64}$' then raise exception 'Invalid or expired invite link';end if;
 select conversation_id into cid from public.group_invite_links where token_hash=encode(extensions.digest(invite_token,'sha256'),'hex') and expires_at>now();
 select * into grp from public.conversations where id=cid and is_group for update;
 if grp.id is null or not exists(select 1 from public.group_invite_links where conversation_id=cid and token_hash=encode(extensions.digest(invite_token,'sha256'),'hex') and expires_at>now()) or exists(select 1 from public.rpg_parties where conversation_id=cid) then raise exception 'Invalid or expired invite link';end if;
 if exists(select 1 from public.user_blocks b join public.conversation_participants cp on cp.conversation_id=cid and cp.role in('owner','admin') where (b.user_id=auth.uid() and b.blocked_user=cp.user_id) or (b.blocked_user=auth.uid() and b.user_id=cp.user_id)) then raise exception 'This group is unavailable';end if;
 select count(*) into count_members from public.conversation_participants where conversation_id=cid;
 if public.kaidra_is_conversation_member(cid) then return jsonb_build_object('status','member','id',cid,'title',grp.title,'avatar_url',grp.avatar_url,'description',grp.description,'count',count_members);end if;
 if join_now then
 if count_members>=50 then raise exception 'This group is full';end if;
 if grp.join_approval then
 select count(*) into request_count from public.group_join_requests where user_id=auth.uid();if request_count>=20 and not exists(select 1 from public.group_join_requests where conversation_id=cid and user_id=auth.uid()) then raise exception 'Too many pending requests';end if;
 insert into public.group_join_requests(conversation_id,user_id) values(cid,auth.uid()) on conflict do nothing;
 return jsonb_build_object('status','pending');
 end if;
 insert into public.conversation_participants(conversation_id,user_id,role) values(cid,auth.uid(),'participant') on conflict do nothing;
 delete from public.group_join_requests where conversation_id=cid and user_id=auth.uid();
 perform public.kaidra_system_event(cid,'member_joined',coalesce((select display_name from public.profiles where id=auth.uid()),'A member')||' joined via invite link',auth.uid());
 return jsonb_build_object('status','joined','id',cid);
 end if;
 return jsonb_build_object('status',case when exists(select 1 from public.group_join_requests where conversation_id=cid and user_id=auth.uid()) then 'pending' else 'preview' end,'title',grp.title,'avatar_url',grp.avatar_url,'description',grp.description,'count',count_members,'approval',grp.join_approval);
end $$;
create function public.kaidra_group_requests(target_conversation uuid,target_user uuid default null,decision text default 'list') returns jsonb language plpgsql security definer set search_path='' as $$
declare grp public.conversations;begin
 select * into grp from public.conversations where id=target_conversation and is_group for update;
 if grp.id is null or exists(select 1 from public.rpg_parties where conversation_id=target_conversation) or not exists(select 1 from public.conversation_participants where conversation_id=target_conversation and user_id=auth.uid() and role in('owner','admin')) then raise exception 'Only group admins can review requests';end if;
 if decision='list' then return coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'display_name',p.display_name,'username',p.username,'avatar_url',p.avatar_url,'created_at',r.created_at)) from public.group_join_requests r join public.profiles p on p.id=r.user_id where r.conversation_id=target_conversation),'[]');end if;
 if not exists(select 1 from public.group_join_requests where conversation_id=target_conversation and user_id=target_user) then raise exception 'Request unavailable';end if;
 if decision='approve' then
 if not exists(select 1 from public.profiles where id=target_user and not is_banned) or exists(select 1 from public.user_blocks b join public.conversation_participants cp on cp.conversation_id=target_conversation and cp.role in('owner','admin') where (b.user_id=target_user and b.blocked_user=cp.user_id) or (b.blocked_user=target_user and b.user_id=cp.user_id)) then raise exception 'This member is unavailable';end if;
 if (select count(*) from public.conversation_participants where conversation_id=target_conversation)>=50 then raise exception 'This group is full';end if;
 insert into public.conversation_participants(conversation_id,user_id,role) values(target_conversation,target_user,'participant') on conflict do nothing;
 perform public.kaidra_system_event(target_conversation,'member_joined',coalesce((select display_name from public.profiles where id=target_user),'A member')||' joined the group',target_user);
 elsif decision<>'reject' then raise exception 'Unknown request action';end if;
 delete from public.group_join_requests where conversation_id=target_conversation and user_id=target_user;
 return jsonb_build_object('ok',true);
end $$;
revoke all on function public.kaidra_group_link_manage(uuid,text,boolean),public.kaidra_group_join(text,boolean),public.kaidra_group_requests(uuid,uuid,text) from public,anon;
grant execute on function public.kaidra_group_link_manage(uuid,text,boolean),public.kaidra_group_join(text,boolean),public.kaidra_group_requests(uuid,uuid,text) to authenticated;
notify pgrst,'reload schema';
commit;
