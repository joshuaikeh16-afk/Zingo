begin;
create or replace function public.kaidra_combat_finish(target_battle uuid) returns void language plpgsql security definer set search_path='' as $$declare b public.battles;s public.battle_combat_state;fighter public.battle_participants;opponent uuid;amount integer;repeat_count integer;eligible boolean;win boolean;begin
 select * into b from public.battles where id=target_battle for update;select * into s from public.battle_combat_state where battle_id=b.id;
 if b.status<>'active' or s.phase<>'finished' then return;end if;
 -- Rewards depend on actual play and account age, never spectators or popularity.
 eligible:=s.turn>=5 and (select count(*) from public.battle_events where battle_id=b.id and payload#>>'{intent,action}'='act')>=4 and not exists(select 1 from public.battle_participants bp join auth.users u on u.id=bp.user_id where bp.battle_id=b.id and u.created_at>now()-interval '7 days');
 for fighter in select * from public.battle_participants where battle_id=b.id order by user_id loop perform pg_advisory_xact_lock(hashtextextended('kaidra:xp:'||fighter.user_id::text,0));end loop;
 for fighter in select * from public.battle_participants where battle_id=b.id loop
 select user_id into opponent from public.battle_participants where battle_id=b.id and team<>fighter.team order by user_id limit 1;win:=s.winning_team=fighter.team;
 select count(*) into repeat_count from public.battle_rewards where user_id=fighter.user_id and opponent_id=opponent and created_at>now()-interval '1 day';
 amount:=case when eligible and s.winning_team is not null and exists(select 1 from public.battle_events where battle_id=b.id and actor=fighter.user_id and payload#>>'{intent,action}'='act') then least(case when win then case when repeat_count=0 then 25 when repeat_count=1 then 20 when repeat_count=2 then 10 else 0 end else case when repeat_count<3 then 5 else 0 end end,greatest(0,50-coalesce((select sum(xp) from public.battle_rewards where user_id=fighter.user_id and created_at>=date_trunc('day',now())),0)::integer)) else 0 end;
 insert into public.battle_rewards values(b.id,fighter.user_id,opponent,amount,now()) on conflict do nothing;
 insert into public.battle_stats(user_id,xp,battles,wins,losses,draws,streak) values(fighter.user_id,amount,1,case when win then 1 else 0 end,case when s.winning_team is not null and not win then 1 else 0 end,case when s.winning_team is null then 1 else 0 end,case when win then 1 else 0 end)
 on conflict(user_id) do update set xp=battle_stats.xp+excluded.xp,battles=battle_stats.battles+1,wins=battle_stats.wins+excluded.wins,losses=battle_stats.losses+excluded.losses,draws=battle_stats.draws+excluded.draws,streak=case when win then battle_stats.streak+1 else 0 end,updated_at=now();
 end loop;
 update public.battles set status='resolved',winner_id=case s.winning_team when 1 then b.challenger_id when 2 then b.challenged_id else null end,outcome=case when s.winning_team is null then 'draw' else 'combat' end,resolved_at=now() where id=b.id;
end $$;
notify pgrst,'reload schema';
commit;
