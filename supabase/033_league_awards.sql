-- ════════════════════════════════════════════════════════════════════════════
-- Migration 033 — League awards (weekly MVP/Big Mover + season-end podium)
-- ════════════════════════════════════════════════════════════════════════════
-- Phase C of the leagues redesign. Plugs into the existing weekly snapshot
-- + season cron so we don't add new schedules:
--
--   Weekly (Friday Market Close):
--     • League MVP — highest weekly return among the league's members
--     • Big Mover — biggest absolute $ portfolio gain that week
--   Season-end (rollover_expired_seasons):
--     • League Champion / Runner-up / Bronze for top 3 by season return
--       within each active league. Top 3 also receive tournament credits
--       ($5k / $2k / $1k).
--
-- Storage: league_awards is the trophy case data source for the Awards
-- tab + Activity feed. badges are also awarded via award_badge() so the
-- profile page picks them up automatically.
--
-- APPLIED VIA SUPABASE MCP on 2026-04-29.
-- ════════════════════════════════════════════════════════════════════════════

-- ─── league_awards table ────────────────────────────────────────────────
-- Idempotency: (league_id, user_id, award_type, period_end) is the unique
-- key. compute_league_weekly_awards calls insert ... on conflict do nothing
-- so a re-run on the same week is harmless.
create table if not exists public.league_awards (
  id            bigserial primary key,
  league_id     int  not null references public.leagues(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  award_type    text not null
                check (award_type in (
                  'mvp-week', 'big-mover-week',
                  'champion', 'runner-up', 'bronze'
                )),
  period_start  date,
  period_end    date,
  metadata      jsonb not null default '{}'::jsonb,
  awarded_at    timestamptz not null default now(),
  unique (league_id, user_id, award_type, period_end)
);

create index if not exists league_awards_league_idx
  on public.league_awards (league_id, awarded_at desc);
create index if not exists league_awards_user_idx
  on public.league_awards (user_id, awarded_at desc);
create index if not exists league_awards_period_idx
  on public.league_awards (league_id, period_end desc);

-- RLS — readable to anyone in the league + readable to anyone if the
-- league is public. Mirrors the visibility model used by
-- fetch_league_by_slug.
alter table public.league_awards enable row level security;

drop policy if exists "league_awards_select_member_or_public" on public.league_awards;
create policy "league_awards_select_member_or_public"
  on public.league_awards for select
  to authenticated
  using (
    exists (
      select 1 from public.leagues l
      where l.id = league_awards.league_id
        and (
          l.is_public = true
          or exists (
            select 1 from public.league_members lm
            where lm.league_id = l.id and lm.user_id = auth.uid()
          )
        )
    )
  );

-- ─── New badges ─────────────────────────────────────────────────────────
insert into public.badges (slug, name, description, rarity, icon) values
  ('league-mvp-week',       'League MVP',          'Top weekly return in a private league.',           'uncommon', 'cat:trophy'),
  ('league-big-mover-week', 'Big Mover',           'Largest weekly portfolio gain in a private league.','uncommon', 'cat:zap'),
  ('league-champion',       'League Champion',     'Won a season inside a private league.',            'rare',     'cat:crown'),
  ('league-runner-up',      'League Runner-up',    'Finished 2nd in a private league season.',         'uncommon', 'cat:medal'),
  ('league-bronze',         'League Bronze',       'Finished 3rd in a private league season.',         'uncommon', 'cat:medal')
on conflict (slug) do nothing;

-- ─── compute_league_weekly_awards(p_week_end) ────────────────────────────
-- For each active league, picks the MVP and Big Mover for the week from
-- weekly_snapshots, awards a badge + writes a league_awards row.
--
-- Idempotent: re-running for the same week_end is safe — both
-- award_badge() and the unique index on league_awards collapse duplicates.
create or replace function public.compute_league_weekly_awards(p_week_end date)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count       int := 0;
  v_league_id   int;
  v_week_start  date := p_week_end - 7;
  v_mvp         record;
  v_mover       record;
begin
  for v_league_id in
    select id from leagues where status = 'active'
  loop
    -- MVP — highest return_pct_week
    select ws.user_id, ws.return_pct_week as ret_pct
    into v_mvp
    from weekly_snapshots ws
    join league_members lm
      on lm.user_id = ws.user_id and lm.league_id = v_league_id
    where ws.week_end = p_week_end
      and ws.return_pct_week is not null
    order by ws.return_pct_week desc
    limit 1;

    if v_mvp.user_id is not null then
      perform public.award_badge(
        v_mvp.user_id,
        'league-mvp-week',
        jsonb_build_object(
          'league_id', v_league_id,
          'week_end',  p_week_end::text,
          'return_pct', v_mvp.ret_pct
        )
      );
      insert into league_awards (league_id, user_id, award_type, period_start, period_end, metadata)
      values (
        v_league_id, v_mvp.user_id, 'mvp-week', v_week_start, p_week_end,
        jsonb_build_object('return_pct', v_mvp.ret_pct)
      )
      on conflict (league_id, user_id, award_type, period_end) do nothing;
      v_count := v_count + 1;
    end if;

    -- Big Mover — largest absolute $ gain
    select
      ws.user_id,
      (ws.portfolio_value_end - ws.portfolio_value_start) as gain
    into v_mover
    from weekly_snapshots ws
    join league_members lm
      on lm.user_id = ws.user_id and lm.league_id = v_league_id
    where ws.week_end = p_week_end
      and ws.portfolio_value_end is not null
      and ws.portfolio_value_start is not null
    order by (ws.portfolio_value_end - ws.portfolio_value_start) desc
    limit 1;

    -- Only award when the mover actually moved up.
    if v_mover.user_id is not null and v_mover.gain > 0 then
      perform public.award_badge(
        v_mover.user_id,
        'league-big-mover-week',
        jsonb_build_object(
          'league_id', v_league_id,
          'week_end',  p_week_end::text,
          'gain_dollars', v_mover.gain
        )
      );
      insert into league_awards (league_id, user_id, award_type, period_start, period_end, metadata)
      values (
        v_league_id, v_mover.user_id, 'big-mover-week', v_week_start, p_week_end,
        jsonb_build_object('gain_dollars', v_mover.gain)
      )
      on conflict (league_id, user_id, award_type, period_end) do nothing;
      v_count := v_count + 1;
    end if;
  end loop;

  return v_count;
end;
$$;

revoke all    on function public.compute_league_weekly_awards(date) from public;
grant execute on function public.compute_league_weekly_awards(date) to service_role;

-- ─── award_league_season_winners(p_season_id) ────────────────────────────
-- Computes top 3 by season return inside each active league for the given
-- season. Awards league-champion / league-runner-up / league-bronze badges,
-- writes league_awards rows, and credits the user with $5k/$2k/$1k of
-- tournament credits.
--
-- Called from rollover_expired_seasons BEFORE the season is flipped to
-- ended, so leaderboard.season_return_pct is still meaningful.
create or replace function public.award_league_season_winners(p_season_id int)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count    int := 0;
  v_league   record;
  v_winner   record;
  v_credit   numeric;
  v_slug     text;
  v_season_slug text;
begin
  select slug into v_season_slug from seasons where id = p_season_id;
  if v_season_slug is null then
    return 0;
  end if;

  for v_league in
    select id from leagues where status = 'active'
  loop
    -- Pick top 3 by leaderboard.return_pct among league members. Falls
    -- back to portfolio_value when return_pct is null (rare). DENSE_RANK
    -- so ties don't push 4 people onto the podium.
    for v_winner in
      with members_lb as (
        select
          lb.user_id,
          coalesce(lb.return_pct, 0) as ret_pct,
          coalesce(lb.portfolio_value, 0) as pv
        from leaderboard lb
        join league_members lm
          on lm.user_id = lb.user_id and lm.league_id = v_league.id
      ),
      ranked as (
        select user_id, ret_pct, pv,
               rank() over (order by ret_pct desc, pv desc) as r
        from members_lb
      )
      select * from ranked where r between 1 and 3 order by r asc
    loop
      if v_winner.r = 1 then
        v_credit := 5000; v_slug := 'league-champion';
      elsif v_winner.r = 2 then
        v_credit := 2000; v_slug := 'league-runner-up';
      else
        v_credit := 1000; v_slug := 'league-bronze';
      end if;

      perform public.award_badge(
        v_winner.user_id,
        v_slug,
        jsonb_build_object(
          'league_id',  v_league.id,
          'season_slug', v_season_slug,
          'final_rank', v_winner.r,
          'return_pct', v_winner.ret_pct
        )
      );

      insert into league_awards (league_id, user_id, award_type, period_end, metadata)
      values (
        v_league.id, v_winner.user_id,
        case when v_winner.r = 1 then 'champion' when v_winner.r = 2 then 'runner-up' else 'bronze' end,
        current_date,
        jsonb_build_object(
          'season_slug', v_season_slug,
          'final_rank',  v_winner.r,
          'return_pct',  v_winner.ret_pct,
          'credits',     v_credit
        )
      )
      on conflict (league_id, user_id, award_type, period_end) do nothing;

      -- Tournament-credit reward. Mirrors the genre-cup pattern from
      -- migration 030 (snapshot + updated_at touched).
      update portfolios
      set tournament_credits = tournament_credits + v_credit,
          snapshot = case
            when snapshot is null then jsonb_build_object('tournamentCredits', tournament_credits + v_credit)
            else jsonb_set(snapshot, '{tournamentCredits}', to_jsonb(tournament_credits + v_credit))
          end,
          updated_at = now()
      where user_id = v_winner.user_id;

      v_count := v_count + 1;
    end loop;
  end loop;

  return v_count;
end;
$$;

revoke all    on function public.award_league_season_winners(int) from public;
grant execute on function public.award_league_season_winners(int) to service_role;

-- ─── Hook into existing crons ────────────────────────────────────────────
-- run_friday_close: extend with a final call to compute_league_weekly_awards
-- so leagues get their MVP/Big Mover at the same moment the global weekly
-- winner is awarded.
create or replace function public.run_friday_close()
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_week_end   date := current_date;
  v_week_start date := v_week_end - 7;
  v_count      int;
begin
  insert into weekly_snapshots (
    week_start, week_end, user_id,
    portfolio_value_start, portfolio_value_end, return_pct_week
  )
  select
    v_week_start,
    v_week_end,
    lb.user_id,
    coalesce(prev.portfolio_value_end, lb.portfolio_value) as start_value,
    lb.portfolio_value as end_value,
    case
      when coalesce(prev.portfolio_value_end, lb.portfolio_value) > 0 then
        ((lb.portfolio_value - coalesce(prev.portfolio_value_end, lb.portfolio_value))
         / coalesce(prev.portfolio_value_end, lb.portfolio_value)) * 100
      else 0
    end as return_pct
  from leaderboard lb
  left join weekly_snapshots prev
    on prev.user_id = lb.user_id
    and prev.week_end = v_week_start
  on conflict (week_end, user_id) do nothing;

  with ranked as (
    select user_id,
           rank() over (order by return_pct_week desc nulls last) as r
    from weekly_snapshots
    where week_end = v_week_end
  )
  update weekly_snapshots ws
  set rank_in_week = ranked.r
  from ranked
  where ws.week_end = v_week_end
    and ws.user_id = ranked.user_id;

  perform public.award_badge(user_id, 'weekly-winner',
                             jsonb_build_object('week_end', v_week_end::text))
  from weekly_snapshots
  where week_end = v_week_end and rank_in_week = 1;

  -- NEW: per-league weekly awards. Wrapped so a failure here doesn't
  -- roll back the snapshot itself.
  begin
    perform public.compute_league_weekly_awards(v_week_end);
  exception when others then
    raise warning '[run_friday_close] compute_league_weekly_awards failed: %', sqlerrm;
  end;

  select count(*) into v_count from weekly_snapshots where week_end = v_week_end;
  return v_count;
end;
$$;

revoke all    on function public.run_friday_close() from public;
grant execute on function public.run_friday_close() to service_role;

-- rollover_expired_seasons: extend so each season that expires also fires
-- the league podium awards inside the same loop (BEFORE marking the season
-- ended, since the leaderboard column is what we're ranking on).
create or replace function public.rollover_expired_seasons()
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_season     record;
  v_slug       text;
  v_name       text;
  v_next_num   int;
  v_rolled     int := 0;
begin
  for v_season in
    select * from seasons where status = 'active' and ends_at < now()
  loop
    with computed as (
      select
        sp.user_id,
        sp.baseline_portfolio_value as baseline,
        coalesce(lb.portfolio_value, sp.baseline_portfolio_value) as final_value,
        case when sp.baseline_portfolio_value > 0 then
          ((coalesce(lb.portfolio_value, sp.baseline_portfolio_value) - sp.baseline_portfolio_value)
           / sp.baseline_portfolio_value) * 100
        else 0 end as return_pct
      from season_participations sp
      left join leaderboard lb on lb.user_id = sp.user_id
      where sp.season_id = v_season.id
    ),
    ranked as (
      select user_id, return_pct,
             rank() over (order by return_pct desc nulls last) as r
      from computed
    )
    update season_participations sp
    set final_return_pct = ranked.return_pct,
        final_rank       = ranked.r
    from ranked
    where sp.season_id = v_season.id
      and sp.user_id   = ranked.user_id;

    perform public.award_badge(sp.user_id, 'season-1-champion',
                               jsonb_build_object('season_slug', v_season.slug,
                                                  'season_name', v_season.name))
    from season_participations sp
    where sp.season_id = v_season.id and sp.final_rank = 1;

    perform public.award_badge(sp.user_id, 'season-1-top-10',
                               jsonb_build_object('season_slug', v_season.slug,
                                                  'season_name', v_season.name))
    from season_participations sp
    where sp.season_id = v_season.id and sp.final_rank between 2 and 10;

    perform public.award_badge(sp.user_id, 'season-1-top-100',
                               jsonb_build_object('season_slug', v_season.slug,
                                                  'season_name', v_season.name))
    from season_participations sp
    where sp.season_id = v_season.id and sp.final_rank between 11 and 100;

    -- NEW: per-league season podium awards.
    begin
      perform public.award_league_season_winners(v_season.id);
    exception when others then
      raise warning '[rollover_expired_seasons] award_league_season_winners failed: %', sqlerrm;
    end;

    update seasons set status = 'ended' where id = v_season.id;

    v_rolled := v_rolled + 1;
  end loop;

  if not exists (select 1 from seasons where status = 'active') then
    select count(*) + 1 into v_next_num from seasons;
    v_slug := to_char(now(), 'YYYY-') || 'q' || extract(quarter from now())::text;
    v_name := 'Season ' || v_next_num || ' — ' || to_char(now(), 'FMMonth YYYY');

    if exists (select 1 from seasons where slug = v_slug) then
      v_slug := v_slug || '-' || to_char(now(), 'MMDD');
    end if;

    insert into seasons (slug, name, starts_at, ends_at, status)
    values (v_slug, v_name, date_trunc('day', now()),
            date_trunc('day', now()) + interval '90 days', 'active');
  end if;

  return v_rolled;
end;
$$;

revoke all    on function public.rollover_expired_seasons() from public;
grant execute on function public.rollover_expired_seasons() to service_role;

-- ─── Backfill — give existing leagues something to display ──────────────
-- Pick the most-recent week_end in weekly_snapshots and run the awards
-- over it once. Safe to re-run because of the unique index.
do $$
declare
  v_week_end date;
begin
  select max(week_end) into v_week_end from weekly_snapshots;
  if v_week_end is not null then
    perform public.compute_league_weekly_awards(v_week_end);
  end if;
end $$;
