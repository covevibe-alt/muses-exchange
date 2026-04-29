-- ════════════════════════════════════════════════════════════════════════════
-- Migration 032 — update_league RPC + fetch_league_by_slug helper
-- ════════════════════════════════════════════════════════════════════════════
-- Phase B of the leagues redesign needs:
--   1. owner-only update_league() so the Settings tab on the new league
--      detail page can save name/description/cover/theme/focus/max/public
--   2. fetch_league_by_slug() helper so the SPA can hydrate /leagues/<slug>
--      URLs even when the visitor isn't a member yet (RLS on `leagues` is
--      currently scoped to members + invite-code-by-membership). Public
--      leagues should be discoverable by slug; private ones only by code.
--
-- Both validate the same preset lists migration 031 declared, so the only
-- way to land an invalid value in the table is via direct SQL.
--
-- APPLIED VIA SUPABASE MCP on 2026-04-29.
-- ════════════════════════════════════════════════════════════════════════════

-- ─── update_league ──────────────────────────────────────────────────────
-- Owner-only updates. Passing NULL for any field leaves it unchanged
-- (so the client can send only the keys it actually wants to mutate).
-- Returns the row as jsonb on success, or {error: ...} on failure.
create or replace function public.update_league(
  p_league_id    int,
  p_name         text    default null,
  p_description  text    default null,
  p_cover_id     text    default null,
  p_theme_color  text    default null,
  p_focus_genre  text    default null,
  p_max_members  integer default null,
  p_is_public    boolean default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_owner   uuid;
  v_row     leagues%rowtype;
  v_name    text;
  v_desc    text;
  v_focus   text;
begin
  if v_user_id is null then
    return jsonb_build_object('error', 'not_authenticated');
  end if;

  select owner_id into v_owner from leagues where id = p_league_id;
  if v_owner is null then
    return jsonb_build_object('error', 'league_not_found');
  end if;
  if v_owner <> v_user_id then
    return jsonb_build_object('error', 'not_owner');
  end if;

  -- Normalise + validate. Treat empty strings as "leave alone" too, so
  -- the client can safely round-trip user input without the trim dance.
  if p_name is not null then
    v_name := btrim(p_name);
    if char_length(v_name) < 2 or char_length(v_name) > 50 then
      return jsonb_build_object('error', 'invalid_name');
    end if;
  end if;
  if p_description is not null then
    v_desc := nullif(btrim(p_description), '');
  end if;
  if p_cover_id is not null
     and p_cover_id not in ('concert','vinyl','headphones','equalizer','neon-city','festival',
                            'microphone','stadium','turntable','soundwave','guitar','piano') then
    return jsonb_build_object('error', 'invalid_cover');
  end if;
  if p_theme_color is not null
     and p_theme_color not in ('purple','gold','mint','coral','pink','sky','lime','indigo') then
    return jsonb_build_object('error', 'invalid_theme');
  end if;
  if p_focus_genre is not null then
    v_focus := nullif(btrim(p_focus_genre), '');
    if v_focus is not null
       and v_focus not in ('Pop','Hip-hop','R&B','Latin','Afropop','Indie','Alt','K-Pop','Electronic') then
      return jsonb_build_object('error', 'invalid_focus_genre');
    end if;
  end if;
  if p_max_members is not null and (p_max_members < 2 or p_max_members > 500) then
    return jsonb_build_object('error', 'invalid_max_members');
  end if;

  update leagues
  set
    name        = coalesce(v_name, name),
    description = case when p_description is null then description else v_desc end,
    cover_id    = coalesce(p_cover_id, cover_id),
    theme_color = coalesce(p_theme_color, theme_color),
    focus_genre = case when p_focus_genre is null then focus_genre else v_focus end,
    max_members = coalesce(p_max_members, max_members),
    is_public   = coalesce(p_is_public, is_public),
    updated_at  = now()
  where id = p_league_id
  returning * into v_row;

  return jsonb_build_object(
    'ok',          true,
    'id',          v_row.id,
    'slug',        v_row.slug,
    'name',        v_row.name,
    'description', v_row.description,
    'cover_id',    v_row.cover_id,
    'theme_color', v_row.theme_color,
    'focus_genre', v_row.focus_genre,
    'max_members', v_row.max_members,
    'is_public',   v_row.is_public,
    'invite_code', v_row.invite_code
  );
end;
$$;

revoke execute on function public.update_league(int, text, text, text, text, text, integer, boolean) from anon, public;
grant  execute on function public.update_league(int, text, text, text, text, text, integer, boolean) to authenticated;

-- ─── fetch_league_by_slug ───────────────────────────────────────────────
-- Read-only lookup. Returns the league row if:
--   • is_public = true (anyone may discover), OR
--   • caller is already a member (so /leagues/<slug> works after join)
-- Anyone else → {error: 'not_found_or_private'} (don't leak existence).
create or replace function public.fetch_league_by_slug(p_slug text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
stable
as $$
declare
  v_user_id uuid := auth.uid();
  v_row     leagues%rowtype;
  v_count   int;
  v_is_member boolean;
begin
  select * into v_row from leagues where slug = p_slug and status = 'active' limit 1;
  if v_row.id is null then
    return jsonb_build_object('error', 'not_found_or_private');
  end if;

  v_is_member := false;
  if v_user_id is not null then
    select exists(select 1 from league_members where league_id = v_row.id and user_id = v_user_id)
      into v_is_member;
  end if;

  if not v_row.is_public and not v_is_member then
    return jsonb_build_object('error', 'not_found_or_private');
  end if;

  select count(*) into v_count from league_members where league_id = v_row.id;

  return jsonb_build_object(
    'ok',           true,
    'id',           v_row.id,
    'slug',         v_row.slug,
    'name',         v_row.name,
    'description',  v_row.description,
    'cover_id',     v_row.cover_id,
    'theme_color',  v_row.theme_color,
    'focus_genre',  v_row.focus_genre,
    'max_members',  v_row.max_members,
    'is_public',    v_row.is_public,
    'invite_code',  case when v_is_member then v_row.invite_code else null end,
    'owner_id',     v_row.owner_id,
    'member_count', v_count,
    'is_member',    v_is_member,
    'is_owner',     v_user_id is not null and v_row.owner_id = v_user_id
  );
end;
$$;

revoke execute on function public.fetch_league_by_slug(text) from anon;
grant  execute on function public.fetch_league_by_slug(text) to authenticated;

-- ─── ensure leagues.updated_at column exists ────────────────────────────
-- update_league sets updated_at = now(); add it if missing so the RPC
-- doesn't error on a fresh project that hasn't run earlier conventions.
alter table public.leagues
  add column if not exists updated_at timestamptz not null default now();
