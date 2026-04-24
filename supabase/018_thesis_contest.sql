-- ════════════════════════════════════════════════════════════════════════════
-- Migration 018 — Weekly thesis contest
-- ════════════════════════════════════════════════════════════════════════════
-- Phase 4 Chunk 2. Users submit a short "why I think $X will move this
-- week" thesis. Community votes. Weekly winner (highest net score) gets
-- the 'thesis-winner' badge on rollover.
--
-- Cadence:
--   - week_start = Monday (ISO dow = 1). A thesis is assigned to the
--     week its submitted_at falls inside.
--   - One thesis per user per week.
--   - Voting is open during the week. Anyone except the author.
--   - Monday at 00:25 UTC: close_thesis_week() picks the top-voted
--     thesis of the PREVIOUS week and awards thesis-winner.
--
-- Moderation v1:
--   - Length-capped (20–280 chars)
--   - Direction must be 'up' or 'down'
--   - All submissions auto-approve (status='approved'). Admin can flip
--     to 'hidden' via SQL to deal with abuse.
--   - No profanity filter yet — if it becomes an issue, add later.
--
-- APPLIED VIA SUPABASE MCP on 2026-04-24.
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.theses (
  id            serial primary key,
  user_id       uuid not null references auth.users(id) on delete cascade,
  week_start    date not null,
  ticker        text not null,
  direction     text not null check (direction in ('up', 'down')),
  thesis_text   text not null check (char_length(thesis_text) between 20 and 280),
  status        text not null default 'approved'
                check (status in ('approved', 'hidden')),
  created_at    timestamptz default now(),
  unique (week_start, user_id)
);

create index if not exists theses_week_status_idx
  on public.theses (week_start, status);
create index if not exists theses_user_idx
  on public.theses (user_id, week_start desc);

create table if not exists public.thesis_votes (
  thesis_id     int not null references public.theses(id) on delete cascade,
  voter_id      uuid not null references auth.users(id) on delete cascade,
  vote          smallint not null check (vote in (1, -1)),
  voted_at      timestamptz default now(),
  primary key (thesis_id, voter_id)
);

create index if not exists thesis_votes_voter_idx
  on public.thesis_votes (voter_id);

alter table public.theses       enable row level security;
alter table public.thesis_votes enable row level security;

drop policy if exists "theses_select_approved_or_own" on public.theses;
create policy "theses_select_approved_or_own"
  on public.theses for select
  to authenticated
  using (status = 'approved' or auth.uid() = user_id);

drop policy if exists "thesis_votes_select_auth" on public.thesis_votes;
create policy "thesis_votes_select_auth"
  on public.thesis_votes for select
  to authenticated using (true);

insert into public.badges (slug, name, description, rarity) values
  ('thesis-winner', 'Thesis Winner',
   'Wrote the top-voted weekly thesis.', 'rare')
on conflict (slug) do nothing;

create or replace function public.submit_thesis(
  p_ticker    text,
  p_direction text,
  p_text      text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id     uuid := auth.uid();
  v_ticker      text := upper(btrim(coalesce(p_ticker, '')));
  v_text        text := btrim(coalesce(p_text, ''));
  v_week_start  date;
  v_id          int;
begin
  if v_user_id is null then
    return jsonb_build_object('error', 'not_authenticated');
  end if;
  if char_length(v_ticker) = 0 or char_length(v_ticker) > 12 then
    return jsonb_build_object('error', 'invalid_ticker');
  end if;
  if p_direction not in ('up', 'down') then
    return jsonb_build_object('error', 'invalid_direction');
  end if;
  if char_length(v_text) < 20 or char_length(v_text) > 280 then
    return jsonb_build_object('error', 'invalid_length');
  end if;

  v_week_start := date_trunc('week', current_date)::date;

  insert into theses (user_id, week_start, ticker, direction, thesis_text)
  values (v_user_id, v_week_start, v_ticker, p_direction, v_text)
  on conflict (week_start, user_id) do nothing
  returning id into v_id;

  if v_id is null then
    return jsonb_build_object('error', 'already_posted_this_week');
  end if;

  return jsonb_build_object('ok', true, 'thesis_id', v_id, 'week_start', v_week_start);
end;
$$;

revoke all    on function public.submit_thesis(text, text, text) from public;
grant execute on function public.submit_thesis(text, text, text) to authenticated;

create or replace function public.vote_thesis(
  p_thesis_id int,
  p_vote      int
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_thesis  record;
begin
  if v_user_id is null then
    return jsonb_build_object('error', 'not_authenticated');
  end if;
  if p_vote not in (1, -1) then
    return jsonb_build_object('error', 'invalid_vote');
  end if;
  select * into v_thesis from theses where id = p_thesis_id;
  if v_thesis.id is null then
    return jsonb_build_object('error', 'thesis_not_found');
  end if;
  if v_thesis.user_id = v_user_id then
    return jsonb_build_object('error', 'cannot_vote_on_own_thesis');
  end if;
  if v_thesis.status <> 'approved' then
    return jsonb_build_object('error', 'thesis_unavailable');
  end if;

  insert into thesis_votes (thesis_id, voter_id, vote)
  values (p_thesis_id, v_user_id, p_vote::smallint)
  on conflict (thesis_id, voter_id)
    do update set vote = excluded.vote, voted_at = now();

  return jsonb_build_object('ok', true);
end;
$$;

revoke all    on function public.vote_thesis(int, int) from public;
grant execute on function public.vote_thesis(int, int) to authenticated;

create or replace function public.unvote_thesis(p_thesis_id int)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    return jsonb_build_object('error', 'not_authenticated');
  end if;
  delete from thesis_votes
  where thesis_id = p_thesis_id and voter_id = v_user_id;
  return jsonb_build_object('ok', true);
end;
$$;

revoke all    on function public.unvote_thesis(int) from public;
grant execute on function public.unvote_thesis(int) to authenticated;

create or replace function public.close_thesis_week(p_week_start date)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_winner_id    int;
  v_winner_user  uuid;
  v_net          int;
begin
  select t.id, t.user_id, coalesce(sum(v.vote), 0)::int
  into v_winner_id, v_winner_user, v_net
  from theses t
  left join thesis_votes v on v.thesis_id = t.id
  where t.week_start = p_week_start and t.status = 'approved'
  group by t.id, t.user_id, t.created_at
  order by coalesce(sum(v.vote), 0) desc, t.created_at asc
  limit 1;

  if v_winner_id is null then
    return jsonb_build_object('ok', true, 'winner', null, 'week', p_week_start);
  end if;

  if v_net > 0 then
    perform public.award_badge(v_winner_user, 'thesis-winner',
      jsonb_build_object(
        'thesis_id',  v_winner_id,
        'week_start', p_week_start::text,
        'net_votes',  v_net
      ));
  end if;

  return jsonb_build_object(
    'ok',         true,
    'winner_id',  v_winner_id,
    'net_votes',  v_net,
    'awarded',    v_net > 0,
    'week',       p_week_start
  );
end;
$$;

revoke all    on function public.close_thesis_week(date) from public;
grant execute on function public.close_thesis_week(date) to service_role;

create or replace function public.weekly_thesis_rollover()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_last_monday date := date_trunc('week', current_date - 1)::date;
begin
  return public.close_thesis_week(v_last_monday);
end;
$$;

revoke all    on function public.weekly_thesis_rollover() from public;
grant execute on function public.weekly_thesis_rollover() to service_role;

select cron.schedule(
  'weekly-thesis-rollover',
  '25 0 * * 1',
  $inner$select public.weekly_thesis_rollover();$inner$
);
