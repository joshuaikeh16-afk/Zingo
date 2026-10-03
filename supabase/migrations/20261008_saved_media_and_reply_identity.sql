begin;
alter table public.messages drop constraint kaidra_shared_content_shape;
alter table public.messages add constraint kaidra_shared_content_shape check(shared_content is null or (jsonb_typeof(shared_content)='object' and octet_length(shared_content::text)<20000 and coalesce(shared_content->>'kind' in ('movie','tv','match','article','anime','manga') and length(shared_content->>'title') between 1 and 300,false)));
alter table public.messages add column mention_labels jsonb not null default '[]';
create or replace function public.kaidra_store_mentions() returns trigger language plpgsql security definer set search_path='' as $$
declare recipient uuid; begin
 if not exists(select 1 from public.conversations where id=new.conversation_id and is_group) then return null; end if;
 insert into public.message_mentions(message_id,user_id,conversation_id) select new.id,uid,new.conversation_id from unnest(new.mention_ids) uid where uid<>new.sender_id on conflict do nothing;
 -- Replies notify the original author even when no explicit @token is typed.
 select sender_id into recipient from public.messages where id::text=new.external_ref_id and conversation_id=new.conversation_id;
 if recipient is not null and recipient<>new.sender_id and exists(select 1 from public.conversation_participants where conversation_id=new.conversation_id and user_id=recipient) then
  insert into public.message_mentions(message_id,user_id,conversation_id) values(new.id,recipient,new.conversation_id) on conflict do nothing;
 end if;
 return null;
end $$;
create function public.kaidra_snapshot_mentions() returns trigger language plpgsql security definer set search_path='' as $$
begin
 new.mention_labels:=coalesce((select jsonb_agg(jsonb_build_object('user_id',id,'username',username)) from public.profiles where id=any(new.mention_ids)),'[]'::jsonb);
 return new;
end $$;
create trigger kaidra_mentions_snapshot before insert on public.messages for each row execute function public.kaidra_snapshot_mentions();
create or replace function public.kaidra_library_save(item jsonb, collection text, saved boolean) returns public.user_watchlist language plpgsql security definer set search_path='' as $$
declare result public.user_watchlist; provider_name text; kind text; eid text; begin
 if auth.uid() is null then raise exception 'Sign in required'; end if;
 kind:=coalesce(item->>'kind',item->>'type');
 provider_name:=coalesce(item->>'provider',case kind when 'movie' then 'tmdb' when 'tv' then 'tmdb' when 'match' then 'football-data' when 'article' then 'news' when 'anime' then 'mal' when 'manga' then 'mal' end);
 eid:=case when kind='article' then item->>'url' else item->>'id' end;
 if collection not in ('favorites','watchlist') or saved is null or provider_name is null or eid is null or length(eid) not between 1 and 2048 or length(coalesce(item->>'title','')) not between 1 and 300 or octet_length(item::text)>=20000 then raise exception 'Invalid saved item'; end if;
 if not (provider_name='tmdb' and kind in ('movie','tv') or provider_name='mal' and kind in ('anime','manga','movie','tv') or provider_name='football-data' and kind='match' or provider_name='news' and kind='article') then raise exception 'Invalid media provider'; end if;
 if provider_name<>'news' and eid !~ '^\d+$' then raise exception 'Invalid media identity'; end if;
 if collection='watchlist' and kind not in ('movie','tv','anime','manga') then raise exception 'Watchlist is for movies and series'; end if;
 insert into public.user_watchlist(user_id,provider,media_type,external_id,status,title,cover_url,snapshot,is_favorite,is_watchlisted)
 values(auth.uid(),provider_name,kind,eid,'planned',item->>'title',item->>'image',item,collection='favorites' and saved,collection='watchlist' and saved)
 on conflict(user_id,provider,media_type,external_id) do update set title=excluded.title,cover_url=excluded.cover_url,snapshot=excluded.snapshot,
 is_favorite=case when collection='favorites' then saved else user_watchlist.is_favorite end,
 is_watchlisted=case when collection='watchlist' then saved else user_watchlist.is_watchlisted end,updated_at=now() returning * into result;
 return result;
end $$;
notify pgrst,'reload schema';
commit;
