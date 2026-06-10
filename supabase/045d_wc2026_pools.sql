-- 045d_wc2026_pools.sql
-- Multiple independent pools on one schema. The Spanish page
-- (/mundial2026) is its own pool: separate players, predictions,
-- leaderboard and per-pool admin. The match schedule (wc_matches) and
-- tournament facts (wc_settings.top_scorer) stay shared — same World Cup.
--
-- Partition key lives on wc_players only; predictions/finals hang off
-- player_id, so they're pool-scoped transitively. Clients filter by pool.

alter table public.wc_players
  add column if not exists pool text not null default 'main'
  check (pool ~ '^[a-z0-9_-]{1,16}$');

-- Names are now unique per pool, not globally.
drop index if exists public.wc_players_name_lower_key;
create unique index if not exists wc_players_pool_name_key
  on public.wc_players (pool, name_lower);

-- Clients filter on pool, which needs column SELECT privilege.
grant select (id, name, is_admin, created_at, pool) on public.wc_players to anon, authenticated;

-- wc_join gains a pool arg. Drop the old signature so the 2-arg call from
-- cached pages resolves unambiguously to this one via the default.
drop function if exists public.wc_join(text, text);

create or replace function public.wc_join(p_name text, p_pin text, p_pool text default 'main')
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_name text := btrim(p_name);
  v      public.wc_players%rowtype;
begin
  if v_name is null or char_length(v_name) < 2 or char_length(v_name) > 24 then
    raise exception 'NAME_INVALID';
  end if;
  if p_pin is null or p_pin !~ '^[0-9]{4,8}$' then
    raise exception 'PIN_INVALID';
  end if;
  if p_pool is null or p_pool !~ '^[a-z0-9_-]{1,16}$' then
    raise exception 'POOL_INVALID';
  end if;

  select * into v from public.wc_players
   where pool = p_pool and name_lower = lower(v_name);
  if found then
    if v.pin_hash = crypt(p_pin, v.pin_hash) then
      return json_build_object('token', v.token, 'player_id', v.id,
                               'name', v.name, 'is_admin', v.is_admin,
                               'existing', true);
    end if;
    raise exception 'WRONG_PIN';
  end if;

  if (select count(*) from public.wc_players where pool = p_pool) >= 300 then
    raise exception 'POOL_FULL';
  end if;

  -- First player of each pool becomes that pool's admin.
  insert into public.wc_players (name, pin_hash, pool, is_admin)
  values (v_name, crypt(p_pin, gen_salt('bf')), p_pool,
          not exists (select 1 from public.wc_players where pool = p_pool))
  returning * into v;

  return json_build_object('token', v.token, 'player_id', v.id,
                           'name', v.name, 'is_admin', v.is_admin,
                           'existing', false);
end;
$$;

-- Admin PIN resets only reach players in the admin's own pool.
create or replace function public.wc_admin_reset_pin(
  p_token uuid, p_player_name text, p_new_pin text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_admin public.wc_players%rowtype;
begin
  select * into v_admin from public.wc_players
   where token = p_token and is_admin;
  if v_admin.id is null then raise exception 'NOT_ADMIN'; end if;
  if p_new_pin is null or p_new_pin !~ '^[0-9]{4,8}$' then
    raise exception 'PIN_INVALID';
  end if;
  update public.wc_players
     set pin_hash = crypt(p_new_pin, gen_salt('bf'))
   where pool = v_admin.pool
     and name_lower = lower(btrim(p_player_name));
  if not found then raise exception 'NO_PLAYER'; end if;
end;
$$;

revoke execute on function public.wc_join(text, text, text) from public;
grant execute on function public.wc_join(text, text, text) to anon, authenticated;
