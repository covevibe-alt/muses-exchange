-- ════════════════════════════════════════════════════════════════════════════
-- Migration 022 — Prediction streak rewards: multiplier + bonuses (Chunk E.1)
-- ════════════════════════════════════════════════════════════════════════════
-- New tables:
--   • prediction_streaks    — per-user current/longest streak + win/loss counts
--   • prediction_bonuses    — audit log for $500 / $2k / $10k threshold bonuses
--
-- New columns:
--   • prediction_bets.streak_multiplier (numeric default 1.0)
--   • prediction_bets.bonus_amount      (numeric default 0)
--
-- Updated functions:
--   • resolve_prediction_market — applies streak multiplier
--     (1.0 + 0.1×streak, capped at 2×) on each winning bet's payout.
--     A "user wins this market" iff at least one of their bets was on the
--     winning side. Wins → streak++, losses → streak=0. Hitting streak
--     threshold 3/5/10 awards a flat house bonus on top.
--
-- New helpers:
--   • ensure_prediction_streak(user_id) — upsert helper
--   • _apply_streak_win(user_id, market_id) — internal
--   • _apply_streak_loss(user_id, market_id) — internal
--
-- New RPCs:
--   • get_prediction_leaderboard(limit) — anon-callable, top callers by net P&L
--   • award_sharpest_caller() — service-role; called from cron monthly
--
-- Multiplier bonus + threshold bonus are paid from "house" (paper credits) —
-- they don't shrink other winners' parimutuel shares. Base parimutuel math
-- (winners share total_pool proportional to their stake on the winning side)
-- is preserved exactly as before.
--
-- APPLIED VIA SUPABASE MCP on 2026-04-27.
-- ════════════════════════════════════════════════════════════════════════════

-- ── Tables ──────────────────────────────────────────────────────────────────

create table if not exists public.prediction_streaks (
  user_id              uuid primary key references auth.users(id) on delete cascade,
  current_streak       int  not null default 0,
  longest_streak       int  not null default 0,
  total_wins           int  not null default 0,
  total_losses         int  not null default 0,
  last_resolved_market_id int references public.prediction_markets(id) on delete set null,
  last_resolved_at     timestamptz,
  updated_at           timestamptz not null default now()
);

alter table public.prediction_streaks enable row level security;

drop policy if exists "streaks_select_auth" on public.prediction_streaks;
create policy "streaks_select_auth" on public.prediction_streaks
  for select to authenticated using (true);

create table if not exists public.prediction_bonuses (
  id          bigserial primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  market_id   int  references public.prediction_markets(id) on delete set null,
  threshold   int  not null,                  -- 3, 5, or 10
  amount      numeric not null,
  awarded_at  timestamptz not null default now()
);

create index if not exists prediction_bonuses_user_idx
  on public.prediction_bonuses (user_id, awarded_at desc);

alter table public.prediction_bonuses enable row level security;

drop policy if exists "bonuses_select_own" on public.prediction_bonuses;
create policy "bonuses_select_own" on public.prediction_bonuses
  for select to authenticated using (auth.uid() = user_id);

-- ── Bets columns ────────────────────────────────────────────────────────────

alter table public.prediction_bets
  add column if not exists streak_multiplier numeric not null default 1.0;
alter table public.prediction_bets
  add column if not exists bonus_amount      numeric not null default 0;

-- ── Helpers ─────────────────────────────────────────────────────────────────

create or replace function public.ensure_prediction_streak(p_user_id uuid)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  insert into prediction_streaks (user_id) values (p_user_id)
  on conflict (user_id) do nothing;
$$;

create or replace function public._apply_streak_win(
  p_user_id uuid, p_market_id int
) returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_new_streak  int;
  v_bonus       numeric;
  v_badge_slug  text;
  v_badge_id    int;
begin
  perform public.ensure_prediction_streak(p_user_id);

  update prediction_streaks
  set current_streak  = current_streak + 1,
      longest_streak  = greatest(longest_streak, current_streak + 1),
      total_wins      = total_wins + 1,
      last_resolved_market_id = p_market_id,
      last_resolved_at = now(),
      updated_at      = now()
  where user_id = p_user_id
  returning current_streak into v_new_streak;

  if v_new_streak = 3 then
    v_bonus := 500;  v_badge_slug := 'prediction-streak-3';
  elsif v_new_streak = 5 then
    v_bonus := 2000; v_badge_slug := 'prediction-streak-5';
  elsif v_new_streak = 10 then
    v_bonus := 10000; v_badge_slug := 'prediction-streak-10';
  end if;

  if v_bonus is not null then
    update prediction_balances
    set balance = balance + v_bonus, updated_at = now()
    where user_id = p_user_id;

    insert into prediction_bonuses (user_id, market_id, threshold, amount)
    values (p_user_id, p_market_id, v_new_streak, v_bonus);

    select id into v_badge_id from badges where slug = v_badge_slug;
    if v_badge_id is not null then
      insert into user_badges (user_id, badge_id)
      values (p_user_id, v_badge_id)
      on conflict (user_id, badge_id) do nothing;
    end if;
  end if;

  return v_new_streak;
end;
$$;

create or replace function public._apply_streak_loss(
  p_user_id uuid, p_market_id int
) returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  insert into prediction_streaks (user_id, current_streak, total_losses,
                                  last_resolved_market_id, last_resolved_at)
  values (p_user_id, 0, 1, p_market_id, now())
  on conflict (user_id) do update set
    current_streak    = 0,
    total_losses      = prediction_streaks.total_losses + 1,
    last_resolved_market_id = excluded.last_resolved_market_id,
    last_resolved_at  = excluded.last_resolved_at,
    updated_at        = now();
$$;

-- ── Replace resolve_prediction_market ───────────────────────────────────────

create or replace function public.resolve_prediction_market(
  p_market_id int, p_outcome text
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
  v_base          numeric;
  v_multiplier    numeric;
  v_streak        int;
  v_paid_out      numeric := 0;
  v_winners       int := 0;
  v_user_rec      record;
  v_bonus_total   numeric := 0;
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
    return jsonb_build_object('ok', true, 'refunded', v_paid_out, 'note', 'canceled');
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

  -- Pass 1: per-user streak update.
  for v_user_rec in
    select user_id, bool_or(side = p_outcome) as has_winner
    from prediction_bets where market_id = p_market_id
    group by user_id
  loop
    if v_user_rec.has_winner then
      v_streak := public._apply_streak_win(v_user_rec.user_id, p_market_id);
    else
      perform public._apply_streak_loss(v_user_rec.user_id, p_market_id);
    end if;
  end loop;

  -- Pass 2: pay out winning bets at base × multiplier.
  for v_bet in
    select pb.* from prediction_bets pb
    where pb.market_id = p_market_id and pb.side = p_outcome
  loop
    select greatest(current_streak - 1, 0) into v_streak
    from prediction_streaks where user_id = v_bet.user_id;
    v_multiplier := least(2.0, 1.0 + 0.1 * coalesce(v_streak, 0));

    v_base   := round((v_bet.amount / v_winning_pool) * v_total_pool, 2);
    v_payout := round(v_base * v_multiplier, 2);

    update prediction_balances
    set balance = balance + v_payout, updated_at = now()
    where user_id = v_bet.user_id;

    update prediction_bets
    set payout            = v_payout,
        streak_multiplier = v_multiplier,
        bonus_amount      = round(v_payout - v_base, 2)
    where id = v_bet.id;

    v_paid_out    := v_paid_out + v_payout;
    v_bonus_total := v_bonus_total + (v_payout - v_base);
    v_winners     := v_winners + 1;
  end loop;

  update prediction_bets
  set payout            = 0,
      streak_multiplier = 1.0,
      bonus_amount      = 0
  where market_id = p_market_id and side <> p_outcome;

  update prediction_markets
  set status = 'resolved', resolution = p_outcome, resolved_at = now()
  where id = p_market_id;

  return jsonb_build_object(
    'ok',           true,
    'outcome',      p_outcome,
    'winners',      v_winners,
    'paid_out',     v_paid_out,
    'multiplier_bonus', v_bonus_total,
    'total_pool',   v_total_pool
  );
end;
$$;

-- ── Public leaderboard RPC ──────────────────────────────────────────────────

create or replace function public.get_prediction_leaderboard(p_limit int default 50)
returns jsonb
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  with bet_stats as (
    select
      pb.user_id,
      count(*)                                  as total_resolved,
      count(*) filter (where pb.payout > 0)     as wins,
      count(*) filter (where pb.payout = 0)     as losses,
      sum(pb.amount)                            as total_staked,
      sum(pb.payout)                            as total_returned,
      sum(pb.payout - pb.amount)                as net_pnl
    from prediction_bets pb
    join prediction_markets pm on pm.id = pb.market_id
    where pm.status = 'resolved' and pm.resolution in ('yes','no')
    group by pb.user_id
  ),
  ranked as (
    select
      bs.*,
      coalesce(p.handle, 'trader')                  as handle,
      coalesce(p.display_name, p.handle, 'Trader')  as display_name,
      coalesce(ps.current_streak, 0)                as current_streak,
      coalesce(ps.longest_streak, 0)                as longest_streak,
      case when (bs.wins + bs.losses) > 0
           then round(bs.wins::numeric / (bs.wins + bs.losses) * 100, 1)
           else 0
      end as hit_rate
    from bet_stats bs
    left join profiles p              on p.user_id = bs.user_id
    left join prediction_streaks ps   on ps.user_id = bs.user_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'user_id',        user_id,
    'handle',         handle,
    'display_name',   display_name,
    'total_resolved', total_resolved,
    'wins',           wins,
    'losses',         losses,
    'total_staked',   total_staked,
    'total_returned', total_returned,
    'net_pnl',        net_pnl,
    'hit_rate',       hit_rate,
    'current_streak', current_streak,
    'longest_streak', longest_streak
  ) order by net_pnl desc nulls last, hit_rate desc), '[]'::jsonb)
  from (select * from ranked order by net_pnl desc, hit_rate desc limit p_limit) r;
$$;

grant execute on function public.get_prediction_leaderboard(int) to anon, authenticated;

comment on function public.get_prediction_leaderboard(int) is
  'Top callers ranked by net prediction-market P&L.';

-- ── Sharpest Caller monthly award ───────────────────────────────────────────

create or replace function public.award_sharpest_caller()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_month_start date := (date_trunc('month', current_date) - interval '1 month')::date;
  v_month_end   date := (date_trunc('month', current_date))::date;
  v_winner      uuid;
  v_hit_rate    numeric;
  v_total       int;
  v_badge_id    int;
begin
  with bet_stats as (
    select
      pb.user_id,
      count(*) as total,
      count(*) filter (where pb.payout > 0) as wins
    from prediction_bets pb
    join prediction_markets pm on pm.id = pb.market_id
    where pm.status = 'resolved' and pm.resolution in ('yes','no')
      and pm.resolved_at >= v_month_start::timestamptz
      and pm.resolved_at <  v_month_end::timestamptz
    group by pb.user_id
    having count(*) >= 5
  )
  select user_id, total, round(wins::numeric / total * 100, 1)
  into v_winner, v_total, v_hit_rate
  from bet_stats
  order by (wins::numeric / total) desc, total desc
  limit 1;

  if v_winner is null then
    return jsonb_build_object('ok', true, 'awarded', false, 'reason', 'no_eligible_caller');
  end if;

  select id into v_badge_id from badges where slug = 'sharpest-caller';
  if v_badge_id is null then
    return jsonb_build_object('ok', true, 'awarded', false, 'reason', 'badge_missing');
  end if;

  insert into user_badges (user_id, badge_id)
  values (v_winner, v_badge_id)
  on conflict (user_id, badge_id) do nothing;

  return jsonb_build_object(
    'ok',       true,
    'awarded',  true,
    'user_id',  v_winner,
    'hit_rate', v_hit_rate,
    'total',    v_total,
    'month',    v_month_start
  );
end;
$$;

revoke all on function public.award_sharpest_caller() from public;

-- ── Backfill streaks from existing resolved bets (idempotent) ──────────────

insert into public.prediction_streaks (user_id, total_wins, total_losses, current_streak)
select pb.user_id,
       count(*) filter (where pb.payout > 0),
       count(*) filter (where pb.payout = 0),
       0
from public.prediction_bets pb
join public.prediction_markets pm on pm.id = pb.market_id
where pm.status = 'resolved' and pm.resolution in ('yes','no')
group by pb.user_id
on conflict (user_id) do nothing;
