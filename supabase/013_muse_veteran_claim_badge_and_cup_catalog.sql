-- ════════════════════════════════════════════════════════════════════════════
-- Migration 013 — Muse-veteran rollover wiring + claim_badge RPC +
--                 genre-cup-winner badge catalog
-- ════════════════════════════════════════════════════════════════════════════
-- Three gaps from Phase 0–2 audit closed here:
--
--   1. muse-veteran: rewires rollover_expired_seasons() to award the
--      'muse-veteran' badge to any user who finished a season with
--      final_return_pct > 0. Was seeded in the catalog but had no
--      emitter — nobody would ever earn it.
--
--   2. claim_badge(slug, metadata) — a restricted security-definer RPC
--      that authenticated users can call to claim specific behavioral
--      badges that are detected client-side (diamond-hands, sold-the-top).
--      The allowlist is hard-coded so this RPC cannot be used to forge
--      season-champion / top-10 / top-100 badges. For unlisted slugs the
--      call no-ops and returns false.
--
--   3. Genre cup badges: one per genre (pop/hiphop/rnb/indie/latin/alt/
--      afropop/kpop/electronic). The monthly genre cup cron in the next
--      migration awards these on cup close.
--
-- APPLIED VIA SUPABASE MCP on 2026-04-24.
-- ════════════════════════════════════════════════════════════════════════════

-- ──────────────────────────────────────────────────────────────────────
-- 1. Rewire rollover_expired_seasons to emit muse-veteran
-- ──────────────────────────────────────────────────────────────────────
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

    -- Migration 013 addition — muse-veteran for everyone with positive
    -- final return, regardless of rank. This one rewards seeing it
    -- through, not winning.
    perform public.award_badge(sp.user_id, 'muse-veteran',
                               jsonb_build_object('season_slug', v_season.slug,
                                                  'season_name', v_season.name,
                                                  'final_return_pct', sp.final_return_pct))
    from season_participations sp
    where sp.season_id = v_season.id
      and sp.final_return_pct is not null
      and sp.final_return_pct > 0;

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

-- ──────────────────────────────────────────────────────────────────────
-- 2. claim_badge(slug, metadata) — user-callable RPC with allowlist
-- ──────────────────────────────────────────────────────────────────────
create or replace function public.claim_badge(
  p_badge_slug text,
  p_metadata   jsonb default '{}'::jsonb
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_allowed text[] := array[
    'diamond-hands',
    'sold-the-top'
  ];
begin
  if v_user_id is null then return false; end if;
  if not (p_badge_slug = any (v_allowed)) then return false; end if;
  return public.award_badge(v_user_id, p_badge_slug, p_metadata);
end;
$$;

revoke all    on function public.claim_badge(text, jsonb) from public;
grant execute on function public.claim_badge(text, jsonb) to authenticated;

-- ──────────────────────────────────────────────────────────────────────
-- 3. Genre-cup-winner badge catalog (one per genre)
-- ──────────────────────────────────────────────────────────────────────
insert into public.badges (slug, name, description, rarity) values
  ('pop-cup-winner',         'Pop Cup Winner',         'Won a monthly Pop genre cup.',         'rare'),
  ('hiphop-cup-winner',      'Hip-Hop Cup Winner',     'Won a monthly Hip-Hop genre cup.',     'rare'),
  ('rnb-cup-winner',         'R&B Cup Winner',         'Won a monthly R&B genre cup.',         'rare'),
  ('indie-cup-winner',       'Indie Cup Winner',       'Won a monthly Indie genre cup.',       'rare'),
  ('latin-cup-winner',       'Latin Cup Winner',       'Won a monthly Latin genre cup.',       'rare'),
  ('alt-cup-winner',         'Alt Cup Winner',         'Won a monthly Alt genre cup.',         'rare'),
  ('afropop-cup-winner',     'Afropop Cup Winner',     'Won a monthly Afropop genre cup.',     'rare'),
  ('kpop-cup-winner',        'K-Pop Cup Winner',       'Won a monthly K-Pop genre cup.',       'rare'),
  ('electronic-cup-winner',  'Electronic Cup Winner',  'Won a monthly Electronic genre cup.',  'rare')
on conflict (slug) do nothing;
