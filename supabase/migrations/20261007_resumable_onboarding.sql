begin;
-- Existing profiles stay complete; only newly created profiles start incomplete.
alter table public.profiles add column onboarding_completed boolean not null default true;
alter table public.profiles alter column onboarding_completed set default false;
create unique index profiles_username_case_unique on public.profiles(lower(username));
create function public.kaidra_valid_username(value text) returns boolean language sql immutable set search_path='' as $$
 select coalesce(value ~ '^[a-z0-9_]{3,24}$' and value not in ('admin','administrator','support','kaidra','system','moderator','official','help','null','undefined'),false);
$$;
create function public.kaidra_profile_username_guard() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='INSERT' or new.username is distinct from old.username then
  new.username:=lower(trim(new.username));
  perform pg_advisory_xact_lock(hashtextextended('kaidra:username:'||new.username,0));
  if not public.kaidra_valid_username(new.username) then raise exception using errcode='22023',message='Choose a different username: 3–24 letters, numbers, or underscores'; end if;
 end if;
 return new;
end $$;
create trigger kaidra_username_guard before insert or update of username on public.profiles for each row execute function public.kaidra_profile_username_guard();
create function public.kaidra_username_available(candidate text) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and public.kaidra_valid_username(lower(trim(candidate))) and not exists(select 1 from public.profiles where lower(username)=lower(trim(candidate)) and id<>auth.uid());
$$;
create table public.onboarding_drafts(user_id uuid primary key references auth.users(id) on delete cascade,
 stage smallint not null default 0 check(stage between 0 and 3), draft jsonb not null default '{}' check(jsonb_typeof(draft)='object' and octet_length(draft::text)<20000), updated_at timestamptz not null default now());
alter table public.onboarding_drafts enable row level security;
create policy "Own onboarding draft" on public.onboarding_drafts for all to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
revoke all on public.onboarding_drafts from anon; grant select,insert,update,delete on public.onboarding_drafts to authenticated;
create function public.kaidra_onboarding_save(payload jsonb, next_stage integer, finish boolean default false)
returns void language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); handle text; display text; categories text[]; genres text[]; prefs jsonb; favorite jsonb;
begin
 if actor is null then raise exception 'Sign in required'; end if;
 if jsonb_typeof(payload) is distinct from 'object' or octet_length(payload::text)>=20000 or next_stage not between 0 and 3 then raise exception 'Invalid setup data'; end if;
 perform pg_advisory_xact_lock(hashtextextended('kaidra:onboarding:'||actor::text,0));
 if not finish then
  insert into public.onboarding_drafts(user_id,stage,draft) values(actor,next_stage,payload)
  on conflict(user_id) do update set stage=excluded.stage,draft=excluded.draft,updated_at=now(); return;
 end if;
 handle:=lower(trim(payload->>'username')); display:=trim(payload->>'display_name');
 if not public.kaidra_valid_username(handle) then raise exception using errcode='22023',message='Choose a valid username'; end if;
 if display is null or length(display) not between 1 and 60 then raise exception using errcode='22023',message='Enter a display name (1–60 characters)'; end if;
 if jsonb_typeof(payload->'categories') is distinct from 'array' then raise exception 'Choose an entertainment interest'; end if;
 select array_agg(distinct value) into categories from jsonb_array_elements_text(payload->'categories') where value in ('movie','tv','anime','football');
 if coalesce(cardinality(categories),0)=0 then raise exception 'Choose an entertainment interest'; end if;
 select coalesce(array_agg(distinct value),'{}') into genres from jsonb_array_elements_text(coalesce(payload->'genres','[]')) where value in ('action','adventure','comedy','drama','fantasy','romance','thriller','mystery','scifi','documentary','animation');
 if coalesce(payload->>'country','NG') !~ '^[A-Z]{2}$' or coalesce(payload->>'language','any') !~ '^(any|[a-z]{2})$' then raise exception 'Choose a valid region and language'; end if;
 if jsonb_typeof(coalesce(payload->'favorites','[]'))<>'array' or jsonb_array_length(coalesce(payload->'favorites','[]'))>3 then raise exception 'Choose up to three favorites'; end if;
 prefs:=jsonb_build_object('content_types',to_jsonb(array_remove(categories,'football')),'genres',to_jsonb(genres),'country',coalesce(payload->>'country','NG'),'language',coalesce(payload->>'language','any'),'providers',coalesce(payload->'providers','[]'),'favorites',coalesce(payload->'favorites','[]'));
 insert into public.profiles(id,username,display_name,avatar_url,interests,recommendation_preferences,onboarding_completed)
 values(actor,handle,display,nullif(payload->>'avatar_url',''),categories||genres,prefs,true)
 on conflict(id) do update set username=excluded.username,display_name=excluded.display_name,avatar_url=excluded.avatar_url,interests=excluded.interests,recommendation_preferences=profiles.recommendation_preferences||excluded.recommendation_preferences,onboarding_completed=true;
 for favorite in select value from jsonb_array_elements(coalesce(payload->'favorites','[]')) loop
  if coalesce(favorite->>'kind',favorite->>'type') in ('movie','tv') and favorite->>'id' ~ '^\d+$' and length(coalesce(favorite->>'title','')) between 1 and 300 then
   perform public.kaidra_library_save(favorite,'favorites',true);
  end if;
 end loop;
 delete from public.onboarding_drafts where user_id=actor;
end $$;
revoke all on function public.kaidra_username_available(text),public.kaidra_onboarding_save(jsonb,integer,boolean) from public,anon;
grant execute on function public.kaidra_username_available(text),public.kaidra_onboarding_save(jsonb,integer,boolean) to authenticated;
notify pgrst,'reload schema';
commit;
