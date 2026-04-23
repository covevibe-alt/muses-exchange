-- ════════════════════════════════════════════════════════════════════════════
-- Migration 011 — Badge content pack + auto-award triggers + backfill
-- ════════════════════════════════════════════════════════════════════════════
-- Phase 2 Chunk 1 — the achievement content layer. Extends the seed
-- catalog from migration 006 with collectible-identity badges, wires up
-- triggers on filled_orders + leaderboard to auto-award on qualifying
-- events, and backfills retroactive awards so existing users aren't
-- greeted with an empty badges strip.
--
-- Badges added:
--   • ten-hold-club        - hold 10+ distinct tickers simultaneously
--   • portfolio-20k / 50k  - portfolio value crosses $20k / $50k
--   • portfolio-100k       - the "Six Figures" badge, legendary-rarity
--   • public-lineup        - opted into public top-holdings display
--   • email-subscriber     - signed up for the weekly newsletter
--   • muse-veteran         - completed a full season with a positive return
--   • five-match-streak    - won 5 weekly matchups in a row
--
-- Triggers:
--   • badges_on_filled_order()  — fires AFTER INSERT on filled_orders
--       awards: first-trade, ten-hold-club
--   • badges_on_leaderboard_update() — fires AFTER UPDATE of portfolio_value
--       awards: portfolio-20k, portfolio-50k, portfolio-100k
--
-- All awards route through award_badge() from migration 006, which is
-- idempotent — the triggers can fire on every row and only new badges
-- actually materialize.
--
-- APPLIED VIA SUPABASE MCP on 2026-04-23.
-- Backfill snapshot at apply time: 5 users got early-adopter + email-subscriber;
-- no users qualified for first-trade, ten-hold-club, or any portfolio
-- threshold yet (accurate for a brand-new trading layer).
-- ════════════════════════════════════════════════════════════════════════════

-- ──────────────────────────────────────────────────────────────────────
-- Extend badge catalog
-- ──────────────────────────────────────────────────────────────────────
insert into public.badges (slug, name, description, rarity) values
  ('ten-hold-club',     'Ten-Hold Club',     'Held 10 different artists at once.',                    'uncommon'),
  ('portfolio-20k',     'First $20k',        'Portfolio value first crossed $20,000.',                'uncommon'),
  ('portfolio-50k',     'The $50k Club',     'Portfolio value first crossed $50,000.',                'rare'),
  ('portfolio-100k',    'Six Figures',       'Portfolio value first crossed $100,000.',               'legendary'),
  ('public-lineup',     'Open Book',         'Made your top holdings public on the leaderboard.',     'common'),
  ('email-subscriber',  'Signed Up',         'Subscribed to the weekly newsletter.',                  'common'),
  ('muse-veteran',      'Muse Veteran',      'Completed a full season with a positive return.',       'rare'),
  ('five-match-streak', 'Five-Match Streak', 'Won 5 weekly head-to-head matchups in a row.',          'rare')
on conflict (slug) do nothing;

-- ──────────────────────────────────────────────────────────────────────
-- Trigger: badges_on_filled_order
-- ──────────────────────────────────────────────────────────────────────
create or replace function public.badges_on_filled_order()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_prior_count int;
  v_unique_held int;
begin
  -- first-trade: this is the user's first filled_orders row.
  select count(*) into v_prior_count
  from public.filled_orders
  where user_id = new.user_id
    and filled_at < new.filled_at;

  if v_prior_count = 0 then
    perform public.award_badge(new.user_id, 'first-trade');
  end if;

  -- ten-hold-club: user now holds 10+ distinct tickers with qty > 0.
  select count(distinct ticker) into v_unique_held
  from public.holdings
  where user_id = new.user_id and qty > 0;

  if v_unique_held >= 10 then
    perform public.award_badge(new.user_id, 'ten-hold-club');
  end if;

  return new;
end;
$$;

drop trigger if exists on_filled_order_badges on public.filled_orders;
create trigger on_filled_order_badges
  after insert on public.filled_orders
  for each row execute function public.badges_on_filled_order();

-- ──────────────────────────────────────────────────────────────────────
-- Trigger: badges_on_leaderboard_update
-- ──────────────────────────────────────────────────────────────────────
create or replace function public.badges_on_leaderboard_update()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.portfolio_value is null then return new; end if;

  if new.portfolio_value >= 20000 then
    perform public.award_badge(new.user_id, 'portfolio-20k');
  end if;
  if new.portfolio_value >= 50000 then
    perform public.award_badge(new.user_id, 'portfolio-50k');
  end if;
  if new.portfolio_value >= 100000 then
    perform public.award_badge(new.user_id, 'portfolio-100k');
  end if;

  return new;
end;
$$;

drop trigger if exists on_leaderboard_portfolio_badges on public.leaderboard;
create trigger on_leaderboard_portfolio_badges
  after insert or update of portfolio_value on public.leaderboard
  for each row execute function public.badges_on_leaderboard_update();

-- ──────────────────────────────────────────────────────────────────────
-- Retroactive backfill
-- ──────────────────────────────────────────────────────────────────────
-- early-adopter: every user who exists today qualifies (we're within
-- the first 90 days of Muses existing in its current form).
insert into public.user_badges (user_id, badge_id)
select u.id, b.id
from auth.users u, public.badges b
where b.slug = 'early-adopter'
on conflict (user_id, badge_id) do nothing;

-- first-trade: anyone with at least one filled_orders row.
insert into public.user_badges (user_id, badge_id)
select distinct fo.user_id, b.id
from public.filled_orders fo, public.badges b
where b.slug = 'first-trade'
on conflict (user_id, badge_id) do nothing;

-- portfolio thresholds: anyone whose current leaderboard row qualifies.
insert into public.user_badges (user_id, badge_id)
select lb.user_id, b.id
from public.leaderboard lb, public.badges b
where lb.portfolio_value >= 20000 and b.slug = 'portfolio-20k'
on conflict (user_id, badge_id) do nothing;

insert into public.user_badges (user_id, badge_id)
select lb.user_id, b.id
from public.leaderboard lb, public.badges b
where lb.portfolio_value >= 50000 and b.slug = 'portfolio-50k'
on conflict (user_id, badge_id) do nothing;

insert into public.user_badges (user_id, badge_id)
select lb.user_id, b.id
from public.leaderboard lb, public.badges b
where lb.portfolio_value >= 100000 and b.slug = 'portfolio-100k'
on conflict (user_id, badge_id) do nothing;

-- ten-hold-club: anyone currently holding 10+ distinct tickers.
insert into public.user_badges (user_id, badge_id)
select h.user_id, b.id
from (
  select user_id
  from public.holdings
  where qty > 0
  group by user_id
  having count(distinct ticker) >= 10
) h, public.badges b
where b.slug = 'ten-hold-club'
on conflict (user_id, badge_id) do nothing;

-- email-subscriber: every opted-in row.
insert into public.user_badges (user_id, badge_id)
select es.user_id, b.id
from public.email_subscriptions es, public.badges b
where es.weekly_newsletter = true and b.slug = 'email-subscriber'
on conflict (user_id, badge_id) do nothing;

-- public-lineup: every leaderboard row with show_lineup = true.
insert into public.user_badges (user_id, badge_id)
select lb.user_id, b.id
from public.leaderboard lb, public.badges b
where lb.show_lineup = true and b.slug = 'public-lineup'
on conflict (user_id, badge_id) do nothing;
