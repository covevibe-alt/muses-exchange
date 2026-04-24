-- ════════════════════════════════════════════════════════════════════════════
-- Migration 014 — Monthly genre cups (baselines + close/open cron)
-- ════════════════════════════════════════════════════════════════════════════
-- Turns the lifetime-P&L Genre Cup filter from migration 012 into a
-- monthly competition. At month start, the cron takes a snapshot of every
-- user's current per-genre return-% as their baseline for that month.
-- At the next month start, it closes the previous month's cups —
-- computes the delta from baseline for each (user, genre), ranks them,
-- awards the matching <genre>-cup-winner badge to rank 1, and opens the
-- next month.
--
-- Key tables:
--   public.genre_cup_participations
--     one row per (month_start, user_id, genre)
--     - baseline_return_pct: user's genre_return at month start
--     - final_return_pct:    genre_return at month end
--     - month_delta_pct:     final − baseline (the cup score)
--     - final_rank:          rank within that genre for that month
--
-- Scheduled: 1st of every month at 00:10 UTC (after daily season rollover).
--
-- APPLIED VIA SUPABASE MCP on 2026-04-24. Retroactive open_genre_cups()
-- call at bottom seeded current-month baselines for existing holders.
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.genre_cup_participations (
  id                   serial primary key,
  month_start          date not null,
  user_id              uuid not null references auth.users(id) on delete cascade,
  genre                text not null,
  baseline_return_pct  numeric not null,
  final_return_pct     numeric,
  month_delta_pct      numeric,
  final_rank           int,
  joined_at            timestamptz default now(),
  closed_at            timestamptz,
  unique (month_start, user_id, genre)
);

create index if not exists genre_cup_part_ranking_idx
  on public.genre_cup_participations (month_start, genre, month_delta_pct desc nulls last);

create index if not exists genre_cup_part_user_idx
  on public.genre_cup_participations (user_id, month_start desc);

alter table public.genre_cup_participations enable row level security;

drop policy if exists "genre_cup_part_select_own" on public.genre_cup_participations;
create policy "genre_cup_part_select_own"
  on public.genre_cup_participations for select
  to authenticated using (auth.uid() = user_id);

create or replace function public.close_genre_cups(p_month_start date)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_closed int := 0;
  v_genre  text;
  v_winner record;
begin
  for v_genre in
    select distinct genre
    from genre_cup_participations
    where month_start = p_month_start and final_rank is null
  loop
    with computed as (
      select
        gcp.id,
        gcp.user_id,
        gcp.baseline_return_pct,
        coalesce((lb.genre_returns ->> v_genre)::numeric, gcp.baseline_return_pct) as final_ret,
        coalesce((lb.genre_returns ->> v_genre)::numeric, gcp.baseline_return_pct) - gcp.baseline_return_pct as delta
      from genre_cup_participations gcp
      left join leaderboard lb on lb.user_id = gcp.user_id
      where gcp.month_start = p_month_start
        and gcp.genre = v_genre
        and gcp.final_rank is null
    ),
    ranked as (
      select id, user_id, final_ret, delta,
             rank() over (order by delta desc nulls last) as r
      from computed
    )
    update genre_cup_participations gcp
    set final_return_pct = ranked.final_ret,
        month_delta_pct  = ranked.delta,
        final_rank       = ranked.r,
        closed_at        = now()
    from ranked
    where gcp.id = ranked.id;

    for v_winner in
      select gcp.user_id, gcp.genre, gcp.month_delta_pct
      from genre_cup_participations gcp
      where gcp.month_start = p_month_start
        and gcp.genre = v_genre
        and gcp.final_rank = 1
    loop
      perform public.award_badge(
        v_winner.user_id,
        regexp_replace(lower(v_winner.genre), '[^a-z0-9]', '', 'g') || '-cup-winner',
        jsonb_build_object(
          'genre',        v_winner.genre,
          'month_start',  p_month_start::text,
          'delta_pct',    v_winner.month_delta_pct
        )
      );
    end loop;

    v_closed := v_closed + 1;
  end loop;

  return v_closed;
end;
$$;

revoke all    on function public.close_genre_cups(date) from public;
grant execute on function public.close_genre_cups(date) to service_role;

create or replace function public.open_genre_cups(p_month_start date)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_opened int;
begin
  with src as (
    select
      lb.user_id,
      kv.key   as genre,
      (kv.value #>> '{}')::numeric as baseline
    from leaderboard lb
    cross join lateral jsonb_each(lb.genre_returns) as kv(key, value)
    where lb.genre_returns is not null and lb.genre_returns <> '{}'::jsonb
  )
  insert into genre_cup_participations (month_start, user_id, genre, baseline_return_pct)
  select p_month_start, user_id, genre, baseline
  from src
  on conflict (month_start, user_id, genre) do nothing;
  get diagnostics v_opened = row_count;
  return v_opened;
end;
$$;

revoke all    on function public.open_genre_cups(date) from public;
grant execute on function public.open_genre_cups(date) to service_role;

create or replace function public.monthly_genre_cup_rollover()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_today      date := current_date;
  v_this_mon   date := date_trunc('month', v_today)::date;
  v_last_mon   date := (date_trunc('month', v_today) - interval '1 month')::date;
  v_closed     int;
  v_opened     int;
begin
  v_closed := public.close_genre_cups(v_last_mon);
  v_opened := public.open_genre_cups(v_this_mon);
  return jsonb_build_object(
    'closed_last_month', v_closed,
    'opened_this_month', v_opened,
    'last_month',        v_last_mon,
    'this_month',        v_this_mon
  );
end;
$$;

revoke all    on function public.monthly_genre_cup_rollover() from public;
grant execute on function public.monthly_genre_cup_rollover() to service_role;

select cron.schedule(
  'monthly-genre-cup-rollover',
  '10 0 1 * *',
  $inner$select public.monthly_genre_cup_rollover();$inner$
);

-- Seed: open April 2026 cups retroactively for current holders.
select public.open_genre_cups(date_trunc('month', current_date)::date);
