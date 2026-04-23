-- ════════════════════════════════════════════════════════════════════════════
-- Migration 009 — Head-to-head weekly matchups + ELO ratings
-- ════════════════════════════════════════════════════════════════════════════
-- Phase 1 of the fantasy-music season layer. Every Monday, eligible traders
-- are paired 1v1 for the week. The winner is whoever has the higher
-- return_pct_week in Friday's weekly_snapshots row. ELO ratings update
-- based on outcomes so matchups stay competitive as the population grows.
--
-- Eligibility for a given Monday pairing:
--   • Has a season_participations row in the active season
--   • Has at least one filled_orders row (actually traded, not just signed
--     up and wandered off)
--   • Was "active" in the last 14 days (leaderboard.updated_at)
--   • Not already in a matchup for the week_end in question
--
-- Pairing algorithm:
--   1. Fetch eligible users sorted by ELO rating desc
--   2. Walk the list in pairs: (#1, #2), (#3, #4), …
--   3. If the list has odd length, the lowest-rated user gets a 'bye'
--      (a row with user_b = user_a is conceptually a placeholder; we just
--      mark status='bye' and skip ELO update)
--
-- ELO: K-factor 32 (fast convergence, appropriate for a weekly cadence).
-- Starting rating 1200. Draws possible on identical return_pct_week.
--
-- Schedule:
--   • Monday 00:05 UTC — pair_weekly_matchups() creates rows for the week
--     ending the following Friday.
--   • Friday 18:05 UTC (5 min after run_friday_close) — resolve_weekly_matchups()
--     looks up each matchup's weekly_snapshots rows, declares winners,
--     updates ELO ratings.
--
-- APPLIED VIA SUPABASE MCP on 2026-04-23.
-- Scheduled jobs:
--   jobid=3 pair-weekly-matchups       schedule='5 0 * * 1'
--   jobid=4 resolve-weekly-matchups    schedule='5 18 * * 5'
-- ════════════════════════════════════════════════════════════════════════════

-- ──────────────────────────────────────────────────────────────────────
-- matchups table
-- ──────────────────────────────────────────────────────────────────────
create table if not exists public.matchups (
  id              serial primary key,
  season_id       int references public.seasons(id) on delete set null,
  week_end        date not null,
  user_a          uuid not null references auth.users(id) on delete cascade,
  user_b          uuid not null references auth.users(id) on delete cascade,
  user_a_baseline numeric not null,
  user_b_baseline numeric not null,
  user_a_final    numeric,
  user_b_final    numeric,
  winner_user_id  uuid references auth.users(id) on delete set null,
  status          text not null default 'active'
                  check (status in ('active', 'resolved', 'bye')),
  created_at      timestamptz default now(),
  resolved_at     timestamptz,
  check (user_a <> user_b or status = 'bye')
);

-- Prevent the same user appearing twice as user_a in a single week.
-- (user_b same-week uniqueness and "same user as both A and B" are
-- enforced inside the pairing function, which is the only writer.)
create unique index if not exists matchups_user_a_week_idx
  on public.matchups (week_end, user_a);
create unique index if not exists matchups_user_b_week_idx
  on public.matchups (week_end, user_b);

create index if not exists matchups_user_a_recent_idx
  on public.matchups (user_a, week_end desc);
create index if not exists matchups_user_b_recent_idx
  on public.matchups (user_b, week_end desc);

-- ──────────────────────────────────────────────────────────────────────
-- user_elo table
-- ──────────────────────────────────────────────────────────────────────
create table if not exists public.user_elo (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  rating        numeric not null default 1200,
  games_played  int not null default 0,
  wins          int not null default 0,
  losses        int not null default 0,
  draws         int not null default 0,
  last_match_at timestamptz,
  updated_at    timestamptz default now(),
  check (rating >= 0)
);

create index if not exists user_elo_rating_idx
  on public.user_elo (rating desc);

-- ──────────────────────────────────────────────────────────────────────
-- RLS
-- ──────────────────────────────────────────────────────────────────────
alter table public.matchups enable row level security;
alter table public.user_elo enable row level security;

-- matchups: users read rows where they appear on either side. Full
-- opponent rows are public in context (you need to see your opponent's
-- handle), but no writes from clients — service-role only.
drop policy if exists "matchups_select_participant" on public.matchups;
create policy "matchups_select_participant"
  on public.matchups for select
  to authenticated
  using (auth.uid() = user_a or auth.uid() = user_b);

-- user_elo: all authenticated can read everyone's rating (public info,
-- like the leaderboard). No client writes.
drop policy if exists "user_elo_select_all" on public.user_elo;
create policy "user_elo_select_all"
  on public.user_elo for select
  to authenticated using (true);

-- ──────────────────────────────────────────────────────────────────────
-- pair_weekly_matchups(p_week_end date)
-- ──────────────────────────────────────────────────────────────────────
-- Creates matchup rows for the coming week. Called every Monday at 00:05
-- UTC via pg_cron with p_week_end = next Friday's date.
-- ──────────────────────────────────────────────────────────────────────
create or replace function public.pair_weekly_matchups(p_week_end date default null)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_week_end      date;
  v_season_id     int;
  v_rec           record;
  v_prev          record;
  v_paired_count  int := 0;
  v_active_cutoff timestamptz := now() - interval '14 days';
begin
  -- Default: the Friday at the end of the current week (ISO week Monday=1).
  -- Monday = 1, Friday = 5 → add 4 days.
  v_week_end := coalesce(p_week_end, (current_date + (5 - extract(isodow from current_date)::int))::date);

  select id into v_season_id from seasons where status = 'active' limit 1;
  if v_season_id is null then
    return 0;
  end if;

  -- Bootstrap user_elo rows for anyone who traded but has no rating yet.
  insert into user_elo (user_id)
  select distinct lb.user_id
  from leaderboard lb
  where not exists (select 1 from user_elo ue where ue.user_id = lb.user_id)
  on conflict (user_id) do nothing;

  -- Build the eligible pool: signed into the active season, actually
  -- traded, leaderboard row updated in the last 14 days, not already in
  -- a matchup for this week_end.
  v_prev := null;
  for v_rec in
    with eligible as (
      select sp.user_id, coalesce(ue.rating, 1200) as rating, coalesce(lb.portfolio_value, sp.baseline_portfolio_value) as pv
      from season_participations sp
      left join user_elo ue     on ue.user_id = sp.user_id
      left join leaderboard lb  on lb.user_id = sp.user_id
      where sp.season_id = v_season_id
        and lb.updated_at >= v_active_cutoff
        and exists (select 1 from filled_orders fo where fo.user_id = sp.user_id limit 1)
        and not exists (
          select 1 from matchups m
          where m.week_end = v_week_end and (m.user_a = sp.user_id or m.user_b = sp.user_id)
        )
    )
    select user_id, rating, pv, row_number() over (order by rating desc, user_id) as rn
    from eligible
    order by rn
  loop
    if v_prev is null then
      v_prev := v_rec;
      continue;
    end if;

    -- Pair (v_prev, v_rec).
    insert into matchups (season_id, week_end, user_a, user_b, user_a_baseline, user_b_baseline, status)
    values (v_season_id, v_week_end, v_prev.user_id, v_rec.user_id, v_prev.pv, v_rec.pv, 'active');

    v_paired_count := v_paired_count + 1;
    v_prev := null;
  end loop;

  -- If an unpaired user remains (odd count), give them a bye.
  if v_prev is not null then
    insert into matchups (season_id, week_end, user_a, user_b, user_a_baseline, user_b_baseline, status)
    values (v_season_id, v_week_end, v_prev.user_id, v_prev.user_id, v_prev.pv, v_prev.pv, 'bye');
  end if;

  return v_paired_count;
end;
$$;

revoke all    on function public.pair_weekly_matchups(date) from public;
grant execute on function public.pair_weekly_matchups(date) to service_role;

-- ──────────────────────────────────────────────────────────────────────
-- resolve_weekly_matchups(p_week_end date)
-- ──────────────────────────────────────────────────────────────────────
-- For every active matchup whose week_end has passed, look up both users'
-- weekly_snapshots, declare a winner, and update ELO ratings. Called every
-- Friday at 18:05 UTC (5 min after run_friday_close).
-- ──────────────────────────────────────────────────────────────────────
create or replace function public.resolve_weekly_matchups(p_week_end date default null)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_week_end    date;
  v_match       record;
  v_a_return    numeric;
  v_b_return    numeric;
  v_a_rating    numeric;
  v_b_rating    numeric;
  v_expected_a  numeric;
  v_actual_a    numeric;
  v_winner      uuid;
  v_resolved    int := 0;
  v_k           numeric := 32;
begin
  v_week_end := coalesce(p_week_end, current_date);

  for v_match in
    select * from matchups where week_end = v_week_end and status = 'active'
  loop
    -- Look up this week's final portfolio value for each side.
    select portfolio_value_end, return_pct_week into v_match.user_a_final, v_a_return
    from weekly_snapshots where week_end = v_week_end and user_id = v_match.user_a;

    select portfolio_value_end, return_pct_week into v_match.user_b_final, v_b_return
    from weekly_snapshots where week_end = v_week_end and user_id = v_match.user_b;

    -- If either side has no snapshot (didn't trade at all since pairing),
    -- treat their return as 0% and proceed.
    v_a_return := coalesce(v_a_return, 0);
    v_b_return := coalesce(v_b_return, 0);

    -- Determine winner. Draws = exactly equal return_pct.
    if v_a_return > v_b_return then
      v_winner := v_match.user_a;
      v_actual_a := 1;
    elsif v_a_return < v_b_return then
      v_winner := v_match.user_b;
      v_actual_a := 0;
    else
      v_winner := null;
      v_actual_a := 0.5;
    end if;

    -- Persist match result.
    update matchups
    set user_a_final    = coalesce(v_match.user_a_final, user_a_baseline),
        user_b_final    = coalesce(v_match.user_b_final, user_b_baseline),
        winner_user_id  = v_winner,
        status          = 'resolved',
        resolved_at     = now()
    where id = v_match.id;

    -- Update ELO ratings.
    select rating into v_a_rating from user_elo where user_id = v_match.user_a;
    select rating into v_b_rating from user_elo where user_id = v_match.user_b;
    v_a_rating := coalesce(v_a_rating, 1200);
    v_b_rating := coalesce(v_b_rating, 1200);

    v_expected_a := 1.0 / (1.0 + power(10.0, (v_b_rating - v_a_rating) / 400.0));

    update user_elo
    set rating        = v_a_rating + v_k * (v_actual_a - v_expected_a),
        games_played  = games_played + 1,
        wins          = wins + case when v_winner = v_match.user_a then 1 else 0 end,
        losses        = losses + case when v_winner = v_match.user_b then 1 else 0 end,
        draws         = draws + case when v_winner is null then 1 else 0 end,
        last_match_at = now(),
        updated_at    = now()
    where user_id = v_match.user_a;

    update user_elo
    set rating        = v_b_rating + v_k * ((1 - v_actual_a) - (1 - v_expected_a)),
        games_played  = games_played + 1,
        wins          = wins + case when v_winner = v_match.user_b then 1 else 0 end,
        losses        = losses + case when v_winner = v_match.user_a then 1 else 0 end,
        draws         = draws + case when v_winner is null then 1 else 0 end,
        last_match_at = now(),
        updated_at    = now()
    where user_id = v_match.user_b;

    v_resolved := v_resolved + 1;
  end loop;

  -- Also flip any 'bye' rows to 'resolved' for cleanliness (no ELO impact).
  update matchups
  set status = 'resolved', resolved_at = now()
  where week_end = v_week_end and status = 'bye';

  return v_resolved;
end;
$$;

revoke all    on function public.resolve_weekly_matchups(date) from public;
grant execute on function public.resolve_weekly_matchups(date) to service_role;

-- ──────────────────────────────────────────────────────────────────────
-- Schedule the cron jobs
-- ──────────────────────────────────────────────────────────────────────
-- Monday 00:05 UTC: pair matchups for the upcoming Friday.
select cron.schedule(
  'pair-weekly-matchups',
  '5 0 * * 1',
  $inner$select public.pair_weekly_matchups();$inner$
);

-- Friday 18:05 UTC: resolve matchups 5 minutes after run_friday_close.
select cron.schedule(
  'resolve-weekly-matchups',
  '5 18 * * 5',
  $inner$select public.resolve_weekly_matchups();$inner$
);
