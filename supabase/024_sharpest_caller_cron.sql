-- ════════════════════════════════════════════════════════════════════════════
-- Migration 024 — Schedule monthly Sharpest Caller cron (Chunk E.3)
-- ════════════════════════════════════════════════════════════════════════════
-- Schedules the award_sharpest_caller() function to run at 00:05 UTC on
-- the 1st of every month. Awards the 'sharpest-caller' badge to the user
-- with the highest hit-rate in the previous month, requiring at least 5
-- resolved bets to qualify.
--
-- APPLIED VIA SUPABASE MCP on 2026-04-27. Job ID: 9.
-- To inspect:    select * from cron.job where jobname = 'award_sharpest_caller_monthly';
-- To unschedule: select cron.unschedule('award_sharpest_caller_monthly');
-- ════════════════════════════════════════════════════════════════════════════

select cron.schedule(
  'award_sharpest_caller_monthly',
  '5 0 1 * *',
  $$select public.award_sharpest_caller();$$
);
