-- ════════════════════════════════════════════════════════════════════════════
-- Migration 021 — Public compete stats RPC (Chunk D)
-- ════════════════════════════════════════════════════════════════════════════
-- Adds `public.get_public_compete_stats()` — a single anon-callable RPC that
-- returns aggregate counts + non-PII previews (open prediction-market
-- questions, current season name, next IPO ticker, etc.) for the
-- marketing-page Compete slider.
--
-- All public.* tables are RLS-restricted to `authenticated`. This function
-- uses `security definer` to bypass RLS for the SAFE counts we want to
-- expose anonymously. NO PII: no user_ids, no handles, no per-user values
-- — only counts and pre-public content (market questions / IPO tickers /
-- season names — visible to any logged-in user already).
--
-- The marketing page calls this once on load; results cache for the session.
--
-- APPLIED VIA SUPABASE MCP on 2026-04-27.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.get_public_compete_stats()
returns jsonb
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select jsonb_build_object(
    'now', now(),
    'players', (select count(*) from leaderboard),
    'ipo', jsonb_build_object(
      'live_count', (
        select count(*) from artist_ipos
        where status = 'live' and now() between starts_at and ends_at
      ),
      'upcoming_count', (
        select count(*) from artist_ipos
        where status = 'pending' and starts_at > now()
      ),
      'next_ticker', (
        select ticker from artist_ipos
        where status in ('live','pending') and ends_at > now()
        order by starts_at asc nulls last limit 1
      ),
      'next_starts_at', (
        select starts_at from artist_ipos
        where status in ('live','pending') and ends_at > now()
        order by starts_at asc nulls last limit 1
      ),
      'next_ends_at', (
        select ends_at from artist_ipos
        where status in ('live','pending') and ends_at > now()
        order by starts_at asc nulls last limit 1
      )
    ),
    'matchup', jsonb_build_object(
      'live_count', (
        select count(*) from matchups
        where (status is null or status not in ('resolved','cancelled'))
          and resolved_at is null
      ),
      'this_week_total', (
        select count(*) from matchups
        where week_end >= current_date - interval '7 days'
      )
    ),
    'leagues', jsonb_build_object(
      'active_count', (select count(*) from leagues where status = 'active'),
      'total_members', (select count(*) from league_members),
      'biggest_size', (
        select coalesce(max(c), 0) from (
          select count(*) as c from league_members group by league_id
        ) sizes
      )
    ),
    'predictions', jsonb_build_object(
      'open_count', (
        select count(*) from prediction_markets
        where status = 'open' and resolves_at > now()
      ),
      'total_pool', (
        select coalesce(round(sum(yes_pool + no_pool)::numeric, 0), 0)
        from prediction_markets where status = 'open'
      ),
      'sample', coalesce((
        select jsonb_agg(jsonb_build_object(
          'question',      pm.question,
          'yes_pool',      pm.yes_pool,
          'no_pool',       pm.no_pool,
          'resolves_at',   pm.resolves_at,
          'artist_ticker', pm.artist_ticker
        ) order by (pm.yes_pool + pm.no_pool) desc, pm.resolves_at asc)
        from (
          select question, yes_pool, no_pool, resolves_at, artist_ticker
          from prediction_markets
          where status = 'open' and resolves_at > now()
          order by (yes_pool + no_pool) desc, resolves_at asc
          limit 3
        ) pm
      ), '[]'::jsonb)
    ),
    'tournaments', jsonb_build_object(
      'season_name', (
        select name from seasons where status = 'active'
        order by starts_at desc limit 1
      ),
      'season_ends_at', (
        select ends_at from seasons where status = 'active'
        order by starts_at desc limit 1
      ),
      'cup_entrants_this_month', (
        select count(*) from genre_cup_participations
        where month_start = date_trunc('month', current_date)::date
      ),
      'cup_genres_running', (
        select count(distinct genre) from genre_cup_participations
        where month_start = date_trunc('month', current_date)::date
      )
    )
  );
$$;

revoke all    on function public.get_public_compete_stats() from public;
grant execute on function public.get_public_compete_stats() to anon, authenticated;

comment on function public.get_public_compete_stats() is
  'Anon-callable aggregate stats for the marketing-page Compete slider. Returns counts + non-PII previews only.';
