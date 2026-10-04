begin;
alter table public.battle_stats add column best_streak integer not null default 0 check(best_streak>=0);
-- Recover the best run from retained results; existing counters survive deleted conversations.
with results as (
 select b.id,b.resolved_at,u.user_id,b.winner_id=u.user_id as won,
 sum(case when b.winner_id is distinct from u.user_id then 1 else 0 end)
 over(partition by u.user_id order by b.resolved_at,b.id) as run
 from public.battles b cross join lateral unnest(array[b.challenger_id,b.challenged_id]) u(user_id)
 where b.status='resolved'
), runs as (
 select user_id,run,count(*)::integer as length from results where won group by user_id,run
), best as (select user_id,max(length) as length from runs group by user_id)
update public.battle_stats s set best_streak=greatest(s.streak,coalesce((select length from best where user_id=s.user_id),0));

create function public.kaidra_record_best_streak() returns trigger language plpgsql set search_path='' as $$begin
 new.best_streak:=greatest(new.best_streak,new.streak,case when tg_op='UPDATE' then old.best_streak else 0 end);
 return new;
end $$;
create trigger kaidra_record_best_streak before insert or update on public.battle_stats
 for each row execute function public.kaidra_record_best_streak();
revoke all on function public.kaidra_record_best_streak() from public,anon,authenticated;
alter table public.battle_stats add constraint battle_stats_streak_record check(best_streak>=streak);
commit;
