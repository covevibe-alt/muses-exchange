-- ════════════════════════════════════════════════════════════════════════════
-- Migration 012 — Per-genre returns on the leaderboard row
-- ════════════════════════════════════════════════════════════════════════════
-- Phase 2 Chunk 2 — Genre Cups. Every client's upsertLeaderboardRow()
-- computes a per-genre return value alongside the existing portfolio_value
-- + return_pct, and writes it here. The leaderboard UI filters to users
-- who hold that genre and sorts by the numeric value.
--
-- Shape: { "Pop": 3.21, "Hip-Hop": -1.15, "Indie": 12.40, ... }
--   Keys are genre names as they appear on artist rows ("Pop", "Hip-Hop",
--   "R&B", "Indie", "Latin", "Alt", "Afropop", "K-Pop", "Electronic").
--   Values are percent return on the user's holdings in that genre
--   relative to their cost basis — not an absolute price move, a P&L %.
--   A genre only appears in the object if the user actually holds ≥1
--   artist of that genre with cost > 0.
--
-- Why denormalize onto leaderboard instead of its own table: same
-- motivation as season_return_pct (migration 007) — the leaderboard is
-- already the public aggregate, RLS lets authenticated users read all
-- rows, and the filter/sort happens in a single-table query.
--
-- GIN index on the jsonb column speeds up existence-of-key filters
-- (which is how the client picks "users who hold Pop").
--
-- APPLIED VIA SUPABASE MCP on 2026-04-23.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.leaderboard
  add column if not exists genre_returns jsonb not null default '{}'::jsonb;

create index if not exists leaderboard_genre_returns_gin_idx
  on public.leaderboard using gin (genre_returns);
