-- ════════════════════════════════════════════════════════════════════════════
-- Migration 027 — Credit swaps between paper / prediction / tournament pools
-- ════════════════════════════════════════════════════════════════════════════
-- New flat column:
--   • portfolios.tournament_credits — was buried inside portfolios.snapshot
--     (JSONB blob). Promoted to a flat column so the swap RPC can do atomic
--     updates without read-modify-write on the JSONB.
--
-- New table:
--   • credit_swaps — audit log for every swap (user_id, from, to, amount, ts)
--
-- New RPC:
--   • swap_credits(p_from text, p_to text, p_amount numeric)
--     1:1 conversion. No fee. No daily limit. Atomic. Validates currencies +
--     sufficient balance. Returns the user's three new balances.
--
-- The RPC updates BOTH portfolios.tournament_credits (flat column, used by
-- the swap math) AND portfolios.snapshot->>'tournamentCredits' (jsonb, used
-- by the existing client persistence layer) so a stale-snapshot reload
-- doesn't undo the swap.
--
-- APPLIED VIA SUPABASE MCP on 2026-04-28.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.portfolios
  add column if not exists tournament_credits numeric not null default 0;

update public.portfolios
set tournament_credits = coalesce((snapshot->>'tournamentCredits')::numeric, 0)
where tournament_credits = 0
  and snapshot is not null
  and snapshot ? 'tournamentCredits';

create table if not exists public.credit_swaps (
  id              bigserial primary key,
  user_id         uuid not null references auth.users(id) on delete cascade,
  from_currency   text not null check (from_currency in ('paper','prediction','tournament')),
  to_currency     text not null check (to_currency   in ('paper','prediction','tournament')),
  amount          numeric not null check (amount > 0),
  created_at      timestamptz not null default now()
);

create index if not exists credit_swaps_user_idx
  on public.credit_swaps (user_id, created_at desc);

alter table public.credit_swaps enable row level security;

drop policy if exists "credit_swaps_select_own" on public.credit_swaps;
create policy "credit_swaps_select_own" on public.credit_swaps
  for select to authenticated using (auth.uid() = user_id);

create or replace function public.swap_credits(
  p_from   text,
  p_to     text,
  p_amount numeric
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_amount  numeric := round(coalesce(p_amount, 0)::numeric, 2);
  v_paper_cash numeric;
  v_pred_balance numeric;
  v_tourn_credits numeric;
begin
  if v_user_id is null then
    return jsonb_build_object('error', 'not_authenticated');
  end if;
  if p_from = p_to then
    return jsonb_build_object('error', 'same_currency');
  end if;
  if p_from not in ('paper','prediction','tournament')
     or p_to   not in ('paper','prediction','tournament') then
    return jsonb_build_object('error', 'invalid_currency');
  end if;
  if v_amount <= 0 then
    return jsonb_build_object('error', 'invalid_amount');
  end if;

  insert into portfolios (user_id) values (v_user_id) on conflict do nothing;
  insert into prediction_balances (user_id) values (v_user_id) on conflict do nothing;

  perform 1 from portfolios where user_id = v_user_id for update;

  if p_from = 'paper' then
    update portfolios
    set cash = cash - v_amount, updated_at = now()
    where user_id = v_user_id and cash >= v_amount;
    if not found then return jsonb_build_object('error', 'insufficient_paper'); end if;
  elsif p_from = 'prediction' then
    update prediction_balances
    set balance = balance - v_amount, updated_at = now()
    where user_id = v_user_id and balance >= v_amount;
    if not found then return jsonb_build_object('error', 'insufficient_prediction'); end if;
  else
    update portfolios
    set tournament_credits = tournament_credits - v_amount, updated_at = now()
    where user_id = v_user_id and tournament_credits >= v_amount;
    if not found then return jsonb_build_object('error', 'insufficient_tournament'); end if;
  end if;

  if p_to = 'paper' then
    update portfolios
    set cash = cash + v_amount, updated_at = now()
    where user_id = v_user_id;
  elsif p_to = 'prediction' then
    update prediction_balances
    set balance = balance + v_amount, updated_at = now()
    where user_id = v_user_id;
  else
    update portfolios
    set tournament_credits = tournament_credits + v_amount, updated_at = now()
    where user_id = v_user_id;
  end if;

  update portfolios
  set snapshot = case
    when snapshot is null then jsonb_build_object('tournamentCredits', tournament_credits)
    else jsonb_set(snapshot, '{tournamentCredits}', to_jsonb(tournament_credits))
  end
  where user_id = v_user_id;

  insert into credit_swaps (user_id, from_currency, to_currency, amount)
  values (v_user_id, p_from, p_to, v_amount);

  select cash, tournament_credits into v_paper_cash, v_tourn_credits
  from portfolios where user_id = v_user_id;
  select balance into v_pred_balance
  from prediction_balances where user_id = v_user_id;

  return jsonb_build_object(
    'ok',          true,
    'paper',       v_paper_cash,
    'prediction',  v_pred_balance,
    'tournament',  v_tourn_credits
  );
end;
$$;

revoke execute on function public.swap_credits(text, text, numeric) from public, anon;
grant  execute on function public.swap_credits(text, text, numeric) to authenticated;

comment on function public.swap_credits(text, text, numeric) is
  'Atomic 1:1 swap between paper / prediction / tournament currencies. Returns new balances.';
