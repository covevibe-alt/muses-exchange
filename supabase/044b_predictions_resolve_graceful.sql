-- ════════════════════════════════════════════════════════════════════════════
-- Migration 044b — resolve_expired_predictions() graceful w/o artists tbl
-- ════════════════════════════════════════════════════════════════════════════
-- 044's auto-resolution branches for up_down / vs_artist / vs_genre
-- referenced an `artists` table that doesn't exist — Muses keeps artist
-- prices entirely client-side (no server-side pricing snapshot). Patch
-- the function to gracefully degrade: until an `artist_prices` table
-- lands, every typed market falls into the manual queue with a clear
-- reason code. Cancel-empty-pool / refund logic stays airtight.
--
-- When server-side prices exist, set v_have_prices to true and add
-- per-type lookups (compare current price to target_value, compare
-- two tickers, etc.).
--
-- APPLIED VIA SUPABASE MCP on 2026-05-01.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.resolve_expired_predictions()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_market   record;
  v_outcome  text;
  v_reason   text;
  v_resolved int := 0;
  v_queued   int := 0;
  v_canceled int := 0;
  v_have_prices boolean := (to_regclass('public.artist_prices') is not null);
begin
  for v_market in
    select * from prediction_markets
    where status = 'open'
      and resolves_at <= now()
    order by resolves_at asc
  loop
    v_outcome := null;
    v_reason  := null;

    -- Markets with no bets: cancel (no work to pay out).
    if v_market.yes_pool + v_market.no_pool = 0 then
      update prediction_markets
      set status = 'canceled', resolution = 'canceled', resolved_at = now()
      where id = v_market.id;
      v_canceled := v_canceled + 1;
      continue;
    end if;

    -- Markets with one side empty: refund both sides via cancel.
    if v_market.yes_pool = 0 or v_market.no_pool = 0 then
      update prediction_markets
      set status = 'canceled', resolution = 'canceled', resolved_at = now()
      where id = v_market.id;
      v_canceled := v_canceled + 1;
      continue;
    end if;

    -- Auto-resolution requires server-side prices. Until that lands,
    -- every market falls into the manual queue regardless of type.
    if v_have_prices then
      v_reason := 'manual_pending_implementation';
    else
      v_reason := case v_market.prediction_type
        when 'up_down'   then 'manual_no_server_prices'
        when 'vs_artist' then 'manual_no_server_prices'
        when 'vs_genre'  then 'manual_no_server_prices'
        when 'by_date'   then 'manual_type'
        when 'yes_no'    then 'manual_type'
        else 'unknown_type'
      end;
    end if;

    if v_outcome is not null then
      update prediction_markets
      set status = 'resolved', resolution = v_outcome, resolved_at = now()
      where id = v_market.id;
      v_resolved := v_resolved + 1;
    else
      insert into predictions_pending_resolution (market_id, reason)
      values (v_market.id, coalesce(v_reason, 'unknown'))
      on conflict (market_id) do nothing;
      v_queued := v_queued + 1;
    end if;
  end loop;

  return jsonb_build_object('resolved', v_resolved, 'queued', v_queued, 'canceled', v_canceled);
end;
$function$;
