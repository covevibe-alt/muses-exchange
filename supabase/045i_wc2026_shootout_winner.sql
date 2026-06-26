-- 045i_wc2026_shootout_winner.sql
-- When a player predicts PENALTIES for a knockout match, they can also pick
-- who wins the shootout (+1 if correct). The actual shootout winner comes
-- from ESPN's shootout score / winner flag (reliable). Stored so_pick is only
-- kept when the method pick is PENS.

alter table public.wc_predictions
  add column if not exists so_pick text
  check (so_pick is null or so_pick in ('home','away'));

drop function if exists public.wc_save_prediction(uuid, text, integer, integer, text, text);

create or replace function public.wc_save_prediction(
  p_token uuid, p_match_id text, p_home integer, p_away integer,
  p_advances text default null, p_method text default null, p_so_pick text default null)
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
  if p_method is not null and p_method not in ('REGULAR','EXTRA','PENS') then
    raise exception 'METHOD_INVALID';
  end if;
  if p_so_pick is not null and p_so_pick not in ('home','away') then
    raise exception 'SO_PICK_INVALID';
  end if;

  insert into public.wc_predictions (player_id, match_id, home_goals, away_goals, method_pick, so_pick)
  values (v_player, p_match_id, p_home, p_away, p_method,
          case when p_method = 'PENS' then p_so_pick else null end)
  on conflict (player_id, match_id) do update
    set home_goals  = excluded.home_goals,
        away_goals  = excluded.away_goals,
        method_pick = excluded.method_pick,
        so_pick     = excluded.so_pick,
        updated_at  = now();
end;
$$;

revoke execute on function public.wc_save_prediction(uuid, text, integer, integer, text, text, text) from public;
grant execute on function public.wc_save_prediction(uuid, text, integer, integer, text, text, text) to anon, authenticated;

create or replace function public.wc_get_mine(p_token uuid)
returns json language plpgsql stable security definer set search_path = public, extensions as $$
declare v public.wc_players%rowtype;
begin
  select * into v from public.wc_players where token = p_token;
  if v.id is null then raise exception 'BAD_TOKEN'; end if;
  return json_build_object(
    'player', json_build_object('id', v.id, 'name', v.name, 'is_admin', v.is_admin),
    'predictions', coalesce((
      select json_agg(json_build_object(
               'match_id', p.match_id, 'h', p.home_goals, 'a', p.away_goals,
               'method', p.method_pick, 'so_pick', p.so_pick))
      from public.wc_predictions p where p.player_id = v.id), '[]'::json),
    'final', (select json_build_object('champion', f.champion, 'top_scorer', f.top_scorer)
      from public.wc_finals f where f.player_id = v.id)
  );
end;
$$;
