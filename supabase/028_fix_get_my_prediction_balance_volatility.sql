-- ════════════════════════════════════════════════════════════════════════════
-- Migration 028 — Fix get_my_prediction_balance volatility
-- ════════════════════════════════════════════════════════════════════════════
-- The function was marked STABLE (read-only) but it calls
-- ensure_prediction_balance() which does an INSERT to lazy-create a row
-- when the user has none. STABLE callers create a read-only transaction
-- context, so the INSERT fails at runtime with:
--   "cannot execute INSERT in a read-only transaction"
--
-- Symptom: every Portfolio page load triggered fetchPredictionBalance()
-- which retried this RPC and always errored. PREDICTION_BALANCE stayed
-- null, the Predictions tab read $0, the swap modal couldn't validate,
-- and credit swaps appeared to do nothing on the frontend.
--
-- Fix: drop STABLE so the function is VOLATILE (default) and the INSERT
-- in the lazy-create path is allowed.
--
-- APPLIED VIA SUPABASE MCP on 2026-04-28.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.get_my_prediction_balance()
returns numeric
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then return null; end if;
  return public.ensure_prediction_balance(v_user_id);
end;
$$;
