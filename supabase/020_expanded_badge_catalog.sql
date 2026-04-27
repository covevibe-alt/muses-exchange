-- ════════════════════════════════════════════════════════════════════════════
-- Migration 020 — Expanded badge catalog (Chunk C)
-- ════════════════════════════════════════════════════════════════════════════
-- Triples the badge catalog so the new Achievements page on the portfolio
-- view has enough variety to make collecting them feel like a long-term
-- pursuit. Badges fall into seven categories:
--
--   • Trading milestones — Trader 100/500/1000
--   • Profit milestones — Realized P&L thresholds
--   • Loss survivor — Bounced-back variant of diamond-hands
--   • Discovery — Genre breadth + roster breadth
--   • Loyalty — Trading streaks
--   • Predictions — Tied to win counts + streak rewards (the win-streak
--     bonus mechanic itself is implemented in Chunk E)
--   • Social — League founder, large league, referrer
--   • Anniversary — Original launch user, one-year trader
--
-- Each badge has a "category" stashed in the icon column so the client
-- can group them visually in the Achievements modal. Format: "cat:trade",
-- "cat:profit", "cat:loss", "cat:discovery", "cat:loyalty", "cat:predict",
-- "cat:social", "cat:anniversary".
--
-- APPLIED VIA SUPABASE MCP on 2026-04-27.
-- Total catalog: 52 badges across 13 categories.
-- ════════════════════════════════════════════════════════════════════════════

insert into public.badges (slug, name, description, rarity, icon) values
  -- Trading milestones
  ('trader-100',          'Trader 100',           'Placed 100 trades.',                                'uncommon',  'cat:trade'),
  ('trader-500',          'Trader 500',           'Placed 500 trades.',                                'rare',      'cat:trade'),
  ('trader-marathon',     'Trade Marathon',       'Placed 1,000+ trades.',                             'legendary', 'cat:trade'),

  -- Profit milestones (realized cumulative P&L from sells)
  ('realized-1k',         'First Realized $1k',   'Locked in $1,000+ in realized gains.',              'uncommon',  'cat:profit'),
  ('realized-10k',        'Realized $10k',        'Locked in $10,000+ in realized gains.',             'rare',      'cat:profit'),
  ('realized-50k',        'Realized $50k',        'Locked in $50,000+ in realized gains.',             'legendary', 'cat:profit'),
  ('paper-millionaire',   'Paper Millionaire',    'Portfolio value crossed $1,000,000.',               'legendary', 'cat:profit'),

  -- Loss survivor
  ('bounced-back',        'Bounced Back',         'Recovered to break-even after a 30%+ drawdown.',    'rare',      'cat:loss'),

  -- Discovery — breadth-of-roster
  ('genre-explorer',      'Genre Explorer',       'Held artists from 5+ different genres at once.',    'uncommon',  'cat:discovery'),
  ('genre-completionist', 'Genre Completionist',  'Held an artist from every genre simultaneously.',   'rare',      'cat:discovery'),
  ('discoverer-25',       'Discoverer',           'Owned shares in 25+ different artists over time.',  'uncommon',  'cat:discovery'),

  -- Loyalty — trading streaks
  ('streak-7',            '7-Day Streak',         'Traded on 7 consecutive days.',                     'uncommon',  'cat:loyalty'),
  ('streak-30',           '30-Day Streak',        'Traded on 30 consecutive days.',                    'rare',      'cat:loyalty'),

  -- Predictions — wins + streaks (rewards mechanic ships in Chunk E)
  ('prediction-winner-5',  '5 Right Calls',       'Won 5 prediction markets.',                         'uncommon',  'cat:predict'),
  ('prediction-winner-25', '25 Right Calls',      'Won 25 prediction markets.',                        'rare',      'cat:predict'),
  ('prediction-streak-3',  '3-Win Streak',        'Won 3 prediction markets in a row.',                'uncommon',  'cat:predict'),
  ('prediction-streak-5',  '5-Win Streak',        'Won 5 prediction markets in a row.',                'rare',      'cat:predict'),
  ('prediction-streak-10', '10-Win Streak',       'Won 10 prediction markets in a row.',               'legendary', 'cat:predict'),
  ('sharpest-caller',      'Sharpest Caller',     'Highest prediction hit-rate of the month (≥5).',    'rare',      'cat:predict'),

  -- Social
  ('league-founder',      'League Founder',       'Created a private league.',                         'uncommon',  'cat:social'),
  ('league-grandmaster',  'League Grandmaster',   'Owner of a league with 10+ members.',               'rare',      'cat:social'),
  ('referrer',            'Talent Scout',         'Referred a friend who made their first trade.',     'rare',      'cat:social'),

  -- Anniversary
  ('muses-original',      'Muses Original',       'Joined Muses Exchange in its launch month.',        'rare',      'cat:anniversary'),
  ('one-year-trader',     'One-Year Trader',      'Active trader for 12+ months.',                     'legendary', 'cat:anniversary')
on conflict (slug) do nothing;

-- ──────────────────────────────────────────────────────────────────────
-- Backfill the icons / categories on the existing seeded badges.
-- ──────────────────────────────────────────────────────────────────────
update public.badges set icon = coalesce(icon, 'cat:season')   where slug in (
  'season-1-champion','season-1-top-10','season-1-top-100','muse-veteran'
);
update public.badges set icon = coalesce(icon, 'cat:matchup')  where slug = 'weekly-winner';
update public.badges set icon = coalesce(icon, 'cat:trade')    where slug in ('first-trade','ten-hold-club');
update public.badges set icon = coalesce(icon, 'cat:profit')   where slug in (
  'portfolio-20k','portfolio-50k','portfolio-100k','sold-the-top'
);
update public.badges set icon = coalesce(icon, 'cat:loss')     where slug = 'diamond-hands';
update public.badges set icon = coalesce(icon, 'cat:social')   where slug in ('public-lineup','email-subscriber');
update public.badges set icon = coalesce(icon, 'cat:anniversary') where slug = 'early-adopter';
update public.badges set icon = coalesce(icon, 'cat:matchup')  where slug = 'five-match-streak';
update public.badges set icon = coalesce(icon, 'cat:cup')      where slug like '%-cup-winner';
update public.badges set icon = coalesce(icon, 'cat:ipo')      where slug in ('ipo-early-backer','first-buyer-of-artist');
update public.badges set icon = coalesce(icon, 'cat:thesis')   where slug = 'thesis-winner';

-- ──────────────────────────────────────────────────────────────────────
-- Retroactive backfill for new badges detectable from existing data
-- ──────────────────────────────────────────────────────────────────────

insert into public.user_badges (user_id, badge_id)
select distinct l.owner_id, b.id
from public.leagues l, public.badges b
where l.status = 'active' and b.slug = 'league-founder'
on conflict (user_id, badge_id) do nothing;

insert into public.user_badges (user_id, badge_id)
select distinct l.owner_id, b.id
from public.leagues l, public.badges b
where b.slug = 'league-grandmaster'
  and l.status = 'active'
  and (select count(*) from public.league_members lm where lm.league_id = l.id) >= 10
on conflict (user_id, badge_id) do nothing;

insert into public.user_badges (user_id, badge_id)
select fo.user_id, b.id
from (select user_id from public.filled_orders group by user_id having count(*) >= 100) fo, public.badges b
where b.slug = 'trader-100'
on conflict (user_id, badge_id) do nothing;

insert into public.user_badges (user_id, badge_id)
select fo.user_id, b.id
from (select user_id from public.filled_orders group by user_id having count(*) >= 500) fo, public.badges b
where b.slug = 'trader-500'
on conflict (user_id, badge_id) do nothing;

insert into public.user_badges (user_id, badge_id)
select fo.user_id, b.id
from (select user_id from public.filled_orders group by user_id having count(*) >= 1000) fo, public.badges b
where b.slug = 'trader-marathon'
on conflict (user_id, badge_id) do nothing;

insert into public.user_badges (user_id, badge_id)
select fo.user_id, b.id
from (
  select user_id from public.filled_orders
  where side = 'buy'
  group by user_id
  having count(distinct ticker) >= 25
) fo, public.badges b
where b.slug = 'discoverer-25'
on conflict (user_id, badge_id) do nothing;

insert into public.user_badges (user_id, badge_id)
select u.id, b.id
from auth.users u, public.badges b
where b.slug = 'muses-original'
  and u.created_at >= '2026-04-01'
  and u.created_at <  '2026-05-01'
on conflict (user_id, badge_id) do nothing;
