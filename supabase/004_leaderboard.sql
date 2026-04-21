-- ════════════════════════════════════════════════════════════════════════════
-- Migration 004 — Public leaderboard table
-- ════════════════════════════════════════════════════════════════════════════
-- A deliberately separate table from public.portfolios. The portfolios.snapshot
-- column holds full private state (holdings, transaction history, open orders),
-- so its RLS must stay owner-only. The leaderboard exposes just enough to rank
-- users — display_name, portfolio_value, return_pct — and nothing else.
--
-- Flow on the client:
--   1. After every portfolio push, compute portfolio_value + return_pct
--      from STATE (cash + Σ shares × current price).
--   2. Upsert a row keyed on user_id with the current display_name
--      (STATE.profile.handle, falling back to email prefix, then "trader").
--   3. The leaderboard view (renderLeaderboard) queries this table.
--
-- Display name is user-controlled. The trigger-free approach is intentional:
-- if a user sets an offensive handle, I want to be able to observe and act
-- (email notifier from 003 still fires on signup, so I'll see every new user).
-- Phase 2 can add server-side validation / profanity filtering.
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.leaderboard (
  user_id         uuid primary key references auth.users(id) on delete cascade,
  display_name    text,
  portfolio_value numeric,
  return_pct      numeric,
  updated_at      timestamptz default now()
);

alter table public.leaderboard enable row level security;

-- Anyone authenticated can read every row — that's the whole point of a
-- leaderboard. Anon (unauthenticated) visitors are blocked so the data
-- isn't trivially scrapable.
drop policy if exists "leaderboard_select_auth" on public.leaderboard;
create policy "leaderboard_select_auth"
  on public.leaderboard
  for select
  to authenticated
  using (true);

-- Users can only insert/update/delete their OWN row. Prevents a bad actor
-- from forging high scores on behalf of other users.
drop policy if exists "leaderboard_write_own" on public.leaderboard;
create policy "leaderboard_write_own"
  on public.leaderboard
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Primary access pattern: ORDER BY portfolio_value DESC, limit N.
create index if not exists leaderboard_portfolio_value_idx
  on public.leaderboard (portfolio_value desc nulls last);
