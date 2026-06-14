-- 045f_wc2026_predict_until.sql
-- Per-match prediction-close override. Normally a match locks 30 min before
-- kickoff; an admin can set wc_matches.predict_until to close a single match's
-- prediction window at a custom time. Falls back to the default rule when
-- null, so no other match's behaviour changes.

alter table public.wc_matches add column if not exists predict_until timestamptz;

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
  v_pu      timestamptz;
  v_lock    timestamptz;
begin
  select id into v_player from public.wc_players where token = p_token;
  if v_player is null then raise exception 'BAD_TOKEN'; end if;

  select kickoff, predict_until into v_kickoff, v_pu
    from public.wc_matches where id = p_match_id;
  if v_kickoff is null then raise exception 'NO_MATCH'; end if;

  v_lock := coalesce(v_pu, v_kickoff - interval '30 minutes');
  if now() >= v_lock then raise exception 'LOCKED'; end if;

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

drop policy if exists wc_predictions_read on public.wc_predictions;
create policy wc_predictions_read on public.wc_predictions for select
  using (exists (select 1 from public.wc_matches m
                 where m.id = match_id
                   and coalesce(m.predict_until, m.kickoff - interval '30 minutes') <= now()));
