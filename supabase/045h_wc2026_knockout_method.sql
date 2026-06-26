-- 045h_wc2026_knockout_method.sql
-- Knockout matches: predict HOW it's decided (normal time / extra time /
-- penalties) for +3, replacing the "who advances" pick. Group matches ignore
-- it. wc_matches.decided_by is an optional admin override of the actual result
-- (ESPN's extra-time signal isn't always reliable; penalties are certain).

alter table public.wc_predictions
  add column if not exists method_pick text
  check (method_pick is null or method_pick in ('REGULAR','EXTRA','PENS'));

alter table public.wc_matches
  add column if not exists decided_by text
  check (decided_by is null or decided_by in ('REGULAR','EXTRA','PENS'));

drop function if exists public.wc_save_prediction(uuid, text, integer, integer, text);

create or replace function public.wc_save_prediction(
  p_token uuid, p_match_id text, p_home integer, p_away integer,
  p_advances text default null, p_method text default null)
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

  insert into public.wc_predictions (player_id, match_id, home_goals, away_goals, method_pick)
  values (v_player, p_match_id, p_home, p_away, p_method)
  on conflict (player_id, match_id) do update
    set home_goals  = excluded.home_goals,
        away_goals  = excluded.away_goals,
        method_pick = excluded.method_pick,
        updated_at  = now();
end;
$$;

revoke execute on function public.wc_save_prediction(uuid, text, integer, integer, text, text) from public;
grant execute on function public.wc_save_prediction(uuid, text, integer, integer, text, text) to anon, authenticated;

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
               'match_id', p.match_id, 'h', p.home_goals, 'a', p.away_goals, 'method', p.method_pick))
      from public.wc_predictions p where p.player_id = v.id), '[]'::json),
    'final', (select json_build_object('champion', f.champion, 'top_scorer', f.top_scorer)
      from public.wc_finals f where f.player_id = v.id)
  );
end;
$$;

create or replace function public.wc_admin_set_decided(
  p_token uuid, p_match_id text, p_method text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if not exists (select 1 from public.wc_players where token = p_token and is_admin) then
    raise exception 'NOT_ADMIN';
  end if;
  if p_method is not null and p_method not in ('REGULAR','EXTRA','PENS') then
    raise exception 'METHOD_INVALID';
  end if;
  update public.wc_matches set decided_by = p_method where id = p_match_id;
  if not found then raise exception 'NO_MATCH'; end if;
end;
$$;

revoke execute on function public.wc_admin_set_decided(uuid, text, text) from public;
grant execute on function public.wc_admin_set_decided(uuid, text, text) to anon, authenticated;
