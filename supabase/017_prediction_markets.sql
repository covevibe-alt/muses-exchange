-- ════════════════════════════════════════════════════════════════════════════
-- Migration 017 — Prediction markets (parimutuel, paper credits)
-- ════════════════════════════════════════════════════════════════════════════
-- Phase 4 Chunk 1. Virtual-credit binary prediction markets. "Will $ARIA
-- cross $30 before May 15?" — YES/NO, pool-based, paper credits only so
-- it stays clear of real-money gambling regulation.
--
-- Model: parimutuel (like horse-track betting). Each market has a YES
-- pool and a NO pool. Bettors add to their side's pool. At resolution,
-- the winning side shares the *full* pot (YES + NO) proportionally to
-- each winner's stake. No fixed odds, no counterparty — the market
-- self-balances as demand shifts between sides.
--
-- Isolation: users get a dedicated prediction_balances row (default
-- $10,000 paper credits) that's SEPARATE from STATE.cash in the stock
-- exchange. Prediction losses never touch stock-trading cash and vice
-- versa. This makes each economy legible independently + makes it
-- trivial to migrate the prediction side to real money later without
-- corrupting the stock-side ledger.
--
-- Resolution: v1 is manual via resolve_prediction_market() RPC
-- (service role only). Future layer: auto-resolution for price_target
-- markets using a server-side price feed.
--
-- APPLIED VIA SUPABASE MCP on 2026-04-24. Two seed markets created.
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.prediction_markets (
  id                serial primary key,
  slug              text unique not null,
  question          text not null,
  artist_ticker     text,
  market_type       text not null default 'generic'
                    check (market_type in ('price_target', 'generic')),
  target_value      numeric,
  target_direction  text
                    check (target_direction is null or target_direction in ('above', 'below')),
  resolves_at       timestamptz not null,
  resolved_at       timestamptz,
  resolution        text
                    check (resolution is null or resolution in ('yes', 'no', 'canceled')),
  yes_pool          numeric not null default 0 check (yes_pool >= 0),
  no_pool           numeric not null default 0 check (no_pool  >= 0),
  status            text not null default 'open'
                    check (status in ('open', 'resolved', 'canceled')),
  created_by        uuid references auth.users(id) on delete set null,
  created_at        timestamptz default now(),
  check (char_length(question) between 8 and 200)
);

create index if not exists prediction_markets_status_idx
  on public.prediction_markets (status, resolves_at);
create index if not exists prediction_markets_ticker_idx
  on public.prediction_markets (artist_ticker) where artist_ticker is not null;

create table if not exists public.prediction_bets (
  id          serial primary key,
  market_id   int  not null references public.prediction_markets(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  side        text not null check (side in ('yes', 'no')),
  amount      numeric not null check (amount > 0),
  placed_at   timestamptz default now(),
  payout      numeric
);

create index if not exists prediction_bets_market_idx on public.prediction_bets (market_id);
create index if not exists prediction_bets_user_idx   on public.prediction_bets (user_id, placed_at desc);

create table if not exists public.prediction_balances (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  balance     numeric not null default 10000 check (balance >= 0),
  updated_at  timestamptz default now()
);

alter table public.prediction_markets  enable row level security;
alter table public.prediction_bets     enable row level security;
alter table public.prediction_balances enable row level security;

drop policy if exists "markets_select_auth" on public.prediction_markets;
create policy "markets_select_auth"
  on public.prediction_markets for select
  to authenticated using (true);

drop policy if exists "bets_select_own" on public.prediction_bets;
create policy "bets_select_own"
  on public.prediction_bets for select
  to authenticated using (auth.uid() = user_id);

drop policy if exists "balances_select_own" on public.prediction_balances;
create policy "balances_select_own"
  on public.prediction_balances for select
  to authenticated using (auth.uid() = user_id);

create or replace function public.ensure_prediction_balance(p_user_id uuid)
returns numeric
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_balance numeric;
begin
  insert into prediction_balances (user_id) values (p_user_id)
  on conflict (user_id) do nothing;
  select balance into v_balance from prediction_balances where user_id = p_user_id;
  return v_balance;
end;
$$;

revoke all    on function public.ensure_prediction_balance(uuid) from public;
grant execute on function public.ensure_prediction_balance(uuid) to authenticated, service_role;

create or replace function public.get_my_prediction_balance()
returns numeric
language plpgsql
security definer
set search_path = public, pg_temp
stable
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then return null; end if;
  return public.ensure_prediction_balance(v_user_id);
end;
$$;

revoke all    on function public.get_my_prediction_balance() from public;
grant execute on function public.get_my_prediction_balance() to authenticated;

create or replace function public.place_prediction_bet(
  p_market_id int,
  p_side      text,
  p_amount    numeric
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id   uuid := auth.uid();
  v_market    record;
  v_balance   numeric;
  v_amount    numeric;
begin
  if v_user_id is null then
    return jsonb_build_object('error', 'not_authenticated');
  end if;
  if p_side not in ('yes', 'no') then
    return jsonb_build_object('error', 'invalid_side');
  end if;
  v_amount := round(coalesce(p_amount, 0)::numeric, 2);
  if v_amount <= 0 then
    return jsonb_build_object('error', 'invalid_amount');
  end if;

  select * into v_market
  from prediction_markets
  where id = p_market_id
  for update;
  if v_market.id is null then
    return jsonb_build_object('error', 'market_not_found');
  end if;
  if v_market.status <> 'open' then
    return jsonb_build_object('error', 'market_closed');
  end if;
  if v_market.resolves_at <= now() then
    return jsonb_build_object('error', 'market_expired');
  end if;

  perform public.ensure_prediction_balance(v_user_id);
  update prediction_balances
  set balance    = balance - v_amount,
      updated_at = now()
  where user_id = v_user_id
    and balance >= v_amount;
  if not found then
    return jsonb_build_object('error', 'insufficient_balance');
  end if;

  insert into prediction_bets (market_id, user_id, side, amount)
  values (p_market_id, v_user_id, p_side, v_amount);

  if p_side = 'yes' then
    update prediction_markets set yes_pool = yes_pool + v_amount where id = p_market_id;
  else
    update prediction_markets set no_pool  = no_pool  + v_amount where id = p_market_id;
  end if;

  select balance into v_balance from prediction_balances where user_id = v_user_id;

  return jsonb_build_object(
    'ok',        true,
    'balance',   v_balance,
    'yes_pool',  v_market.yes_pool + case when p_side = 'yes' then v_amount else 0 end,
    'no_pool',   v_market.no_pool  + case when p_side = 'no'  then v_amount else 0 end
  );
end;
$$;

revoke all    on function public.place_prediction_bet(int, text, numeric) from public;
grant execute on function public.place_prediction_bet(int, text, numeric) to authenticated;

create or replace function public.create_prediction_market(
  p_question         text,
  p_artist_ticker    text default null,
  p_market_type      text default 'generic',
  p_target_value     numeric default null,
  p_target_direction text default null,
  p_resolves_at      timestamptz default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id       int;
  v_slug     text;
  v_question text := btrim(coalesce(p_question, ''));
  v_resolves timestamptz := coalesce(p_resolves_at, now() + interval '14 days');
begin
  if char_length(v_question) < 8 or char_length(v_question) > 200 then
    return jsonb_build_object('error', 'invalid_question');
  end if;
  if p_market_type = 'price_target' and (p_target_value is null or p_target_direction is null) then
    return jsonb_build_object('error', 'price_target_needs_value_and_direction');
  end if;

  v_slug := regexp_replace(lower(v_question), '[^a-z0-9]+', '-', 'g');
  v_slug := trim(both '-' from v_slug);
  if char_length(v_slug) = 0 then v_slug := 'market'; end if;
  v_slug := substr(v_slug, 1, 48) || '-' || substr(md5(random()::text), 1, 6);

  insert into prediction_markets (
    slug, question, artist_ticker, market_type,
    target_value, target_direction, resolves_at, created_by
  ) values (
    v_slug, v_question, upper(nullif(btrim(p_artist_ticker), '')), p_market_type,
    p_target_value, p_target_direction, v_resolves, auth.uid()
  )
  returning id into v_id;

  return jsonb_build_object('ok', true, 'market_id', v_id, 'slug', v_slug);
end;
$$;

revoke all    on function public.create_prediction_market(text, text, text, numeric, text, timestamptz) from public;
grant execute on function public.create_prediction_market(text, text, text, numeric, text, timestamptz) to service_role;

create or replace function public.resolve_prediction_market(
  p_market_id int,
  p_outcome   text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_market        record;
  v_total_pool    numeric;
  v_winning_pool  numeric;
  v_bet           record;
  v_payout        numeric;
  v_paid_out      numeric := 0;
  v_winners       int := 0;
begin
  if p_outcome not in ('yes', 'no', 'canceled') then
    return jsonb_build_object('error', 'invalid_outcome');
  end if;

  select * into v_market from prediction_markets where id = p_market_id for update;
  if v_market.id is null then
    return jsonb_build_object('error', 'market_not_found');
  end if;
  if v_market.status <> 'open' then
    return jsonb_build_object('error', 'market_already_closed');
  end if;

  if p_outcome = 'canceled' then
    for v_bet in select * from prediction_bets where market_id = p_market_id loop
      update prediction_balances
      set balance = balance + v_bet.amount, updated_at = now()
      where user_id = v_bet.user_id;
      update prediction_bets set payout = v_bet.amount where id = v_bet.id;
      v_paid_out := v_paid_out + v_bet.amount;
    end loop;
    update prediction_markets
    set status = 'canceled', resolution = 'canceled', resolved_at = now()
    where id = p_market_id;
    return jsonb_build_object('ok', true, 'refunded', v_paid_out);
  end if;

  v_total_pool   := v_market.yes_pool + v_market.no_pool;
  v_winning_pool := case when p_outcome = 'yes' then v_market.yes_pool else v_market.no_pool end;

  if v_winning_pool <= 0 then
    for v_bet in select * from prediction_bets where market_id = p_market_id loop
      update prediction_balances
      set balance = balance + v_bet.amount, updated_at = now()
      where user_id = v_bet.user_id;
      update prediction_bets set payout = v_bet.amount where id = v_bet.id;
    end loop;
    update prediction_markets
    set status = 'canceled', resolution = 'canceled', resolved_at = now()
    where id = p_market_id;
    return jsonb_build_object('ok', true, 'refunded', v_total_pool,
                              'note', 'no_winners_refunded');
  end if;

  for v_bet in
    select * from prediction_bets
    where market_id = p_market_id and side = p_outcome
  loop
    v_payout := round((v_bet.amount / v_winning_pool) * v_total_pool, 2);
    update prediction_balances
    set balance = balance + v_payout, updated_at = now()
    where user_id = v_bet.user_id;
    update prediction_bets set payout = v_payout where id = v_bet.id;
    v_paid_out := v_paid_out + v_payout;
    v_winners  := v_winners + 1;
  end loop;

  update prediction_bets set payout = 0
  where market_id = p_market_id and side <> p_outcome;

  update prediction_markets
  set status = 'resolved', resolution = p_outcome, resolved_at = now()
  where id = p_market_id;

  return jsonb_build_object(
    'ok',          true,
    'outcome',     p_outcome,
    'winners',     v_winners,
    'paid_out',    v_paid_out,
    'total_pool',  v_total_pool
  );
end;
$$;

revoke all    on function public.resolve_prediction_market(int, text) from public;
grant execute on function public.resolve_prediction_market(int, text) to service_role;

-- Seed markets so the UI has something to show at launch.
select public.create_prediction_market(
  'Will $FAYE finish its IPO week above $2.00?',
  'FAYE', 'price_target', 2.00, 'above',
  now() + interval '7 days'
);
select public.create_prediction_market(
  'Will any Muses trader break +100% return by end of Season 1?',
  null, 'generic', null, null,
  now() + interval '30 days'
);
