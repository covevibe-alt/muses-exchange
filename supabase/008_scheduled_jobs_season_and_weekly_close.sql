-- ════════════════════════════════════════════════════════════════════════════
-- Migration 008 — Scheduled jobs: season rollover + Friday Market Close
-- ════════════════════════════════════════════════════════════════════════════
-- Two automations hang off pg_cron. Both run in security-definer context
-- so they can write across all users without RLS standing in their way.
--
--   • public.rollover_expired_seasons()
--       Runs daily at 00:05 UTC. For every season whose ends_at has
--       passed, computes each participant's final_return_pct + final_rank
--       against the current leaderboard, awards the season-N-champion /
--       top-10 / top-100 badges, and flips the season to 'ended'. If no
--       active season remains, inserts the next one (90-day window).
--
--   • public.run_friday_close()
--       Runs every Friday at 18:00 UTC. Snapshots the current leaderboard
--       into weekly_snapshots as this week's close. Computes return_pct
--       using the prior week's row as the start value (or same value on
--       the very first Friday — return 0%). Awards 'weekly-winner' to
--       rank 1. Idempotent via the (week_end, user_id) unique index.
--
-- Timezone note: pg_cron runs in UTC. 18:00 UTC is "late Friday" across
-- Europe and "early afternoon Friday" in the US, which is close enough
-- to "the week closes" for v1. A follow-up can add proper CET handling
-- once we care about exact-minute cadence.
--
-- APPLIED VIA SUPABASE MCP on 2026-04-23.
-- Scheduled jobs confirmed active:
--   jobid=1 rollover-expired-seasons   schedule='5 0 * * *'
--   jobid=2 friday-market-close        schedule='0 18 * * 5'
-- ════════════════════════════════════════════════════════════════════════════

-- ──────────────────────────────────────────────────────────────────────
-- Enable pg_cron (Supabase-hosted extension)
-- ──────────────────────────────────────────────────────────────────────
create extension if not exists pg_cron with schema pg_catalog;

-- Allow service_role to schedule and manage cron jobs.
grant usage on schema cron to service_role;
grant all   on all tables in schema cron to service_role;

-- ──────────────────────────────────────────────────────────────────────
-- rollover_expired_seasons()
-- ──────────────────────────────────────────────────────────────────────
create or replace function public.rollover_expired_seasons()
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_season     record;
  v_slug       text;
  v_name       text;
  v_next_num   int;
  v_rolled     int := 0;
begin
  for v_season in
    select * from seasons where status = 'active' and ends_at < now()
  loop
    -- Compute final return_pct + rank for each participation using the
    -- current leaderboard snapshot.
    with computed as (
      select
        sp.user_id,
        sp.baseline_portfolio_value as baseline,
        coalesce(lb.portfolio_value, sp.baseline_portfolio_value) as final_value,
        case when sp.baseline_portfolio_value > 0 then
          ((coalesce(lb.portfolio_value, sp.baseline_portfolio_value) - sp.baseline_portfolio_value)
           / sp.baseline_portfolio_value) * 100
        else 0 end as return_pct
      from season_participations sp
      left join leaderboard lb on lb.user_id = sp.user_id
      where sp.season_id = v_season.id
    ),
    ranked as (
      select user_id, return_pct,
             rank() over (order by return_pct desc nulls last) as r
      from computed
    )
    update season_participations sp
    set final_return_pct = ranked.return_pct,
        final_rank       = ranked.r
    from ranked
    where sp.season_id = v_season.id
      and sp.user_id   = ranked.user_id;

    -- Award season badges. Season 1 uses seeded slugs
    -- (season-1-champion / top-10 / top-100); subsequent seasons reuse
    -- the same slugs by default — the badge catalog is global, not
    -- per-season. Phase 2 content pack will split these per season if
    -- we want permanent "Season N Champion" collectibles.
    perform public.award_badge(sp.user_id, 'season-1-champion',
                               jsonb_build_object('season_slug', v_season.slug,
                                                  'season_name', v_season.name))
    from season_participations sp
    where sp.season_id = v_season.id and sp.final_rank = 1;

    perform public.award_badge(sp.user_id, 'season-1-top-10',
                               jsonb_build_object('season_slug', v_season.slug,
                                                  'season_name', v_season.name))
    from season_participations sp
    where sp.season_id = v_season.id and sp.final_rank between 2 and 10;

    perform public.award_badge(sp.user_id, 'season-1-top-100',
                               jsonb_build_object('season_slug', v_season.slug,
                                                  'season_name', v_season.name))
    from season_participations sp
    where sp.season_id = v_season.id and sp.final_rank between 11 and 100;

    -- Mark this season as ended.
    update seasons set status = 'ended' where id = v_season.id;

    v_rolled := v_rolled + 1;
  end loop;

  -- Ensure there's always an active season. The partial unique index on
  -- status = 'active' enforces at most one; this loop fills the gap
  -- when the last active was just rolled.
  if not exists (select 1 from seasons where status = 'active') then
    select count(*) + 1 into v_next_num from seasons;
    v_slug := to_char(now(), 'YYYY-') || 'q' || extract(quarter from now())::text;
    v_name := 'Season ' || v_next_num || ' — ' || to_char(now(), 'FMMonth YYYY');

    -- If the derived slug already exists (e.g. from a prior run that
    -- ended mid-quarter), append a disambiguator.
    if exists (select 1 from seasons where slug = v_slug) then
      v_slug := v_slug || '-' || to_char(now(), 'MMDD');
    end if;

    insert into seasons (slug, name, starts_at, ends_at, status)
    values (v_slug, v_name, date_trunc('day', now()),
            date_trunc('day', now()) + interval '90 days', 'active');
  end if;

  return v_rolled;
end;
$$;

revoke all    on function public.rollover_expired_seasons() from public;
grant execute on function public.rollover_expired_seasons() to service_role;

-- ──────────────────────────────────────────────────────────────────────
-- run_friday_close()
-- ──────────────────────────────────────────────────────────────────────
create or replace function public.run_friday_close()
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_week_end   date := current_date;
  v_week_start date := v_week_end - 7;
  v_count      int;
begin
  -- Snapshot every leaderboard row into weekly_snapshots as this week's
  -- close. portfolio_value_start = prior Friday's close if one exists,
  -- else the same as end (return_pct_week = 0).
  insert into weekly_snapshots (
    week_start, week_end, user_id,
    portfolio_value_start, portfolio_value_end, return_pct_week
  )
  select
    v_week_start,
    v_week_end,
    lb.user_id,
    coalesce(prev.portfolio_value_end, lb.portfolio_value) as start_value,
    lb.portfolio_value as end_value,
    case
      when coalesce(prev.portfolio_value_end, lb.portfolio_value) > 0 then
        ((lb.portfolio_value - coalesce(prev.portfolio_value_end, lb.portfolio_value))
         / coalesce(prev.portfolio_value_end, lb.portfolio_value)) * 100
      else 0
    end as return_pct
  from leaderboard lb
  left join weekly_snapshots prev
    on prev.user_id = lb.user_id
    and prev.week_end = v_week_start
  on conflict (week_end, user_id) do nothing;

  -- Rank within this week.
  with ranked as (
    select user_id,
           rank() over (order by return_pct_week desc nulls last) as r
    from weekly_snapshots
    where week_end = v_week_end
  )
  update weekly_snapshots ws
  set rank_in_week = ranked.r
  from ranked
  where ws.week_end = v_week_end
    and ws.user_id = ranked.user_id;

  -- Award 'weekly-winner' badge to the #1 trader of the week.
  perform public.award_badge(user_id, 'weekly-winner',
                             jsonb_build_object('week_end', v_week_end::text))
  from weekly_snapshots
  where week_end = v_week_end and rank_in_week = 1;

  select count(*) into v_count from weekly_snapshots where week_end = v_week_end;
  return v_count;
end;
$$;

revoke all    on function public.run_friday_close() from public;
grant execute on function public.run_friday_close() to service_role;

-- ──────────────────────────────────────────────────────────────────────
-- Schedule the cron jobs
-- ──────────────────────────────────────────────────────────────────────
-- Daily at 00:05 UTC: check for expired seasons + roll them over.
select cron.schedule(
  'rollover-expired-seasons',
  '5 0 * * *',
  $inner$select public.rollover_expired_seasons();$inner$
);

-- Every Friday at 18:00 UTC: Friday Market Close.
select cron.schedule(
  'friday-market-close',
  '0 18 * * 5',
  $inner$select public.run_friday_close();$inner$
);
