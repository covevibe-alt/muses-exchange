-- ════════════════════════════════════════════════════════════════════════════
-- Migration 025 — Tighten RPC grants discovered in Chunk F audit
-- ════════════════════════════════════════════════════════════════════════════
-- Supabase auto-grants new functions to anon + authenticated by default.
-- The earlier migrations relied on `revoke all on function ... from public`
-- which doesn't strip those role-specific grants in Supabase. This migration
-- explicitly revokes anon access from RPCs that should be authenticated-only
-- or service-role-only.
--
-- Inside-the-function checks (auth.uid() is null returns) already prevented
-- anon from doing anything meaningful, so this is defense-in-depth + lint
-- cleanup, not a fix for an exploit.
--
-- APPLIED VIA SUPABASE MCP on 2026-04-27.
-- ════════════════════════════════════════════════════════════════════════════

revoke execute on function public.award_sharpest_caller() from anon, authenticated, public;
revoke execute on function public.create_user_prediction_market(text, text, timestamptz) from anon, public;
revoke execute on function public.set_referrer(text) from anon, public;
revoke execute on function public.get_my_referral_stats() from anon, public;

-- The following stay anon-callable on purpose:
--   • get_public_compete_stats — used by marketing pages
--   • get_prediction_leaderboard — public top-callers board
