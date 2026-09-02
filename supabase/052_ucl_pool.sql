-- 052_ucl_pool.sql
-- UEFA Champions League predictions pool — a sibling of the WC2026 pool
-- (045_*) with its own tables so the live World Cup data is never touched.
--
-- What's different from the World Cup pool, and why:
--  * Format: 36-team league phase (144 matches) -> knockout play-offs -> R16 ->
--    QF -> SF -> final. Everything from the play-offs to the semis is played
--    over TWO LEGS, so `leg` is stored alongside the stage.
--  * `advances` carries the "who goes through" pick. It lives on the SECOND
--    LEG of a tie (and on the final, where it settles a predicted draw), which
--    means it locks with that match and needs no separate tie table.
--  * `ucl_finals` has three season-long picks instead of two: the winner, the
--    team that tops the league phase, and the top scorer.
--
-- Auth, locking and reveal rules are deliberately identical to the WC pool:
-- name + bcrypt-hashed PIN, a per-player uuid token authorising the
-- SECURITY DEFINER RPCs, writes refused at/after the lock, and RLS that keeps
-- everyone else's picks unreadable until the match kicks off.

create extension if not exists pgcrypto;

-- ── Tables ──────────────────────────────────────────────────────────────────

create table if not exists public.ucl_players (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(btrim(name)) between 2 and 24),
  name_lower text generated always as (lower(btrim(name))) stored,
  pin_hash   text not null,
  token      uuid not null default gen_random_uuid(),
  is_admin   boolean not null default false,
  pool       text not null default 'main',
  created_at timestamptz not null default now()
);
-- Names are unique per pool, so two independent pools can both have a "Sander".
create unique index if not exists ucl_players_pool_name_key on public.ucl_players (pool, name_lower);
create unique index if not exists ucl_players_token_key     on public.ucl_players (token);

create table if not exists public.ucl_matches (
  id            text primary key,                 -- ESPN event id
  stage         text not null default 'LEAGUE',   -- LEAGUE | PO | R16 | QF | SF | FINAL
  leg           smallint check (leg in (1, 2)),   -- null for league phase & final
  matchday      smallint check (matchday between 1 and 8),
  kickoff       timestamptz not null,
  predict_until timestamptz,                      -- admin override for one match
  decided_by    text check (decided_by in ('REGULAR', 'EXTRA', 'PENS'))
);

create table if not exists public.ucl_predictions (
  player_id   uuid not null references public.ucl_players(id) on delete cascade,
  match_id    text not null references public.ucl_matches(id) on delete cascade,
  home_goals  smallint not null check (home_goals between 0 and 30),
  away_goals  smallint not null check (away_goals between 0 and 30),
  advances    text check (advances in ('home', 'away')),      -- who goes through
  method_pick text check (method_pick in ('REGULAR', 'EXTRA', 'PENS')),
  so_pick     text check (so_pick in ('home', 'away')),
  updated_at  timestamptz not null default now(),
  primary key (player_id, match_id)
);
create index if not exists ucl_predictions_match_idx on public.ucl_predictions (match_id);

-- Season-long bonus picks, locked at the bonus deadline (default: 30 minutes
-- before the very first kickoff of the league phase).
create table if not exists public.ucl_finals (
  player_id     uuid primary key references public.ucl_players(id) on delete cascade,
  champion      text not null check (char_length(btrim(champion)) between 2 and 60),
  league_winner text check (char_length(btrim(league_winner)) between 2 and 60),
  top_scorer    text check (char_length(btrim(top_scorer)) between 2 and 60),
  updated_at    timestamptz not null default now()
);

-- Admin-settable knobs: bonus_deadline, top_scorer, league_winner.
create table if not exists public.ucl_settings (
  key        text primary key,
  value      text,
  updated_at timestamptz not null default now()
);

-- ── Row level security ──────────────────────────────────────────────────────

alter table public.ucl_players     enable row level security;
alter table public.ucl_matches     enable row level security;
alter table public.ucl_predictions enable row level security;
alter table public.ucl_finals      enable row level security;
alter table public.ucl_settings    enable row level security;

drop policy if exists ucl_matches_read on public.ucl_matches;
create policy ucl_matches_read on public.ucl_matches for select using (true);

drop policy if exists ucl_players_read on public.ucl_players;
create policy ucl_players_read on public.ucl_players for select using (true);

drop policy if exists ucl_settings_read on public.ucl_settings;
create policy ucl_settings_read on public.ucl_settings for select using (true);

-- Everyone else's score predictions stay invisible until the match kicks off.
-- Your own always come back via ucl_get_mine(), which bypasses RLS.
drop policy if exists ucl_predictions_read on public.ucl_predictions;
create policy ucl_predictions_read on public.ucl_predictions for select
  using (exists (select 1 from public.ucl_matches m
                 where m.id = match_id and m.kickoff <= now()));

-- Bonus picks reveal at the bonus deadline.
drop policy if exists ucl_finals_read on public.ucl_finals;
create policy ucl_finals_read on public.ucl_finals for select
  using (now() >= coalesce(
    (select nullif(value, '')::timestamptz from public.ucl_settings where key = 'bonus_deadline'),
    (select min(kickoff) from public.ucl_matches) - interval '30 minutes'));

-- No direct writes from the browser; every write goes through an RPC below.
revoke all on public.ucl_players     from anon, authenticated;
revoke all on public.ucl_matches     from anon, authenticated;
revoke all on public.ucl_predictions from anon, authenticated;
revoke all on public.ucl_finals      from anon, authenticated;
revoke all on public.ucl_settings    from anon, authenticated;

-- Column-level grants keep pin_hash and token unreadable.
grant select (id, name, is_admin, pool, created_at) on public.ucl_players to anon, authenticated;
grant select on public.ucl_matches     to anon, authenticated;
grant select on public.ucl_predictions to anon, authenticated;
grant select on public.ucl_finals      to anon, authenticated;
grant select on public.ucl_settings    to anon, authenticated;

-- ── RPCs ────────────────────────────────────────────────────────────────────

-- Join (or sign back in). Unknown name -> account created; known name -> the
-- PIN must match. First player in a pool becomes its admin.
create or replace function public.ucl_join(p_name text, p_pin text, p_pool text default 'main')
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_name text := btrim(p_name);
  v_pool text := coalesce(nullif(btrim(p_pool), ''), 'main');
  v      public.ucl_players%rowtype;
begin
  if v_name is null or char_length(v_name) not between 2 and 24 then
    raise exception 'NAME_INVALID';
  end if;
  if p_pin is null or p_pin !~ '^[0-9]{4,8}$' then
    raise exception 'PIN_INVALID';
  end if;
  if v_pool !~ '^[a-z0-9-]{1,24}$' then
    raise exception 'POOL_INVALID';
  end if;

  select * into v from public.ucl_players
   where pool = v_pool and name_lower = lower(v_name);
  if found then
    if v.pin_hash = crypt(p_pin, v.pin_hash) then
      return json_build_object('token', v.token, 'player_id', v.id, 'name', v.name,
                               'is_admin', v.is_admin, 'existing', true);
    end if;
    raise exception 'WRONG_PIN';
  end if;

  if (select count(*) from public.ucl_players where pool = v_pool) >= 300 then
    raise exception 'POOL_FULL';
  end if;

  insert into public.ucl_players (name, pin_hash, pool, is_admin)
  values (v_name, crypt(p_pin, gen_salt('bf')), v_pool,
          not exists (select 1 from public.ucl_players where pool = v_pool))
  returning * into v;

  return json_build_object('token', v.token, 'player_id', v.id, 'name', v.name,
                           'is_admin', v.is_admin, 'existing', false);
end;
$$;

-- Upsert one match prediction. Hard server-side lock 30 min before kickoff.
create or replace function public.ucl_save_prediction(
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
  select id into v_player from public.ucl_players where token = p_token;
  if v_player is null then raise exception 'BAD_TOKEN'; end if;

  select kickoff, predict_until into v_kickoff, v_pu
    from public.ucl_matches where id = p_match_id;
  if v_kickoff is null then raise exception 'NO_MATCH'; end if;

  v_lock := coalesce(v_pu, v_kickoff - interval '30 minutes');
  if now() >= v_lock then raise exception 'LOCKED'; end if;

  if p_home is null or p_away is null
     or p_home not between 0 and 30 or p_away not between 0 and 30 then
    raise exception 'SCORE_INVALID';
  end if;
  if p_advances is not null and p_advances not in ('home', 'away') then
    raise exception 'ADVANCES_INVALID';
  end if;
  if p_method is not null and p_method not in ('REGULAR', 'EXTRA', 'PENS') then
    raise exception 'METHOD_INVALID';
  end if;
  if p_so_pick is not null and p_so_pick not in ('home', 'away') then
    raise exception 'SO_PICK_INVALID';
  end if;

  insert into public.ucl_predictions
    (player_id, match_id, home_goals, away_goals, advances, method_pick, so_pick)
  values (v_player, p_match_id, p_home, p_away, p_advances, p_method,
          case when p_method = 'PENS' then p_so_pick else null end)
  on conflict (player_id, match_id) do update
    set home_goals  = excluded.home_goals,
        away_goals  = excluded.away_goals,
        advances    = excluded.advances,
        method_pick = excluded.method_pick,
        so_pick     = excluded.so_pick,
        updated_at  = now();
end;
$$;

-- The three season-long bonus picks, locked together at the bonus deadline.
create or replace function public.ucl_save_final(
  p_token uuid, p_champion text, p_league_winner text default null, p_top_scorer text default null)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_player   uuid;
  v_deadline timestamptz;
begin
  select id into v_player from public.ucl_players where token = p_token;
  if v_player is null then raise exception 'BAD_TOKEN'; end if;

  select nullif(value, '')::timestamptz into v_deadline
    from public.ucl_settings where key = 'bonus_deadline';
  if v_deadline is null then
    v_deadline := (select min(kickoff) from public.ucl_matches) - interval '30 minutes';
  end if;
  if v_deadline is not null and now() >= v_deadline then
    raise exception 'LOCKED';
  end if;

  if p_champion is null or char_length(btrim(p_champion)) not between 2 and 60 then
    raise exception 'CHAMPION_INVALID';
  end if;
  if p_league_winner is not null and btrim(p_league_winner) <> ''
     and char_length(btrim(p_league_winner)) not between 2 and 60 then
    raise exception 'LEAGUE_WINNER_INVALID';
  end if;
  if p_top_scorer is not null and btrim(p_top_scorer) <> ''
     and char_length(btrim(p_top_scorer)) not between 2 and 60 then
    raise exception 'SCORER_INVALID';
  end if;

  insert into public.ucl_finals (player_id, champion, league_winner, top_scorer)
  values (v_player, btrim(p_champion),
          nullif(btrim(coalesce(p_league_winner, '')), ''),
          nullif(btrim(coalesce(p_top_scorer, '')), ''))
  on conflict (player_id) do update
    set champion      = excluded.champion,
        league_winner = excluded.league_winner,
        top_scorer    = excluded.top_scorer,
        updated_at    = now();
end;
$$;

-- Your own picks, including the ones RLS hides from everyone else.
create or replace function public.ucl_get_mine(p_token uuid)
returns json
language plpgsql
stable security definer
set search_path = public, extensions
as $$
declare v public.ucl_players%rowtype;
begin
  select * into v from public.ucl_players where token = p_token;
  if v.id is null then raise exception 'BAD_TOKEN'; end if;
  return json_build_object(
    'player', json_build_object('id', v.id, 'name', v.name, 'is_admin', v.is_admin),
    'predictions', coalesce((
      select json_agg(json_build_object(
               'match_id', p.match_id, 'h', p.home_goals, 'a', p.away_goals,
               'advances', p.advances, 'method', p.method_pick, 'so_pick', p.so_pick))
      from public.ucl_predictions p where p.player_id = v.id), '[]'::json),
    'final', (select json_build_object('champion', f.champion,
                                       'league_winner', f.league_winner,
                                       'top_scorer', f.top_scorer)
      from public.ucl_finals f where f.player_id = v.id)
  );
end;
$$;

-- Knockout fixtures appear in the feed days before kickoff; the client pushes
-- them here so the server can enforce locks. Insert-only, and a kickoff
-- correction may only move EARLIER (never re-open a lock that already passed).
create or replace function public.ucl_sync_match(
  p_id text, p_kickoff timestamptz, p_stage text default 'LEAGUE',
  p_leg integer default null, p_matchday integer default null)
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

  select kickoff into v_existing from public.ucl_matches where id = p_id;

  if v_existing is null then
    -- Rolling window rather than fixed season dates, so the same pool can be
    -- reused season after season without a migration.
    if p_kickoff < now() + interval '10 minutes'
       or p_kickoff > now() + interval '400 days' then
      raise exception 'KICKOFF_INVALID';
    end if;
    if p_stage is null or p_stage not in ('LEAGUE', 'PO', 'R16', 'QF', 'SF', 'FINAL') then
      raise exception 'STAGE_INVALID';
    end if;
    if p_leg is not null and p_leg not in (1, 2) then raise exception 'LEG_INVALID'; end if;
    if p_matchday is not null and p_matchday not between 1 and 8 then
      raise exception 'MATCHDAY_INVALID';
    end if;
    if (select count(*) from public.ucl_matches) >= 600 then
      raise exception 'TOO_MANY_MATCHES';
    end if;
    insert into public.ucl_matches (id, stage, leg, matchday, kickoff)
    values (p_id, p_stage, p_leg, p_matchday, p_kickoff);
  else
    if p_kickoff >= v_existing
       or now() >= v_existing - interval '30 minutes'
       or p_kickoff < now() + interval '10 minutes' then
      return;  -- silently ignore non-improving or unsafe updates
    end if;
    update public.ucl_matches set kickoff = p_kickoff where id = p_id;
  end if;
end;
$$;

-- ── Admin RPCs (pool admin only) ────────────────────────────────────────────

create or replace function public.ucl_admin_reset_pin(p_token uuid, p_player_name text, p_new_pin text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare v_pool text;
begin
  select pool into v_pool from public.ucl_players where token = p_token and is_admin;
  if v_pool is null then raise exception 'NOT_ADMIN'; end if;
  if p_new_pin is null or p_new_pin !~ '^[0-9]{4,8}$' then raise exception 'PIN_INVALID'; end if;

  update public.ucl_players
     set pin_hash = crypt(p_new_pin, gen_salt('bf'))
   where pool = v_pool and name_lower = lower(btrim(p_player_name));
  if not found then raise exception 'NO_PLAYER'; end if;
end;
$$;

-- Official answers for the bonus picks + the bonus deadline. Restricted to a
-- known key set so an admin token can't write arbitrary rows.
create or replace function public.ucl_admin_set_setting(p_token uuid, p_key text, p_value text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if not exists (select 1 from public.ucl_players where token = p_token and is_admin) then
    raise exception 'NOT_ADMIN';
  end if;
  if p_key not in ('top_scorer', 'league_winner', 'bonus_deadline') then
    raise exception 'KEY_INVALID';
  end if;
  if p_key = 'bonus_deadline' and nullif(btrim(coalesce(p_value, '')), '') is not null then
    perform p_value::timestamptz;   -- raises if it isn't a timestamp
  end if;

  insert into public.ucl_settings (key, value)
  values (p_key, nullif(btrim(coalesce(p_value, '')), ''))
  on conflict (key) do update set value = excluded.value, updated_at = now();
end;
$$;

-- Correct how a knockout match was decided when the feed gets it wrong.
create or replace function public.ucl_admin_set_decided(p_token uuid, p_match_id text, p_method text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if not exists (select 1 from public.ucl_players where token = p_token and is_admin) then
    raise exception 'NOT_ADMIN';
  end if;
  if p_method is not null and p_method not in ('REGULAR', 'EXTRA', 'PENS') then
    raise exception 'METHOD_INVALID';
  end if;
  update public.ucl_matches set decided_by = p_method where id = p_match_id;
  if not found then raise exception 'NO_MATCH'; end if;
end;
$$;

-- Move one match's prediction deadline (e.g. a fixture postponed at short notice).
create or replace function public.ucl_admin_set_predict_until(p_token uuid, p_match_id text, p_until timestamptz)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if not exists (select 1 from public.ucl_players where token = p_token and is_admin) then
    raise exception 'NOT_ADMIN';
  end if;
  update public.ucl_matches set predict_until = p_until where id = p_match_id;
  if not found then raise exception 'NO_MATCH'; end if;
end;
$$;

-- ── Execute grants ──────────────────────────────────────────────────────────

revoke all on function public.ucl_join(text, text, text) from public;
revoke all on function public.ucl_save_prediction(uuid, text, integer, integer, text, text, text) from public;
revoke all on function public.ucl_save_final(uuid, text, text, text) from public;
revoke all on function public.ucl_get_mine(uuid) from public;
revoke all on function public.ucl_sync_match(text, timestamptz, text, integer, integer) from public;
revoke all on function public.ucl_admin_reset_pin(uuid, text, text) from public;
revoke all on function public.ucl_admin_set_setting(uuid, text, text) from public;
revoke all on function public.ucl_admin_set_decided(uuid, text, text) from public;
revoke all on function public.ucl_admin_set_predict_until(uuid, text, timestamptz) from public;

grant execute on function public.ucl_join(text, text, text) to anon, authenticated;
grant execute on function public.ucl_save_prediction(uuid, text, integer, integer, text, text, text) to anon, authenticated;
grant execute on function public.ucl_save_final(uuid, text, text, text) to anon, authenticated;
grant execute on function public.ucl_get_mine(uuid) to anon, authenticated;
grant execute on function public.ucl_sync_match(text, timestamptz, text, integer, integer) to anon, authenticated;
grant execute on function public.ucl_admin_reset_pin(uuid, text, text) to anon, authenticated;
grant execute on function public.ucl_admin_set_setting(uuid, text, text) to anon, authenticated;
grant execute on function public.ucl_admin_set_decided(uuid, text, text) to anon, authenticated;
grant execute on function public.ucl_admin_set_predict_until(uuid, text, timestamptz) to anon, authenticated;
