-- ════════════════════════════════════════════════════════════════════════════
-- Migration 031 — League customization (covers, themes, focus genre, public)
-- ════════════════════════════════════════════════════════════════════════════
-- Adds the customization fields the v2 create-league wizard needs.
-- All fields default to sane values so the legacy create_league() RPC and
-- existing rows continue to work unchanged.
--
-- New RPC: create_league_v2() — same shape as create_league() plus the new
-- customization knobs. Validates each value against the canonical preset
-- lists so the client can't smuggle invalid covers/themes into the table.
--
-- APPLIED VIA SUPABASE MCP on 2026-04-28.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.leagues
  add column if not exists cover_id    text default 'concert',
  add column if not exists theme_color text default 'purple',
  add column if not exists focus_genre text,
  add column if not exists is_public   boolean not null default false,
  add column if not exists settings    jsonb not null default '{}'::jsonb;

do $$ begin
  alter table public.leagues
    add constraint leagues_cover_chk check (cover_id in (
      'concert','vinyl','headphones','equalizer','neon-city','festival',
      'microphone','stadium','turntable','soundwave','guitar','piano'
    ));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.leagues
    add constraint leagues_theme_chk check (theme_color in (
      'purple','gold','mint','coral','pink','sky','lime','indigo'
    ));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.leagues
    add constraint leagues_focus_chk check (
      focus_genre is null
      or focus_genre in ('Pop','Hip-hop','R&B','Latin','Afropop','Indie','Alt','K-Pop','Electronic')
    );
exception when duplicate_object then null; end $$;

create index if not exists leagues_public_idx
  on public.leagues (is_public) where is_public = true;

create or replace function public.create_league_v2(
  p_name         text,
  p_description  text    default null,
  p_max_members  integer default 50,
  p_cover_id     text    default 'concert',
  p_theme_color  text    default 'purple',
  p_focus_genre  text    default null,
  p_is_public    boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id   uuid := auth.uid();
  v_league_id int;
  v_name      text := btrim(coalesce(p_name, ''));
  v_desc      text := nullif(btrim(coalesce(p_description, '')), '');
  v_slug      text;
  v_code      text;
  v_max       int  := greatest(2, least(coalesce(p_max_members, 50), 500));
  v_cover     text := coalesce(p_cover_id, 'concert');
  v_theme     text := coalesce(p_theme_color, 'purple');
  v_focus     text := nullif(btrim(coalesce(p_focus_genre, '')), '');
  v_attempts  int  := 0;
begin
  if v_user_id is null then
    return jsonb_build_object('error', 'not_authenticated');
  end if;
  if char_length(v_name) < 2 or char_length(v_name) > 50 then
    return jsonb_build_object('error', 'invalid_name');
  end if;
  if v_cover not in ('concert','vinyl','headphones','equalizer','neon-city','festival',
                     'microphone','stadium','turntable','soundwave','guitar','piano') then
    return jsonb_build_object('error', 'invalid_cover');
  end if;
  if v_theme not in ('purple','gold','mint','coral','pink','sky','lime','indigo') then
    return jsonb_build_object('error', 'invalid_theme');
  end if;
  if v_focus is not null
     and v_focus not in ('Pop','Hip-hop','R&B','Latin','Afropop','Indie','Alt','K-Pop','Electronic') then
    return jsonb_build_object('error', 'invalid_focus_genre');
  end if;

  v_slug := regexp_replace(lower(v_name), '[^a-z0-9]+', '-', 'g');
  v_slug := trim(both '-' from v_slug);
  if char_length(v_slug) = 0 then v_slug := 'league'; end if;
  v_slug := v_slug || '-' || substr(md5(random()::text || clock_timestamp()::text), 1, 6);

  loop
    v_code := upper(
      translate(
        substr(md5(random()::text || clock_timestamp()::text || v_user_id::text), 1, 8),
        '0oOiIl1', '234567'
      )
    );
    exit when not exists (select 1 from leagues where invite_code = v_code);
    v_attempts := v_attempts + 1;
    if v_attempts > 8 then
      return jsonb_build_object('error', 'code_generation_failed');
    end if;
  end loop;

  insert into leagues (
    slug, name, description, owner_id, invite_code, max_members,
    cover_id, theme_color, focus_genre, is_public
  ) values (
    v_slug, v_name, v_desc, v_user_id, v_code, v_max,
    v_cover, v_theme, v_focus, coalesce(p_is_public, false)
  )
  returning id into v_league_id;

  insert into league_members (league_id, user_id, role)
  values (v_league_id, v_user_id, 'owner');

  return jsonb_build_object(
    'ok',          true,
    'league_id',   v_league_id,
    'slug',        v_slug,
    'invite_code', v_code,
    'name',        v_name,
    'cover_id',    v_cover,
    'theme_color', v_theme,
    'focus_genre', v_focus,
    'is_public',   coalesce(p_is_public, false)
  );
end;
$$;

revoke execute on function public.create_league_v2(text, text, integer, text, text, text, boolean) from anon, public;
grant  execute on function public.create_league_v2(text, text, integer, text, text, text, boolean) to authenticated;
