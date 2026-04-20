-- ════════════════════════════════════════════════════════════════════════════
-- Migration 002 — Portfolio snapshot column
-- ════════════════════════════════════════════════════════════════════════════
-- Phase 1 persistence model: the entire client-side portfolio (cash, holdings,
-- transactions, open/filled orders, firstBuyAt) is serialized as JSON and
-- stored on portfolios.snapshot. This keeps the client code change small and
-- gets cross-device portfolio sync shipped immediately.
--
-- Phase 2 (server-validated trades) will populate the structured holdings,
-- transactions, open_orders, and filled_orders tables instead, and the
-- snapshot column becomes redundant — at that point we can drop it.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.portfolios
  add column if not exists snapshot jsonb;

-- RLS: snapshot inherits the same policy as the rest of the row (already
-- locked to auth.uid() = user_id by migration 001), no extra policy needed.

-- Convenience: index on updated_at so we can later identify stale portfolios.
create index if not exists portfolios_updated_at_idx
  on public.portfolios (updated_at desc);
