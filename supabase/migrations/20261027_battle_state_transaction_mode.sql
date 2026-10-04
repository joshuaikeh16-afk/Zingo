begin;
-- The public wrapper delegates to an existing expiry UPDATE. PostgREST runs
-- STABLE RPCs in read-only transactions, even for POST. Preserve the function
-- body, permissions, membership checks and private reward filtering.
alter function public.kaidra_battle_state(uuid) volatile;
notify pgrst,'reload schema';
commit;
