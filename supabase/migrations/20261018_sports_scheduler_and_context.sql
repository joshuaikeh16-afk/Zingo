begin;
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
create function public.kaidra_sports_ingest(items jsonb) returns void language plpgsql security definer set search_path='' as $$begin
 insert into public.sports_entities(sport,provider,entity_type,external_id,display_name,snapshot,verified_at)
 select sport,provider,entity_type,external_id,display_name,snapshot,now() from jsonb_to_recordset(items) x(sport text,provider text,entity_type text,external_id text,display_name text,snapshot jsonb)
 on conflict(sport,provider,entity_type,external_id) do update set display_name=excluded.display_name,snapshot=sports_entities.snapshot||excluded.snapshot||case when excluded.entity_type='player' then jsonb_build_object('player',coalesce(sports_entities.snapshot->'player','{}')||coalesce(excluded.snapshot->'player','{}')) else '{}' end,verified_at=excluded.verified_at;
end $$;
revoke all on function public.kaidra_sports_ingest(jsonb) from public,anon,authenticated;
grant execute on function public.kaidra_sports_ingest(jsonb) to service_role;
create or replace function public.kaidra_sports_cache_store(key text,payload jsonb,ttl integer,code text default null,remaining integer default null) returns void language plpgsql security definer set search_path='' as $$begin
 if code is null then update public.sports_provider_cache set data=payload,fetched_at=now(),expires_at=now()+make_interval(secs=>least(greatest(ttl,60),604800)),error_code=null,error_until=null,lease_until=null where cache_key=key;
 else update public.sports_provider_cache set error_code=code,error_until=now()+interval '5 minutes',lease_until=null where cache_key=key;end if;
 if remaining<=5 then update public.sports_provider_budget set blocked_until=(date_trunc('day',now() at time zone 'UTC') at time zone 'UTC')+interval '1 day' where day=(now() at time zone 'UTC')::date;end if;
end $$;
create or replace function public.kaidra_sports_message_guard() returns trigger language plpgsql security definer set search_path='' as $$declare ref jsonb;e public.sports_entities;i integer;begin
 for i in 1..2 loop
 ref:=case when i=1 and new.shared_content->>'kind'='sports' then new.shared_content when i=2 then new.sports_context end;
 if ref is not null then
 select * into e from public.sports_entities where sport=ref->>'sport' and provider=ref->>'provider' and entity_type=ref->>'entity_type' and external_id=ref->>'external_id';
 if e.external_id is null then raise exception 'Choose verified sports context';end if;
 ref:=jsonb_build_object('kind','sports','sport',e.sport,'provider',e.provider,'entity_type',e.entity_type,'external_id',e.external_id,'title',e.display_name,'image',e.snapshot->>'image');
 if i=1 then new.shared_content:=ref;else if new.message_type<>'discussion' then raise exception 'Sports context requires a Discussion';end if;new.sports_context:=ref;end if;
 end if;end loop;return new;
end $$;
-- Vault secret is provisioned separately; no credential is committed to this job.
create function public.kaidra_schedule_sports_sync() returns bigint language plpgsql security definer set search_path='' as $$declare secret text;request_id bigint;begin
 select decrypted_secret into secret from vault.decrypted_secrets where name='kaidra_sports_sync' limit 1;
 if secret is null then return null;end if;
 select net.http_post(url:='https://skmlktywdmsbjyybtmhm.supabase.co/functions/v1/sports-sync',headers:=jsonb_build_object('Content-Type','application/json','x-sync-secret',secret),body:='{}'::jsonb,timeout_milliseconds:=60000) into request_id;return request_id;
end $$;
revoke all on function public.kaidra_schedule_sports_sync() from public,anon,authenticated;
grant execute on function public.kaidra_schedule_sports_sync() to service_role;
select cron.schedule('kaidra-sports-sync','*/30 * * * *','select public.kaidra_schedule_sports_sync()');
notify pgrst,'reload schema';
commit;
