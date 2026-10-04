begin;
-- Authenticated row visibility still follows the existing private party/rivalry RLS.
do $$declare t text;begin foreach t in array array['rpg_parties','rpg_party_members','rpg_party_invites','battle_rivalries'] loop
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=t) then execute format('alter publication supabase_realtime add table public.%I',t);end if;
end loop;end $$;
notify pgrst,'reload schema';
commit;
