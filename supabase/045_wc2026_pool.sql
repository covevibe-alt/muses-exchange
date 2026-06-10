-- 045_wc2026_pool.sql
-- World Cup 2026 predictions pool (standalone page at /wc2026).
--
-- Design notes:
--  * No Supabase Auth — friends join with a display name + numeric PIN.
--    The PIN is bcrypt-hashed; a per-player random token (uuid) returned at
--    join/login authorizes all writes via SECURITY DEFINER RPCs.
--  * Match schedule lives here only as (id, kickoff, stage, group) so the
--    server can enforce prediction locks. Teams/scores/venues come from the
--    ESPN feed committed to the repo by .github/workflows/wc2026-results.yml;
--    scoring is computed client-side as a pure function of
--    (predictions x results), so every client renders identical points
--    without needing a service key anywhere.
--  * Anti-cheat rules enforced server-side:
--      - predictions can't be written at/after kickoff (RPC check)
--      - others' predictions are unreadable until kickoff (RLS)
--      - champion/tiebreak picks lock at the tournament's first kickoff
--  * wc_matches ids are ESPN event ids (text) — the same ids used by the
--    data feed, so client joins are trivial.

create extension if not exists pgcrypto;

-- ── Tables ──────────────────────────────────────────────────────────────────

create table if not exists public.wc_players (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(btrim(name)) between 2 and 24),
  name_lower text generated always as (lower(btrim(name))) stored,
  pin_hash   text not null,
  token      uuid not null default gen_random_uuid(),
  is_admin   boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index if not exists wc_players_name_lower_key on public.wc_players (name_lower);
create unique index if not exists wc_players_token_key on public.wc_players (token);

create table if not exists public.wc_matches (
  id         text primary key,
  match_no   integer,
  stage      text not null default 'GROUP',      -- GROUP | R32 | R16 | QF | SF | THIRD | FINAL
  group_name text,                               -- 'A'..'L' for group stage
  kickoff    timestamptz not null
);

create table if not exists public.wc_predictions (
  player_id  uuid not null references public.wc_players(id) on delete cascade,
  match_id   text not null references public.wc_matches(id) on delete cascade,
  home_goals smallint not null check (home_goals between 0 and 30),
  away_goals smallint not null check (away_goals between 0 and 30),
  updated_at timestamptz not null default now(),
  primary key (player_id, match_id)
);
create index if not exists wc_predictions_match_idx on public.wc_predictions (match_id);

-- Tournament-long picks: champion (+bonus points) and total tournament goals
-- (leaderboard tiebreaker). Locked once the opening match kicks off.
create table if not exists public.wc_finals (
  player_id   uuid primary key references public.wc_players(id) on delete cascade,
  champion    text not null check (char_length(champion) between 2 and 40),
  total_goals smallint check (total_goals between 0 and 1000),
  updated_at  timestamptz not null default now()
);

-- ── Row level security ──────────────────────────────────────────────────────

alter table public.wc_players     enable row level security;
alter table public.wc_matches     enable row level security;
alter table public.wc_predictions enable row level security;
alter table public.wc_finals      enable row level security;

-- Schedule is public.
drop policy if exists wc_matches_read on public.wc_matches;
create policy wc_matches_read on public.wc_matches for select using (true);

-- Player directory is public, but only safe columns are granted (no pin_hash,
-- no token) — column-level grants below.
drop policy if exists wc_players_read on public.wc_players;
create policy wc_players_read on public.wc_players for select using (true);

-- Predictions become visible to everyone once their match kicks off.
-- Before kickoff you can only get your own back via wc_get_mine().
drop policy if exists wc_predictions_read on public.wc_predictions;
create policy wc_predictions_read on public.wc_predictions for select
  using (exists (select 1 from public.wc_matches m
                 where m.id = match_id and m.kickoff <= now()));

-- Champion picks reveal once the tournament has started.
drop policy if exists wc_finals_read on public.wc_finals;
create policy wc_finals_read on public.wc_finals for select
  using ((select min(kickoff) from public.wc_matches) <= now());

-- No direct writes for clients; all writes go through the RPCs below.
revoke all on public.wc_players     from anon, authenticated;
revoke all on public.wc_matches     from anon, authenticated;
revoke all on public.wc_predictions from anon, authenticated;
revoke all on public.wc_finals      from anon, authenticated;

grant select (id, name, is_admin, created_at) on public.wc_players to anon, authenticated;
grant select on public.wc_matches     to anon, authenticated;
grant select on public.wc_predictions to anon, authenticated;
grant select on public.wc_finals      to anon, authenticated;

-- ── RPCs ────────────────────────────────────────────────────────────────────

-- Join the pool (or log back in). One function so the UI is a single form:
-- unknown name -> account created; known name -> PIN must match.
-- First player to join becomes admin.
create or replace function public.wc_join(p_name text, p_pin text)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_name text := btrim(p_name);
  v      public.wc_players%rowtype;
begin
  if v_name is null or char_length(v_name) < 2 or char_length(v_name) > 24 then
    raise exception 'NAME_INVALID';
  end if;
  if p_pin is null or p_pin !~ '^[0-9]{4,8}$' then
    raise exception 'PIN_INVALID';
  end if;

  select * into v from public.wc_players where name_lower = lower(v_name);
  if found then
    if v.pin_hash = crypt(p_pin, v.pin_hash) then
      return json_build_object('token', v.token, 'player_id', v.id,
                               'name', v.name, 'is_admin', v.is_admin,
                               'existing', true);
    end if;
    raise exception 'WRONG_PIN';
  end if;

  if (select count(*) from public.wc_players) >= 300 then
    raise exception 'POOL_FULL';
  end if;

  insert into public.wc_players (name, pin_hash, is_admin)
  values (v_name, crypt(p_pin, gen_salt('bf')),
          not exists (select 1 from public.wc_players))
  returning * into v;

  return json_build_object('token', v.token, 'player_id', v.id,
                           'name', v.name, 'is_admin', v.is_admin,
                           'existing', false);
end;
$$;

-- Upsert a score prediction. Hard server-side lock at kickoff.
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
  if now() >= v_kickoff then raise exception 'LOCKED'; end if;

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

-- Champion pick + total-goals tiebreaker. Locks at the opening kickoff.
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

  if (select min(kickoff) from public.wc_matches) <= now() then
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

-- Everything that's mine, including pre-kickoff predictions RLS would hide.
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
               'match_id', p.match_id, 'h', p.home_goals, 'a', p.away_goals))
      from public.wc_predictions p where p.player_id = v.id), '[]'::json),
    'final', (
      select json_build_object('champion', f.champion, 'total_goals', f.total_goals)
      from public.wc_finals f where f.player_id = v.id)
  );
end;
$$;

-- ── Admin emergency hatches (kickoff reschedules, forgotten PINs) ───────────

create or replace function public.wc_admin_set_kickoff(
  p_token uuid, p_match_id text, p_kickoff timestamptz)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if not exists (select 1 from public.wc_players
                 where token = p_token and is_admin) then
    raise exception 'NOT_ADMIN';
  end if;
  update public.wc_matches set kickoff = p_kickoff where id = p_match_id;
  if not found then raise exception 'NO_MATCH'; end if;
end;
$$;

create or replace function public.wc_admin_reset_pin(
  p_token uuid, p_player_name text, p_new_pin text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if not exists (select 1 from public.wc_players
                 where token = p_token and is_admin) then
    raise exception 'NOT_ADMIN';
  end if;
  if p_new_pin is null or p_new_pin !~ '^[0-9]{4,8}$' then
    raise exception 'PIN_INVALID';
  end if;
  update public.wc_players
     set pin_hash = crypt(p_new_pin, gen_salt('bf'))
   where name_lower = lower(btrim(p_player_name));
  if not found then raise exception 'NO_PLAYER'; end if;
end;
$$;

-- ── Function grants ─────────────────────────────────────────────────────────

revoke execute on function public.wc_join(text, text)                              from public;
revoke execute on function public.wc_save_prediction(uuid, text, integer, integer) from public;
revoke execute on function public.wc_save_final(uuid, text, integer)               from public;
revoke execute on function public.wc_get_mine(uuid)                                from public;
revoke execute on function public.wc_admin_set_kickoff(uuid, text, timestamptz)    from public;
revoke execute on function public.wc_admin_reset_pin(uuid, text, text)             from public;

grant execute on function public.wc_join(text, text)                              to anon, authenticated;
grant execute on function public.wc_save_prediction(uuid, text, integer, integer) to anon, authenticated;
grant execute on function public.wc_save_final(uuid, text, integer)               to anon, authenticated;
grant execute on function public.wc_get_mine(uuid)                                to anon, authenticated;
grant execute on function public.wc_admin_set_kickoff(uuid, text, timestamptz)    to anon, authenticated;
grant execute on function public.wc_admin_reset_pin(uuid, text, text)             to anon, authenticated;
