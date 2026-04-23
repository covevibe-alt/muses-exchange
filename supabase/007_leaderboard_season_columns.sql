-- ════════════════════════════════════════════════════════════════════════════
-- Migration 007 — Attach season_return_pct + current_season_id to leaderboard
-- ════════════════════════════════════════════════════════════════════════════
-- The leaderboard row already carries user_id + display_name + portfolio_value.
-- To render a per-season leaderboard without a client-side JOIN against
-- season_participations (which is RLS-restricted to the owning user),
-- we denormalize the season return onto the leaderboard row itself.
--
-- Each upsertLeaderboardRow() call from the client will compute:
--   season_return_pct = (current_portfolio_value - season_baseline) /
--                        season_baseline
-- and write it here alongside the existing lifetime return_pct.
--
-- current_season_id lets clients filter out stale rows from users who
-- haven't logged in since the active season changed (edge case, but
-- avoids mixing apples and oranges on the leaderboard).
--
-- APPLIED VIA SUPABASE MCP on 2026-04-23.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.leaderboard
  add column if not exists season_return_pct numeric,
  add column if not exists current_season_id int references public.seasons(id) on delete set null;

create index if not exists leaderboard_season_ranking_idx
  on public.leaderboard (current_season_id, season_return_pct desc nulls last);
