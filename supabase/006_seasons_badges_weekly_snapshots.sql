-- ════════════════════════════════════════════════════════════════════════════
-- Migration 006 — Seasons, badges, weekly snapshots
-- ════════════════════════════════════════════════════════════════════════════
-- Phase 0 foundation for the fantasy-music season layer. Three things live
-- here because they're the bedrock every other upcoming feature plugs into:
--
--   1. seasons + season_participations
--      Option C semantics (hybrid): portfolio persists across seasons,
--      but each season has its own leaderboard measuring return-% since
--      the user *joined* that particular season. A user who joins mid-
--      season is scored on their growth from their join-moment baseline,
--      so they're not permanently behind users who started earlier.
--
--   2. badges + user_badges + award_badge()
--      Generic event-bus sink. Future features (weekly matchups, IPO
--      events, album drops, thesis contest) all call award_badge() to
--      grant recognition. user_badges is publicly readable — badges are
--      identity items, not private data.
--
--   3. weekly_snapshots
--      The Friday Market Close mechanic writes one row per user per
--      week. This becomes the data source for the Sunday newsletter,
--      weekly matchup outcomes, and the weekly winners leaderboard.
--
-- RLS note: users INSERT their own season_participations (happens the
-- first time they load the app during an active season). Service-role
-- writes season end-state (final_rank, final_return_pct). Users cannot
-- UPDATE participations after insert — baseline is immutable.
--
-- APPLIED VIA SUPABASE MCP on 2026-04-23 as version 20260423133443.
-- Note: file numbered 006 for local sequence continuity (005 locally is
-- the leaderboard_public_lineup migration); the Supabase migration
-- name was recorded as "005_seasons_badges_weekly_snapshots".
-- ════════════════════════════════════════════════════════════════════════════

-- ──────────────────────────────────────────────────────────────────────
-- Seasons
-- ──────────────────────────────────────────────────────────────────────
create table if not exists public.seasons (
  id          serial primary key,
  slug        text unique not null,
  name        text not null,
  starts_at   timestamptz not null,
  ends_at     timestamptz not null,
  status      text not null default 'upcoming'
              check (status in ('upcoming', 'active', 'ended')),
  created_at  timestamptz default now(),
  check (ends_at > starts_at)
);

-- Enforce exactly one active season at a time.
create unique index if not exists seasons_single_active_idx
  on public.seasons (status)
  where status = 'active';

-- ──────────────────────────────────────────────────────────────────────
-- Season participations (per-user, per-season baseline + final standing)
-- ──────────────────────────────────────────────────────────────────────
create table if not exists public.season_participations (
  season_id                 int references public.seasons(id) on delete cascade,
  user_id                   uuid references auth.users(id) on delete cascade,
  joined_at                 timestamptz not null default now(),
  baseline_portfolio_value  numeric not null check (baseline_portfolio_value > 0),
  final_return_pct          numeric,
  final_rank                int,
  primary key (season_id, user_id)
);

create index if not exists season_participations_leaderboard_idx
  on public.season_participations (season_id, final_return_pct desc nulls last);

-- ──────────────────────────────────────────────────────────────────────
-- Badges catalog + earned badges
-- ──────────────────────────────────────────────────────────────────────
create table if not exists public.badges (
  id          serial primary key,
  slug        text unique not null,
  name        text not null,
  description text not null,
  icon        text,
  rarity      text not null default 'common'
              check (rarity in ('common', 'uncommon', 'rare', 'legendary')),
  created_at  timestamptz default now()
);

create table if not exists public.user_badges (
  user_id     uuid references auth.users(id) on delete cascade,
  badge_id    int references public.badges(id) on delete cascade,
  awarded_at  timestamptz default now(),
  metadata    jsonb default '{}'::jsonb,
  primary key (user_id, badge_id)
);

create index if not exists user_badges_user_idx
  on public.user_badges (user_id, awarded_at desc);

-- ──────────────────────────────────────────────────────────────────────
-- Weekly snapshots (Friday Market Close output)
-- ──────────────────────────────────────────────────────────────────────
create table if not exists public.weekly_snapshots (
  id                      serial primary key,
  week_start              date not null,
  week_end                date not null,
  user_id                 uuid references auth.users(id) on delete cascade,
  portfolio_value_start   numeric,
  portfolio_value_end     numeric,
  return_pct_week         numeric,
  rank_in_week            int,
  created_at              timestamptz default now(),
  unique (week_end, user_id)
);

create index if not exists weekly_snapshots_leaderboard_idx
  on public.weekly_snapshots (week_end, return_pct_week desc nulls last);

-- ──────────────────────────────────────────────────────────────────────
-- RLS
-- ──────────────────────────────────────────────────────────────────────
alter table public.seasons               enable row level security;
alter table public.season_participations enable row level security;
alter table public.badges                enable row level security;
alter table public.user_badges           enable row level security;
alter table public.weekly_snapshots      enable row level security;

-- Seasons catalog: anyone authenticated reads.
drop policy if exists "seasons_select_auth" on public.seasons;
create policy "seasons_select_auth"
  on public.seasons for select
  to authenticated using (true);

-- Season participations: users read + insert their own row only.
-- No UPDATE policy intentionally — baseline is immutable once set.
drop policy if exists "season_participations_select_own" on public.season_participations;
create policy "season_participations_select_own"
  on public.season_participations for select
  to authenticated using (auth.uid() = user_id);

drop policy if exists "season_participations_insert_own" on public.season_participations;
create policy "season_participations_insert_own"
  on public.season_participations for insert
  to authenticated with check (auth.uid() = user_id);

-- Badges catalog: all authenticated read.
drop policy if exists "badges_select_auth" on public.badges;
create policy "badges_select_auth"
  on public.badges for select
  to authenticated using (true);

-- user_badges: publicly readable (to all authenticated users) — badges
-- are social identity items, not private data. Users cannot self-grant
-- badges; only award_badge() (security definer) can insert.
drop policy if exists "user_badges_select_all" on public.user_badges;
create policy "user_badges_select_all"
  on public.user_badges for select
  to authenticated using (true);

-- Weekly snapshots: users see their own row. Aggregate rankings are
-- exposed via a future view or RPC, not by policy.
drop policy if exists "weekly_snapshots_select_own" on public.weekly_snapshots;
create policy "weekly_snapshots_select_own"
  on public.weekly_snapshots for select
  to authenticated using (auth.uid() = user_id);

-- ──────────────────────────────────────────────────────────────────────
-- Event bus — award_badge()
-- ──────────────────────────────────────────────────────────────────────
-- Idempotent badge award. Returns true if a new badge was granted,
-- false if the user already had it (or the slug doesn't exist).
-- security definer so it can write to user_badges without an explicit
-- insert policy; callers still need to be on a trusted code path.
create or replace function public.award_badge(
  p_user_id    uuid,
  p_badge_slug text,
  p_metadata   jsonb default '{}'::jsonb
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_badge_id int;
  v_rows     int;
begin
  select id into v_badge_id from public.badges where slug = p_badge_slug;
  if v_badge_id is null then
    return false;
  end if;

  insert into public.user_badges (user_id, badge_id, metadata)
  values (p_user_id, v_badge_id, p_metadata)
  on conflict (user_id, badge_id) do nothing;

  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$$;

revoke all on function public.award_badge(uuid, text, jsonb) from public;
grant execute on function public.award_badge(uuid, text, jsonb) to service_role;

-- ──────────────────────────────────────────────────────────────────────
-- Seed: Season 1 — Spring 2026 (starts 2026-04-23, ends 2026-06-30)
-- ──────────────────────────────────────────────────────────────────────
insert into public.seasons (slug, name, starts_at, ends_at, status)
values (
  '2026-q2',
  'Season 1 — Spring 2026',
  '2026-04-23 00:00:00+00',
  '2026-06-30 23:59:59+00',
  'active'
)
on conflict (slug) do nothing;

-- ──────────────────────────────────────────────────────────────────────
-- Seed: foundational badges
-- ──────────────────────────────────────────────────────────────────────
insert into public.badges (slug, name, description, rarity) values
  ('season-1-champion',   'Season 1 Champion',   'Finished #1 on the leaderboard in Season 1.',                 'legendary'),
  ('season-1-top-10',     'Season 1 Top 10',     'Finished in the top 10 of Season 1.',                         'rare'),
  ('season-1-top-100',    'Season 1 Top 100',    'Finished in the top 100 of Season 1.',                        'uncommon'),
  ('weekly-winner',       'Weekly Winner',       'Won a weekly market close — highest return of the week.',    'uncommon'),
  ('first-trade',         'First Trade',         'Placed your first trade on Muses Exchange.',                  'common'),
  ('diamond-hands',       'Diamond Hands',       'Held a position through a 50% drawdown and recovered.',       'rare'),
  ('sold-the-top',        'Sold the Top',        'Sold a position within 2% of its all-time high.',             'rare'),
  ('early-adopter',       'Early Adopter',       'Joined Muses Exchange in its first 90 days.',                 'uncommon')
on conflict (slug) do nothing;
