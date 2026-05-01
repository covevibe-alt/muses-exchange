-- ════════════════════════════════════════════════════════════════════════════
-- Migration 044 — Predictions: auto-resolve + payouts (Phase 1)
-- ════════════════════════════════════════════════════════════════════════════
-- Adds the operational backbone so prediction markets don't pile up
-- needing manual settlement:
--
--   1. paid_out_at column on prediction_markets — idempotency flag.
--   2. predictions_pending_resolution queue — captures markets the cron
--      can't auto-decide. Sander resolves manually via
--      admin_resolve_prediction_market(market_id, outcome).
--   3. resolve_expired_predictions() — daily cron pass:
--        - cancels markets with zero or one-sided pools
--        - queues every other market for manual resolution (until
--          server-side artist prices exist; see 044b)
--   4. payout_resolved_predictions() — pays winners parimutuel-style,
--      refunds canceled markets 1:1, stamps paid_out_at.
--   5. resolve_predictions_tick() — single entry point that runs both.
--   6. admin_resolve_prediction_market(market_id, outcome) — manual
--      resolution RPC; auto-runs payout pass after marking the outcome.
--   7. Cron 'resolve-predictions' — daily 00:30 UTC.
--
-- APPLIED VIA SUPABASE MCP on 2026-05-01.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE prediction_markets
  ADD COLUMN IF NOT EXISTS paid_out_at timestamptz;

CREATE TABLE IF NOT EXISTS predictions_pending_resolution (
  id           bigserial PRIMARY KEY,
  market_id    integer NOT NULL UNIQUE REFERENCES prediction_markets(id) ON DELETE CASCADE,
  reason       text NOT NULL,
  queued_at    timestamptz NOT NULL DEFAULT now(),
  resolved_at  timestamptz,
  resolved_by  uuid,
  outcome      text
);
CREATE INDEX IF NOT EXISTS predictions_pending_resolution_open_idx
  ON predictions_pending_resolution (queued_at)
  WHERE resolved_at IS NULL;

-- See 044b for the up-to-date resolve_expired_predictions() — this 044
-- version had a bug (referenced a public.artists table that doesn't
-- exist; prices are client-side). 044b patches it to gracefully
-- degrade: every typed market falls into the manual queue until a
-- server-side artist_prices table is added.

CREATE OR REPLACE FUNCTION public.payout_resolved_predictions()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_market         record;
  v_total_pool     numeric;
  v_winning_pool   numeric;
  v_winning_side   text;
  v_paid_markets   int := 0;
  v_paid_bets      int := 0;
begin
  for v_market in
    select * from prediction_markets
    where status in ('resolved', 'canceled')
      and paid_out_at is null
      and resolution is not null
    order by resolved_at asc
  loop
    -- Cancellation refund: every bet gets its stake back.
    if v_market.resolution = 'canceled' then
      with refunded as (
        update prediction_bets
        set payout = amount
        where market_id = v_market.id
        returning user_id, amount
      )
      update prediction_balances pb
      set balance    = pb.balance + r.refund,
          updated_at = now()
      from (
        select user_id, sum(amount) as refund from refunded group by user_id
      ) r
      where pb.user_id = r.user_id;

      get diagnostics v_paid_bets = row_count;
      v_paid_markets := v_paid_markets + 1;

      update prediction_markets
      set paid_out_at = now()
      where id = v_market.id;
      continue;
    end if;

    v_total_pool := v_market.yes_pool + v_market.no_pool;
    if v_market.resolution = 'yes' then
      v_winning_pool := v_market.yes_pool;
      v_winning_side := 'yes';
    else
      v_winning_pool := v_market.no_pool;
      v_winning_side := 'no';
    end if;

    -- Defensive: if winning pool is 0, refund instead of div-by-zero.
    if v_winning_pool = 0 then
      update prediction_bets
      set payout = amount
      where market_id = v_market.id;
      update prediction_balances pb
      set balance    = pb.balance + r.refund,
          updated_at = now()
      from (
        select user_id, sum(amount) as refund
        from prediction_bets where market_id = v_market.id
        group by user_id
      ) r
      where pb.user_id = r.user_id;
      update prediction_markets
      set paid_out_at = now(), resolution = 'canceled', status = 'canceled'
      where id = v_market.id;
      v_paid_markets := v_paid_markets + 1;
      continue;
    end if;

    -- Winning bets: payout = stake * totalPool / winningPool. Losers: 0.
    update prediction_bets
    set payout = case
                   when side = v_winning_side then amount * v_total_pool / v_winning_pool
                   else 0
                 end
    where market_id = v_market.id;

    with winners as (
      select user_id, sum(amount * v_total_pool / v_winning_pool) as gross
      from prediction_bets
      where market_id = v_market.id and side = v_winning_side
      group by user_id
    )
    update prediction_balances pb
    set balance    = pb.balance + w.gross,
        updated_at = now()
    from winners w
    where pb.user_id = w.user_id;

    update prediction_markets
    set paid_out_at = now()
    where id = v_market.id;

    v_paid_markets := v_paid_markets + 1;
  end loop;

  return jsonb_build_object('paid_markets', v_paid_markets);
end;
$function$;

CREATE OR REPLACE FUNCTION public.resolve_predictions_tick()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_resolve jsonb;
  v_payout  jsonb;
begin
  v_resolve := public.resolve_expired_predictions();
  v_payout  := public.payout_resolved_predictions();
  return jsonb_build_object('resolve', v_resolve, 'payout', v_payout, 'ts', now());
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_resolve_prediction_market(
  p_market_id integer,
  p_outcome   text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_user uuid := auth.uid();
  v_market record;
begin
  if v_user is null then
    return jsonb_build_object('error', 'not_authenticated');
  end if;
  if p_outcome not in ('yes', 'no', 'canceled') then
    return jsonb_build_object('error', 'invalid_outcome');
  end if;

  select * into v_market from prediction_markets where id = p_market_id for update;
  if v_market.id is null then
    return jsonb_build_object('error', 'market_not_found');
  end if;
  if v_market.status <> 'open' then
    return jsonb_build_object('error', 'already_resolved');
  end if;

  update prediction_markets
  set status     = case when p_outcome = 'canceled' then 'canceled' else 'resolved' end,
      resolution = p_outcome,
      resolved_at = now()
  where id = p_market_id;

  update predictions_pending_resolution
  set resolved_at = now(),
      resolved_by = v_user,
      outcome     = p_outcome
  where market_id = p_market_id and resolved_at is null;

  perform public.payout_resolved_predictions();

  return jsonb_build_object('ok', true, 'market_id', p_market_id, 'outcome', p_outcome);
end;
$function$;

DO $$
BEGIN
  PERFORM cron.unschedule('resolve-predictions');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

SELECT cron.schedule(
  'resolve-predictions',
  '30 0 * * *',
  $$select public.resolve_predictions_tick();$$
);
