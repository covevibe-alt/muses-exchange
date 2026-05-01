-- ════════════════════════════════════════════════════════════════════════════
-- Migration 043 — Backfill correct snapshots for all historical bets
-- ════════════════════════════════════════════════════════════════════════════
-- Two classes of broken/missing snapshots existed before today:
--   1. Bets placed BEFORE migration 035 created the trigger — no snapshot
--      row at all.
--   2. Bets placed AFTER 035 but BEFORE migration 041 — snapshot captured
--      pre-bet pool state instead of post-bet (the bug 041 fixed).
--
-- The bets ledger is the canonical record of every state change, so a
-- running-total walk reconstructs the correct post-bet pools at every
-- bet's placed_at timestamp. Wipe every snapshot and re-derive.
--
-- APPLIED VIA SUPABASE MCP on 2026-05-01.
-- ════════════════════════════════════════════════════════════════════════════

DELETE FROM prediction_market_snapshots;

INSERT INTO prediction_market_snapshots (market_id, yes_pool, no_pool, yes_pct, snapshot_at)
SELECT
  market_id,
  running_yes AS yes_pool,
  running_no  AS no_pool,
  CASE WHEN (running_yes + running_no) > 0
    THEN (running_yes / (running_yes + running_no)) * 100
    ELSE 50
  END AS yes_pct,
  placed_at AS snapshot_at
FROM (
  SELECT
    market_id, placed_at,
    SUM(CASE WHEN side = 'yes' THEN amount ELSE 0 END)
      OVER (PARTITION BY market_id ORDER BY placed_at, id) AS running_yes,
    SUM(CASE WHEN side = 'no'  THEN amount ELSE 0 END)
      OVER (PARTITION BY market_id ORDER BY placed_at, id) AS running_no
  FROM prediction_bets
) t;
