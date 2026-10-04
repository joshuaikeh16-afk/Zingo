begin;
do $$begin
 if (select provolatile from pg_proc where oid='public.kaidra_battle_state(uuid)'::regprocedure)<>'v' then raise exception 'Battle-state RPC must allow expiry writes';end if;
 if not has_function_privilege('authenticated','public.kaidra_battle_state(uuid)','execute') or has_function_privilege('anon','public.kaidra_battle_state(uuid)','execute') then raise exception 'Battle-state authentication boundary changed';end if;
 if has_function_privilege('authenticated','public.kaidra_battle_state_preparty(uuid)','execute') or has_function_privilege('authenticated','public.kaidra_battle_state_internal(uuid)','execute') then raise exception 'Internal reward filtering can be bypassed';end if;
 if not (select prosecdef from pg_proc where oid='public.kaidra_battle_state(uuid)'::regprocedure) then raise exception 'Battle-state protected execution changed';end if;
end $$;
rollback;
