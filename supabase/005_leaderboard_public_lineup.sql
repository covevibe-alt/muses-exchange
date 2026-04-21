-- ════════════════════════════════════════════════════════════════════════════
-- Migration 005 — Opt-in public lineup on the leaderboard
-- ════════════════════════════════════════════════════════════════════════════
-- Adds two columns so a user can publish their current top holdings to the
-- leaderboard for other players to see:
--
--   show_lineup  boolean   — user's opt-in flag (default false = private).
--   top_holdings jsonb     — array of {ticker, weight} (top 5 by market value,
--                            weights sum to ~1). Only written when show_lineup
--                            is true. Cleared to NULL when the user opts out.
--
-- The leaderboard is deliberately kept separate from public.portfolios
-- (see migration 004's preamble) — portfolios.snapshot is owner-only and
-- holds full history, while the leaderboard only ever shows what the user
-- explicitly consented to expose. top_holdings extends that same principle:
-- it's just a small shape the user can publish, not a full portfolio leak.
--
-- Existing RLS from 004 already covers these new columns:
--   • authenticated users can SELECT every row (leaderboard is public)
--   • only the row's owner can INSERT/UPDATE/DELETE (no forgery)
-- ════════════════════════════════════════════════════════════════════════════

alter table public.leaderboard
  add column if not exists top_holdings jsonb,
  add column if not exists show_lineup  boolean not null default false;

-- No new index needed — the column is read as part of the existing
-- leaderboard_portfolio_value_idx ordering query, not filtered on directly.
