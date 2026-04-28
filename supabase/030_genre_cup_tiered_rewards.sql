-- ════════════════════════════════════════════════════════════════════════════
-- Migration 030 — Tiered genre-cup rewards (badges + tournament credits)
-- ════════════════════════════════════════════════════════════════════════════
-- Old behavior: close_genre_cups() awarded the champion badge to rank 1
-- only. Top-10 placers got nothing.
--
-- New behavior:
--   #1     → existing [genre]-cup-winner badge + $10k tournament credits
--   #2-3   → cup-podium badge + $3k tournament credits
--   #4-10  → cup-top-10 badge + $1k tournament credits
--
-- Champion badges are per-genre (already in catalog from migration 013).
-- Podium and top-10 are GENERIC — earnable once across any genre/month.
-- Tournament credits stack across cups, so a player who placed top-10 in
-- multiple genres gets paid for each.
--
-- APPLIED VIA SUPABASE MCP on 2026-04-28.
-- ════════════════════════════════════════════════════════════════════════════

insert into public.badges (slug, name, description, rarity, icon) values
  ('cup-podium',  'Cup Podium',  'Finished top 3 in a monthly genre cup.',  'rare',     'cat:cup'),
  ('cup-top-10',  'Cup Finalist','Finished top 10 in a monthly genre cup.', 'uncommon', 'cat:cup')
on conflict (slug) do nothing;

create or replace function public.close_genre_cups(p_month_start date)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_closed int := 0;
  v_genre  text;
  v_row    record;
  v_credit numeric;
  v_badge_slug text;
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

    for v_row in
      select gcp.user_id, gcp.genre, gcp.final_rank, gcp.month_delta_pct
      from genre_cup_participations gcp
      where gcp.month_start = p_month_start
        and gcp.genre = v_genre
        and gcp.final_rank between 1 and 10
      order by gcp.final_rank asc
    loop
      if v_row.final_rank = 1 then
        v_credit := 10000;
        v_badge_slug := regexp_replace(lower(v_row.genre), '[^a-z0-9]', '', 'g') || '-cup-winner';
      elsif v_row.final_rank between 2 and 3 then
        v_credit := 3000;
        v_badge_slug := 'cup-podium';
      else
        v_credit := 1000;
        v_badge_slug := 'cup-top-10';
      end if;

      perform public.award_badge(
        v_row.user_id,
        v_badge_slug,
        jsonb_build_object(
          'genre',        v_row.genre,
          'month_start',  p_month_start::text,
          'final_rank',   v_row.final_rank,
          'delta_pct',    v_row.month_delta_pct
        )
      );

      update portfolios
      set tournament_credits = tournament_credits + v_credit,
          snapshot = case
            when snapshot is null then jsonb_build_object('tournamentCredits', tournament_credits + v_credit)
            else jsonb_set(snapshot, '{tournamentCredits}', to_jsonb(tournament_credits + v_credit))
          end,
          updated_at = now()
      where user_id = v_row.user_id;
    end loop;

    v_closed := v_closed + 1;
  end loop;

  return v_closed;
end;
$$;
