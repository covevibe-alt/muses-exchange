-- 045c_wc2026_bonus_picks.sql
-- Bonus picks are now: tournament winner (+15) and top scorer (+10).
-- The total-goals tiebreaker guess is retired (column kept, ignored).
--
-- Top-scorer resolution: the results feed aggregates goalscorers from ESPN
-- match details; if the feed can't settle it (ties are honored — any player
-- tied for most goals counts), the admin can set the official answer via
-- wc_admin_set_setting('top_scorer', 'Name') and clients prefer that.

alter table public.wc_finals add column if not exists top_scorer text;

-- Signature changes (integer -> text arg), so the old overload must go.
drop function if exists public.wc_save_final(uuid, text, integer);

create or replace function public.wc_save_final(
  p_token uuid, p_champion text, p_top_scorer text default null)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_player uuid;
begin
  select id into v_player from public.wc_players where token = p_token;
  if v_player is null then raise exception 'BAD_TOKEN'; end if;

  if (select min(kickoff) from public.wc_matches) - interval '30 minutes' <= now() then
    raise exception 'LOCKED';
  end if;
  if p_champion is null or char_length(btrim(p_champion)) not between 2 and 40 then
    raise exception 'CHAMPION_INVALID';
  end if;
  if p_top_scorer is not null and char_length(btrim(p_top_scorer)) not between 2 and 60 then
    raise exception 'SCORER_INVALID';
  end if;

  insert into public.wc_finals (player_id, champion, top_scorer)
  values (v_player, btrim(p_champion), nullif(btrim(coalesce(p_top_scorer, '')), ''))
  on conflict (player_id) do update
    set champion   = excluded.champion,
        top_scorer = excluded.top_scorer,
        updated_at = now();
end;
$$;

create or replace function public.wc_get_mine(p_token uuid)
returns json
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v public.wc_players%rowtype;
begin
  select * into v from public.wc_players where token = p_token;
  if v.id is null then raise exception 'BAD_TOKEN'; end if;

  return json_build_object(
    'player', json_build_object('id', v.id, 'name', v.name, 'is_admin', v.is_admin),
    'predictions', coalesce((
      select json_agg(json_build_object(
               'match_id', p.match_id, 'h', p.home_goals, 'a', p.away_goals))
      from public.wc_predictions p where p.player_id = v.id), '[]'::json),
    'final', (
      select json_build_object('champion', f.champion, 'top_scorer', f.top_scorer)
      from public.wc_finals f where f.player_id = v.id)
  );
end;
$$;

-- Tiny key/value store for pool-level facts (currently just 'top_scorer').
create table if not exists public.wc_settings (
  key        text primary key,
  value      text,
  updated_at timestamptz not null default now()
);
alter table public.wc_settings enable row level security;
drop policy if exists wc_settings_read on public.wc_settings;
create policy wc_settings_read on public.wc_settings for select using (true);
revoke all on public.wc_settings from anon, authenticated;
grant select on public.wc_settings to anon, authenticated;

create or replace function public.wc_admin_set_setting(
  p_token uuid, p_key text, p_value text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if not exists (select 1 from public.wc_players
                 where token = p_token and is_admin) then
    raise exception 'NOT_ADMIN';
  end if;
  if p_key not in ('top_scorer') then raise exception 'KEY_INVALID'; end if;
  insert into public.wc_settings (key, value) values (p_key, p_value)
  on conflict (key) do update set value = excluded.value, updated_at = now();
end;
$$;

revoke execute on function public.wc_save_final(uuid, text, text)          from public;
revoke execute on function public.wc_admin_set_setting(uuid, text, text)   from public;
grant execute on function public.wc_save_final(uuid, text, text)         to anon, authenticated;
grant execute on function public.wc_admin_set_setting(uuid, text, text)  to anon, authenticated;
