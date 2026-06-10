-- 045b_wc2026_lock_window_and_sync.sql
-- Two changes to the WC2026 pool:
--
-- 1) Lock rule: predictions stay editable until 30 MINUTES BEFORE kickoff
--    (was: until kickoff). Same moment also reveals everyone's predictions
--    (safe — nobody can edit anymore) and locks/reveals champion picks.
--
-- 2) wc_sync_match(): keyless, client-callable schedule sync so knockout
--    fixtures flow into wc_matches automatically when ESPN publishes them —
--    no service key, no manual step. Abuse-bounded:
--      * insert-only for new ids (a fresh row has no predictions to leak or
--        unlock), kickoff must be >10 min in the future and inside the
--        tournament window, ids numeric, hard row cap;
--      * existing rows can only have kickoff corrected EARLIER, so a
--        poisoned-late kickoff gets self-healed by every honest client and
--        nobody can extend their editing window. Admin RPC can fix anything.

-- ── 30-minute lock window ───────────────────────────────────────────────────

drop policy if exists wc_predictions_read on public.wc_predictions;
create policy wc_predictions_read on public.wc_predictions for select
  using (exists (select 1 from public.wc_matches m
                 where m.id = match_id
                   and m.kickoff - interval '30 minutes' <= now()));

drop policy if exists wc_finals_read on public.wc_finals;
create policy wc_finals_read on public.wc_finals for select
  using ((select min(kickoff) from public.wc_matches) - interval '30 minutes' <= now());

create or replace function public.wc_save_prediction(
  p_token uuid, p_match_id text, p_home integer, p_away integer)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_player  uuid;
  v_kickoff timestamptz;
begin
  select id into v_player from public.wc_players where token = p_token;
  if v_player is null then raise exception 'BAD_TOKEN'; end if;

  select kickoff into v_kickoff from public.wc_matches where id = p_match_id;
  if v_kickoff is null then raise exception 'NO_MATCH'; end if;
  if now() >= v_kickoff - interval '30 minutes' then raise exception 'LOCKED'; end if;

  if p_home is null or p_away is null
     or p_home not between 0 and 30 or p_away not between 0 and 30 then
    raise exception 'SCORE_INVALID';
  end if;

  insert into public.wc_predictions (player_id, match_id, home_goals, away_goals)
  values (v_player, p_match_id, p_home, p_away)
  on conflict (player_id, match_id) do update
    set home_goals = excluded.home_goals,
        away_goals = excluded.away_goals,
        updated_at = now();
end;
$$;

create or replace function public.wc_save_final(
  p_token uuid, p_champion text, p_total_goals integer)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_player uuid;
begin
  select id into v_player from public.wc_players where token = p_token;
  if v_player is null then raise exception 'BAD_TOKEN'; end if;

  if (select min(kickoff) from public.wc_matches) - interval '30 minutes' <= now() then
    raise exception 'LOCKED';
  end if;
  if p_champion is null or char_length(btrim(p_champion)) not between 2 and 40 then
    raise exception 'CHAMPION_INVALID';
  end if;
  if p_total_goals is not null and p_total_goals not between 0 and 1000 then
    raise exception 'GOALS_INVALID';
  end if;

  insert into public.wc_finals (player_id, champion, total_goals)
  values (v_player, btrim(p_champion), p_total_goals)
  on conflict (player_id) do update
    set champion = excluded.champion,
        total_goals = excluded.total_goals,
        updated_at = now();
end;
$$;

-- ── Keyless schedule sync ───────────────────────────────────────────────────

create or replace function public.wc_sync_match(
  p_id text, p_kickoff timestamptz, p_stage text default 'GROUP', p_group text default null)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_existing timestamptz;
begin
  if p_id is null or p_id !~ '^[0-9]{3,18}$' then raise exception 'ID_INVALID'; end if;
  if p_kickoff is null then raise exception 'KICKOFF_INVALID'; end if;

  select kickoff into v_existing from public.wc_matches where id = p_id;

  if v_existing is null then
    if p_kickoff < now() + interval '10 minutes'
       or p_kickoff < '2026-06-01'::timestamptz
       or p_kickoff > '2026-07-25'::timestamptz then
      raise exception 'KICKOFF_INVALID';
    end if;
    if p_stage is null or p_stage not in ('GROUP','R32','R16','QF','SF','THIRD','FINAL') then
      raise exception 'STAGE_INVALID';
    end if;
    if p_group is not null and p_group !~ '^[A-L]$' then
      raise exception 'GROUP_INVALID';
    end if;
    if (select count(*) from public.wc_matches) >= 130 then
      raise exception 'TOO_MANY_MATCHES';
    end if;
    insert into public.wc_matches (id, stage, group_name, kickoff)
    values (p_id, p_stage, p_group, p_kickoff);
  else
    -- Corrections may only move kickoff earlier, and only while the match
    -- hasn't locked yet (so a passed lock can never be re-opened).
    if p_kickoff >= v_existing
       or now() >= v_existing - interval '30 minutes'
       or p_kickoff < now() + interval '10 minutes' then
      return;  -- silently ignore non-improving or unsafe updates
    end if;
    update public.wc_matches set kickoff = p_kickoff where id = p_id;
  end if;
end;
$$;

revoke execute on function public.wc_sync_match(text, timestamptz, text, text) from public;
grant execute on function public.wc_sync_match(text, timestamptz, text, text) to anon, authenticated;
