-- ════════════════════════════════════════════════════════════════════════════
-- Migration 045 — Prediction streak decay (cron)
-- ════════════════════════════════════════════════════════════════════════════
-- Resets current_streak to 0 for users with no winning market resolution
-- in the last 48h. longest_streak preserved (personal best). Daily 02:00.
--
-- APPLIED VIA SUPABASE MCP on 2026-05-01.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.decay_prediction_streaks()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_count int;
begin
  update prediction_streaks
  set current_streak = 0, updated_at = now()
  where current_streak > 0
    and (last_resolved_at is null or last_resolved_at < now() - interval '48 hours');
  get diagnostics v_count = row_count;
  return v_count;
end;
$function$;

DO $$
BEGIN
  PERFORM cron.unschedule('decay-prediction-streaks');
EXCEPTION WHEN OTHERS THEN NULL; END $$;

SELECT cron.schedule(
  'decay-prediction-streaks',
  '0 2 * * *',
  $$select public.decay_prediction_streaks();$$
);
