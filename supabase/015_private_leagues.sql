-- ════════════════════════════════════════════════════════════════════════════
-- Migration 015 — Private leagues (invite-code groups + scoped leaderboard)
-- ════════════════════════════════════════════════════════════════════════════
-- Phase 3 Chunk 1. Users create a league, share an 8-char invite code
-- with friends, and the league gets its own leaderboard scoped to its
-- members only. Cleanest premium upsell surface (gate creation behind
-- Premium in Phase 5). For now, creation is free.
--
-- Tables:
--   leagues            — one row per league. owner_id is the creator,
--                        invite_code is the join key.
--   league_members     — (league_id, user_id). 'owner' or 'member' role.
--
-- All writes go through security-definer RPCs (create_league /
-- join_league / leave_league) so we can enforce invariants that can't
-- be expressed as simple RLS predicates (max_members, ownership
-- transfer on leave, etc.).
--
-- APPLIED VIA SUPABASE MCP on 2026-04-24.
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.leagues (
  id            serial primary key,
  slug          text unique not null,
  name          text not null,
  description   text,
  owner_id      uuid not null references auth.users(id) on delete cascade,
  invite_code   text unique not null,
  max_members   int not null default 50 check (max_members between 2 and 500),
  status        text not null default 'active' check (status in ('active', 'archived')),
  created_at    timestamptz default now(),
  check (char_length(name) between 2 and 50)
);

create table if not exists public.league_members (
  league_id     int references public.leagues(id) on delete cascade,
  user_id       uuid references auth.users(id) on delete cascade,
  joined_at     timestamptz default now(),
  role          text not null default 'member' check (role in ('owner', 'member')),
  primary key (league_id, user_id)
);

create index if not exists league_members_user_idx
  on public.league_members (user_id);

-- ──────────────────────────────────────────────────────────────────────
-- RLS
-- ──────────────────────────────────────────────────────────────────────
alter table public.leagues         enable row level security;
alter table public.league_members  enable row level security;

drop policy if exists "leagues_select_members" on public.leagues;
create policy "leagues_select_members"
  on public.leagues for select
  to authenticated
  using (exists (
    select 1 from public.league_members lm
    where lm.league_id = leagues.id and lm.user_id = auth.uid()
  ));

drop policy if exists "leagues_update_owner" on public.leagues;
create policy "leagues_update_owner"
  on public.leagues for update
  to authenticated
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

drop policy if exists "league_members_select_same_league" on public.league_members;
create policy "league_members_select_same_league"
  on public.league_members for select
  to authenticated
  using (exists (
    select 1 from public.league_members self
    where self.league_id = league_members.league_id
      and self.user_id = auth.uid()
  ));

-- ──────────────────────────────────────────────────────────────────────
-- RPCs
-- ──────────────────────────────────────────────────────────────────────

create or replace function public.create_league(
  p_name         text,
  p_description  text default null,
  p_max_members  int  default 50
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
  v_attempts  int  := 0;
begin
  if v_user_id is null then
    return jsonb_build_object('error', 'not_authenticated');
  end if;
  if char_length(v_name) < 2 or char_length(v_name) > 50 then
    return jsonb_build_object('error', 'invalid_name');
  end if;

  v_slug := regexp_replace(lower(v_name), '[^a-z0-9]+', '-', 'g');
  v_slug := trim(both '-' from v_slug);
  if char_length(v_slug) = 0 then v_slug := 'league'; end if;
  v_slug := v_slug || '-' || substr(md5(random()::text || clock_timestamp()::text), 1, 6);

  loop
    v_code := upper(
      translate(
        substr(md5(random()::text || clock_timestamp()::text || v_user_id::text), 1, 8),
        '0oOiIl1',
        '234567'
      )
    );
    exit when not exists (select 1 from leagues where invite_code = v_code);
    v_attempts := v_attempts + 1;
    if v_attempts > 8 then
      return jsonb_build_object('error', 'code_generation_failed');
    end if;
  end loop;

  insert into leagues (slug, name, description, owner_id, invite_code, max_members)
  values (v_slug, v_name, v_desc, v_user_id, v_code, v_max)
  returning id into v_league_id;

  insert into league_members (league_id, user_id, role)
  values (v_league_id, v_user_id, 'owner');

  return jsonb_build_object(
    'ok',          true,
    'league_id',   v_league_id,
    'slug',        v_slug,
    'invite_code', v_code,
    'name',        v_name
  );
end;
$$;

revoke all    on function public.create_league(text, text, int) from public;
grant execute on function public.create_league(text, text, int) to authenticated;

create or replace function public.join_league(p_invite_code text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_league  record;
  v_count   int;
  v_code    text := upper(btrim(coalesce(p_invite_code, '')));
begin
  if v_user_id is null then
    return jsonb_build_object('error', 'not_authenticated');
  end if;
  if char_length(v_code) < 6 then
    return jsonb_build_object('error', 'invalid_code');
  end if;

  select * into v_league
  from leagues
  where invite_code = v_code and status = 'active';
  if v_league.id is null then
    return jsonb_build_object('error', 'invalid_code');
  end if;

  if exists (
    select 1 from league_members
    where league_id = v_league.id and user_id = v_user_id
  ) then
    return jsonb_build_object(
      'ok',         true,
      'league_id',  v_league.id,
      'name',       v_league.name,
      'already_member', true
    );
  end if;

  select count(*) into v_count from league_members where league_id = v_league.id;
  if v_count >= v_league.max_members then
    return jsonb_build_object('error', 'league_full');
  end if;

  insert into league_members (league_id, user_id, role)
  values (v_league.id, v_user_id, 'member');

  return jsonb_build_object(
    'ok',        true,
    'league_id', v_league.id,
    'name',      v_league.name
  );
end;
$$;

revoke all    on function public.join_league(text) from public;
grant execute on function public.join_league(text) to authenticated;

create or replace function public.leave_league(p_league_id int)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_role    text;
  v_count   int;
begin
  if v_user_id is null then
    return jsonb_build_object('error', 'not_authenticated');
  end if;

  select role into v_role
  from league_members
  where league_id = p_league_id and user_id = v_user_id;
  if v_role is null then
    return jsonb_build_object('error', 'not_a_member');
  end if;

  if v_role = 'owner' then
    select count(*) into v_count from league_members where league_id = p_league_id;
    if v_count > 1 then
      return jsonb_build_object('error', 'owner_cannot_leave_while_members');
    end if;
    update leagues set status = 'archived' where id = p_league_id;
  end if;

  delete from league_members
  where league_id = p_league_id and user_id = v_user_id;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all    on function public.leave_league(int) from public;
grant execute on function public.leave_league(int) to authenticated;
