-- 045e_wc2026_bonus_deadline.sql
-- Bonus picks (champion + golden boot) now close at a configurable deadline
-- held in wc_settings.bonus_deadline, rather than always "30 min before the
-- opening match". This lets the pool reopen them mid-tournament (e.g. to give
-- latecomers a few more days). Others' bonus picks stay hidden until the same
-- deadline, so reopening never leaks anyone's pick early.
--
-- The deadline is global (both the EN /wc2026 and ES /mundial2026 pools share
-- the wc_settings table) — extending it opens bonus entry for both.

create or replace function public.wc_save_final(
  p_token uuid, p_champion text, p_top_scorer text default null)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_player   uuid;
  v_deadline timestamptz;
begin
  select id into v_player from public.wc_players where token = p_token;
  if v_player is null then raise exception 'BAD_TOKEN'; end if;

  select nullif(value, '')::timestamptz into v_deadline
    from public.wc_settings where key = 'bonus_deadline';
  if v_deadline is null then
    v_deadline := (select min(kickoff) from public.wc_matches) - interval '30 minutes';
  end if;
  if now() >= v_deadline then
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

-- Reveal others' picks only once the (possibly extended) deadline passes.
drop policy if exists wc_finals_read on public.wc_finals;
create policy wc_finals_read on public.wc_finals for select
  using (now() >= coalesce(
    (select nullif(value, '')::timestamptz from public.wc_settings where key = 'bonus_deadline'),
    (select min(kickoff) from public.wc_matches) - interval '30 minutes'));

-- Reopened on 2026-06-13 for ~3 days. Update this value to change the window.
insert into public.wc_settings (key, value) values ('bonus_deadline', '2026-06-16T23:59:00Z')
on conflict (key) do update set value = excluded.value, updated_at = now();
