-- ════════════════════════════════════════════════════════════════════════════
-- Migration 034 — Leagues D: multi-genre filter + time limit + friend invites
-- ════════════════════════════════════════════════════════════════════════════
-- Three additions for the Leagues v2 polish pass:
--
--   1. focus_genres jsonb — multi-select replacement for the single
--      focus_genre column. League standings can filter by any number of
--      genres; member returns are summed across the picked genres using
--      the existing leaderboard.genre_returns jsonb.
--
--   2. ends_at timestamptz — optional league end-time. NULL = open-ended
--      (the season-end cron still applies). Drives a countdown chip on
--      the detail page.
--
--   3. invite_users_to_league(p_league_id, p_handles[]) — owner-only RPC.
--      Resolves each handle to a user_id via profiles + adds them as a
--      member. Skips silently if a user already belongs or doesn't exist
--      (returns counts so the client can show a summary toast).
--
-- focus_genre column is left in place for rollback safety; the new code
-- writes only to focus_genres. A follow-up cleanup migration can drop it
-- once we're confident no caller still reads it.
--
-- APPLIED VIA SUPABASE MCP on 2026-04-30.
-- ════════════════════════════════════════════════════════════════════════════

-- ─── Schema additions ───────────────────────────────────────────────────
alter table public.leagues
  add column if not exists focus_genres jsonb not null default '[]'::jsonb,
  add column if not exists ends_at      timestamptz;

-- Backfill: any row with focus_genre IS NOT NULL → focus_genres = [focus_genre]
update public.leagues
set focus_genres = jsonb_build_array(focus_genre)
where focus_genre is not null
  and (focus_genres is null or focus_genres = '[]'::jsonb);

-- Validation function: every entry in focus_genres must be one of the canonical
-- genres. We can't check arbitrary arrays with a CHECK constraint cleanly, so
-- enforce via trigger.
create or replace function public.leagues_validate_focus_genres()
returns trigger
language plpgsql
as $$
declare
  v_g text;
begin
  if NEW.focus_genres is null or NEW.focus_genres = '[]'::jsonb then
    return NEW;
  end if;
  if jsonb_typeof(NEW.focus_genres) <> 'array' then
    raise exception 'focus_genres must be a jsonb array';
  end if;
  for v_g in select jsonb_array_elements_text(NEW.focus_genres) loop
    if v_g not in ('Pop','Hip-hop','R&B','Latin','Afropop','Indie','Alt','K-Pop','Electronic') then
      raise exception 'invalid genre: %', v_g;
    end if;
  end loop;
  return NEW;
end;
$$;

drop trigger if exists leagues_validate_focus_genres on public.leagues;
create trigger leagues_validate_focus_genres
  before insert or update of focus_genres on public.leagues
  for each row execute function public.leagues_validate_focus_genres();

-- ─── create_league_v2: replace text focus_genre with jsonb focus_genres + ends_at
-- The old single-genre signature is dropped; clients migrate to the new shape.
drop function if exists public.create_league_v2(text, text, integer, text, text, text, boolean);

create or replace function public.create_league_v2(
  p_name          text,
  p_description   text    default null,
  p_max_members   integer default 50,
  p_cover_id      text    default 'concert',
  p_theme_color   text    default 'purple',
  p_focus_genres  jsonb   default '[]'::jsonb,
  p_is_public     boolean default false,
  p_ends_at       timestamptz default null
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
  v_attempts  int  := 0;
  v_g         text;
begin
  if v_user_id is null then
    return jsonb_build_object('error', 'not_authenticated');
  end if;
  if char_length(v_name) < 2 or char_length(v_name) > 50 then
    return jsonb_build_object('error', 'invalid_name');
  end if;
  if v_cover not in ('concert','vinyl','headphones','equalizer','neon-city','festival',
                     'microphone','stadium','turntable','soundwave','guitar','piano',
                     'engineer','rapper','vocalist','street','listener','neon','subway','studio') then
    return jsonb_build_object('error', 'invalid_cover');
  end if;
  if v_theme not in ('purple','gold','mint','coral','pink','sky','lime','indigo') then
    return jsonb_build_object('error', 'invalid_theme');
  end if;
  -- Validate genres array entries inline (the trigger will catch it too,
  -- but a structured error is friendlier than the trigger's text exception).
  if p_focus_genres is not null and jsonb_typeof(p_focus_genres) = 'array' then
    for v_g in select jsonb_array_elements_text(p_focus_genres) loop
      if v_g not in ('Pop','Hip-hop','R&B','Latin','Afropop','Indie','Alt','K-Pop','Electronic') then
        return jsonb_build_object('error', 'invalid_focus_genre');
      end if;
    end loop;
  end if;
  -- ends_at must be in the future (when set)
  if p_ends_at is not null and p_ends_at <= now() then
    return jsonb_build_object('error', 'ends_at_in_past');
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
    cover_id, theme_color, focus_genres, is_public, ends_at
  ) values (
    v_slug, v_name, v_desc, v_user_id, v_code, v_max,
    v_cover, v_theme, coalesce(p_focus_genres, '[]'::jsonb), coalesce(p_is_public, false), p_ends_at
  )
  returning id into v_league_id;

  insert into league_members (league_id, user_id, role)
  values (v_league_id, v_user_id, 'owner');

  return jsonb_build_object(
    'ok',           true,
    'league_id',    v_league_id,
    'slug',         v_slug,
    'invite_code',  v_code,
    'name',         v_name,
    'cover_id',     v_cover,
    'theme_color',  v_theme,
    'focus_genres', coalesce(p_focus_genres, '[]'::jsonb),
    'is_public',    coalesce(p_is_public, false),
    'ends_at',      p_ends_at
  );
end;
$$;

revoke execute on function public.create_league_v2(text, text, integer, text, text, jsonb, boolean, timestamptz) from anon, public;
grant  execute on function public.create_league_v2(text, text, integer, text, text, jsonb, boolean, timestamptz) to authenticated;

-- ─── update_league: add jsonb focus_genres + ends_at; drop old single-genre param
drop function if exists public.update_league(int, text, text, text, text, text, integer, boolean);

create or replace function public.update_league(
  p_league_id     int,
  p_name          text    default null,
  p_description   text    default null,
  p_cover_id      text    default null,
  p_theme_color   text    default null,
  p_focus_genres  jsonb   default null,
  p_max_members   integer default null,
  p_is_public     boolean default null,
  p_ends_at       timestamptz default null,
  p_clear_ends_at boolean default false
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
  v_g       text;
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
                            'microphone','stadium','turntable','soundwave','guitar','piano',
                            'engineer','rapper','vocalist','street','listener','neon','subway','studio') then
    return jsonb_build_object('error', 'invalid_cover');
  end if;
  if p_theme_color is not null
     and p_theme_color not in ('purple','gold','mint','coral','pink','sky','lime','indigo') then
    return jsonb_build_object('error', 'invalid_theme');
  end if;
  if p_focus_genres is not null and jsonb_typeof(p_focus_genres) = 'array' then
    for v_g in select jsonb_array_elements_text(p_focus_genres) loop
      if v_g not in ('Pop','Hip-hop','R&B','Latin','Afropop','Indie','Alt','K-Pop','Electronic') then
        return jsonb_build_object('error', 'invalid_focus_genre');
      end if;
    end loop;
  end if;
  if p_max_members is not null and (p_max_members < 2 or p_max_members > 500) then
    return jsonb_build_object('error', 'invalid_max_members');
  end if;
  if p_ends_at is not null and not p_clear_ends_at and p_ends_at <= now() then
    return jsonb_build_object('error', 'ends_at_in_past');
  end if;

  update leagues
  set
    name         = coalesce(v_name, name),
    description  = case when p_description is null then description else v_desc end,
    cover_id     = coalesce(p_cover_id, cover_id),
    theme_color  = coalesce(p_theme_color, theme_color),
    focus_genres = coalesce(p_focus_genres, focus_genres),
    max_members  = coalesce(p_max_members, max_members),
    is_public    = coalesce(p_is_public, is_public),
    ends_at      = case when p_clear_ends_at then null else coalesce(p_ends_at, ends_at) end,
    updated_at   = now()
  where id = p_league_id
  returning * into v_row;

  return jsonb_build_object(
    'ok',           true,
    'id',           v_row.id,
    'slug',         v_row.slug,
    'name',         v_row.name,
    'description',  v_row.description,
    'cover_id',     v_row.cover_id,
    'theme_color',  v_row.theme_color,
    'focus_genres', v_row.focus_genres,
    'max_members',  v_row.max_members,
    'is_public',    v_row.is_public,
    'ends_at',      v_row.ends_at,
    'invite_code',  v_row.invite_code
  );
end;
$$;

revoke execute on function public.update_league(int, text, text, text, text, jsonb, integer, boolean, timestamptz, boolean) from anon, public;
grant  execute on function public.update_league(int, text, text, text, text, jsonb, integer, boolean, timestamptz, boolean) to authenticated;

-- ─── invite_users_to_league(p_league_id, p_handles text[]) ──────────────
-- Owner-only. Resolves each handle (case-insensitive, optional leading '@')
-- to a user_id via profiles. Inserts league_members rows for any not yet
-- in the league. Returns {invited:int, already_member:int, not_found:[handles], full:bool}
create or replace function public.invite_users_to_league(
  p_league_id int,
  p_handles   text[]
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_owner   uuid;
  v_max     int;
  v_count   int;
  v_invited int := 0;
  v_already int := 0;
  v_not_found text[] := array[]::text[];
  v_h text;
  v_clean text;
  v_target uuid;
  v_existing boolean;
begin
  if v_user_id is null then return jsonb_build_object('error', 'not_authenticated'); end if;
  select owner_id, max_members into v_owner, v_max from leagues where id = p_league_id;
  if v_owner is null then return jsonb_build_object('error', 'league_not_found'); end if;
  if v_owner <> v_user_id then return jsonb_build_object('error', 'not_owner'); end if;
  if p_handles is null or array_length(p_handles, 1) is null then
    return jsonb_build_object('invited', 0, 'already_member', 0, 'not_found', '[]'::jsonb, 'full', false);
  end if;

  foreach v_h in array p_handles loop
    v_clean := lower(btrim(v_h));
    if v_clean like '@%' then v_clean := substr(v_clean, 2); end if;
    if v_clean = '' then continue; end if;

    select user_id into v_target from profiles where lower(handle) = v_clean limit 1;
    if v_target is null then
      v_not_found := array_append(v_not_found, v_h);
      continue;
    end if;

    select exists(select 1 from league_members where league_id = p_league_id and user_id = v_target)
      into v_existing;
    if v_existing then
      v_already := v_already + 1;
      continue;
    end if;

    -- Capacity gate before inserting another member.
    select count(*) into v_count from league_members where league_id = p_league_id;
    if v_count >= v_max then
      return jsonb_build_object(
        'invited', v_invited,
        'already_member', v_already,
        'not_found', to_jsonb(v_not_found),
        'full', true
      );
    end if;

    insert into league_members (league_id, user_id, role)
    values (p_league_id, v_target, 'member')
    on conflict do nothing;
    v_invited := v_invited + 1;
  end loop;

  return jsonb_build_object(
    'invited', v_invited,
    'already_member', v_already,
    'not_found', to_jsonb(v_not_found),
    'full', false
  );
end;
$$;

revoke execute on function public.invite_users_to_league(int, text[]) from anon, public;
grant  execute on function public.invite_users_to_league(int, text[]) to authenticated;
