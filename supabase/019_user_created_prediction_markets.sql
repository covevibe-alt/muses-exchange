-- ════════════════════════════════════════════════════════════════════════════
-- Migration 019 — User-created prediction markets
-- ════════════════════════════════════════════════════════════════════════════
-- Chunk B of the post-Phase-4 polish pass. Opens market creation to all
-- authenticated users via a new RPC with built-in rate limiting + abuse
-- guards. The original create_prediction_market() remains service-role
-- only (still useful for admin-curated launches and seeded markets).
--
-- Constraints on user creation (enforced inside the RPC):
--   • Question length 12–200 chars
--   • Resolution window 6 hours – 90 days from now
--   • Rate limit: max 1 new market per user in any rolling 24h window
--   • Active limit: max 5 simultaneously-open user-created markets per user
--   • All user-created markets are 'generic' type (no price_target — that
--     requires data-source resolution we don't have yet)
--
-- Resolution stays manual via service-role resolve_prediction_market()
-- for now. The market creator does NOT get the power to resolve their
-- own markets — that would let bad actors drain the pool by creating +
-- self-resolving as YES. Trust model: house resolves; users participate.
--
-- APPLIED VIA SUPABASE MCP on 2026-04-27.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.create_user_prediction_market(
  p_question      text,
  p_artist_ticker text default null,
  p_resolves_at   timestamptz default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id        uuid := auth.uid();
  v_question       text := btrim(coalesce(p_question, ''));
  v_resolves       timestamptz := coalesce(p_resolves_at, now() + interval '14 days');
  v_ticker         text := upper(nullif(btrim(coalesce(p_artist_ticker, '')), ''));
  v_id             int;
  v_slug           text;
  v_recent_count   int;
  v_active_count   int;
begin
  if v_user_id is null then
    return jsonb_build_object('error', 'not_authenticated');
  end if;

  if char_length(v_question) < 12 or char_length(v_question) > 200 then
    return jsonb_build_object('error', 'invalid_question');
  end if;

  if v_resolves <= now() + interval '6 hours' then
    return jsonb_build_object('error', 'resolves_too_soon');
  end if;
  if v_resolves > now() + interval '90 days' then
    return jsonb_build_object('error', 'resolves_too_far');
  end if;

  if v_ticker is not null and (char_length(v_ticker) > 12
                               or v_ticker !~ '^[A-Z0-9]+$') then
    return jsonb_build_object('error', 'invalid_ticker');
  end if;

  select count(*) into v_recent_count
  from prediction_markets
  where created_by = v_user_id
    and created_at > now() - interval '24 hours';
  if v_recent_count >= 1 then
    return jsonb_build_object('error', 'rate_limited_24h');
  end if;

  select count(*) into v_active_count
  from prediction_markets
  where created_by = v_user_id and status = 'open';
  if v_active_count >= 5 then
    return jsonb_build_object('error', 'too_many_active');
  end if;

  v_slug := regexp_replace(lower(v_question), '[^a-z0-9]+', '-', 'g');
  v_slug := trim(both '-' from v_slug);
  if char_length(v_slug) = 0 then v_slug := 'market'; end if;
  v_slug := substr(v_slug, 1, 48) || '-' || substr(md5(random()::text), 1, 6);

  insert into prediction_markets (
    slug, question, artist_ticker, market_type, resolves_at, created_by
  ) values (
    v_slug, v_question, v_ticker, 'generic', v_resolves, v_user_id
  )
  returning id into v_id;

  return jsonb_build_object(
    'ok',         true,
    'market_id',  v_id,
    'slug',       v_slug
  );
end;
$$;

revoke all    on function public.create_user_prediction_market(text, text, timestamptz) from public;
grant execute on function public.create_user_prediction_market(text, text, timestamptz) to authenticated;
