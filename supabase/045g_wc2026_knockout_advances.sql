-- 045g_wc2026_knockout_advances.sql
-- Knockout "who advances" prediction. On top of the score, players pick which
-- team goes through (covers extra time + penalties). Worth +2 when right.
-- Group matches ignore it. Preserves the predict_until lock logic from 045f.

alter table public.wc_predictions
  add column if not exists advances text
  check (advances is null or advances in ('home','away'));

create or replace function public.wc_save_prediction(
  p_token uuid, p_match_id text, p_home integer, p_away integer, p_advances text default null)
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
  if p_advances is not null and p_advances not in ('home','away') then
    raise exception 'ADVANCES_INVALID';
  end if;

  insert into public.wc_predictions (player_id, match_id, home_goals, away_goals, advances)
  values (v_player, p_match_id, p_home, p_away, p_advances)
  on conflict (player_id, match_id) do update
    set home_goals = excluded.home_goals,
        away_goals = excluded.away_goals,
        advances   = excluded.advances,
        updated_at = now();
end;
$$;

drop function if exists public.wc_save_prediction(uuid, text, integer, integer);
revoke execute on function public.wc_save_prediction(uuid, text, integer, integer, text) from public;
grant execute on function public.wc_save_prediction(uuid, text, integer, integer, text) to anon, authenticated;

create or replace function public.wc_get_mine(p_token uuid)
returns json
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v public.wc_players%rowtype;
begin
  select * into v from public.wc_players where token = p_token;
  if v.id is null then raise exception 'BAD_TOKEN'; end if;

  return json_build_object(
    'player', json_build_object('id', v.id, 'name', v.name, 'is_admin', v.is_admin),
    'predictions', coalesce((
      select json_agg(json_build_object(
               'match_id', p.match_id, 'h', p.home_goals, 'a', p.away_goals, 'adv', p.advances))
      from public.wc_predictions p where p.player_id = v.id), '[]'::json),
    'final', (
      select json_build_object('champion', f.champion, 'top_scorer', f.top_scorer)
      from public.wc_finals f where f.player_id = v.id)
  );
end;
$$;
