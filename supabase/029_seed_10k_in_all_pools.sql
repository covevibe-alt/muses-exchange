-- ════════════════════════════════════════════════════════════════════════════
-- Migration 029 — Seed every user with $10k in all 3 currencies
-- ════════════════════════════════════════════════════════════════════════════
-- Paper trading and prediction credits already default to 10000. Tournament
-- credits defaulted to 0, which gave new users no starter pool to enter
-- tournaments with. Bumping the default to 10000 + topping up existing
-- users so every account gets a uniform $10k / $10k / $10k starting line.
--
-- Backfill rule: only users with LESS than 10000 are bumped to 10000.
-- Anyone who has earned tournament credits beyond 10k (winners) keeps
-- their winnings.
--
-- APPLIED VIA SUPABASE MCP on 2026-04-28.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.portfolios
  alter column tournament_credits set default 10000;

update public.portfolios
set tournament_credits = 10000,
    snapshot = case
      when snapshot is null then jsonb_build_object('tournamentCredits', 10000)
      else jsonb_set(snapshot, '{tournamentCredits}', to_jsonb(10000))
    end,
    updated_at = now()
where coalesce(tournament_credits, 0) < 10000;

update public.prediction_balances
set balance = 10000, updated_at = now()
where balance < 10000;

insert into public.prediction_balances (user_id, balance)
select u.id, 10000
from auth.users u
left join public.prediction_balances pb on pb.user_id = u.id
where pb.user_id is null
on conflict (user_id) do nothing;
