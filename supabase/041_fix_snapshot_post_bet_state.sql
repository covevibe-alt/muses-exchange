-- ════════════════════════════════════════════════════════════════════════════
-- Migration 041 — Fix snapshot trigger to capture post-bet state
-- ════════════════════════════════════════════════════════════════════════════
-- The AFTER INSERT trigger on prediction_bets (snapshot_market_after_bet)
-- fires immediately after the bet INSERT but BEFORE the subsequent UPDATE
-- on prediction_markets in place_prediction_bet(). That meant each snapshot
-- captured the pool state PRIOR to the just-inserted bet, so the chart
-- always lagged one bet behind — a $50 YES bet would update the chart with
-- the previous bet's effect, not its own.
--
-- Fix: fold NEW.amount onto the right side at snapshot time so the row
-- reflects the POST-bet state the user sees right after their bet lands.
--
-- APPLIED VIA SUPABASE MCP on 2026-04-30.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.snapshot_market_after_bet()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_yes numeric;
  v_no  numeric;
  v_total numeric;
  v_pct numeric;
begin
  select yes_pool, no_pool into v_yes, v_no
  from prediction_markets where id = NEW.market_id;
  v_yes := coalesce(v_yes, 0);
  v_no  := coalesce(v_no,  0);
  -- Apply this bet's amount to the right pool — the prediction_markets
  -- UPDATE in place_prediction_bet() runs AFTER us, so v_yes/v_no don't
  -- yet include NEW.amount. Folding it in here makes the snapshot match
  -- the pool state the user actually sees right after their bet lands.
  if NEW.side = 'yes' then
    v_yes := v_yes + NEW.amount;
  else
    v_no  := v_no  + NEW.amount;
  end if;
  v_total := v_yes + v_no;
  v_pct := case when v_total > 0 then (v_yes / v_total) * 100 else 50 end;
  insert into prediction_market_snapshots (market_id, yes_pool, no_pool, yes_pct)
  values (NEW.market_id, v_yes, v_no, v_pct);
  return NEW;
end;
$function$;
