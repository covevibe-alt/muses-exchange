-- ════════════════════════════════════════════════════════════════════════════
-- Migration 016 — New-artist IPO events
-- ════════════════════════════════════════════════════════════════════════════
-- Phase 3 Chunk 2. When a new artist lists, it gets an IPO window —
-- typically 24h — during which the listing is visually flagged across
-- the app (countdown, "IPO" tag on the artist detail) and anyone who
-- buys during the window earns the 'ipo-early-backer' badge.
--
-- v1 scope is intentionally tight:
--   - artist_ipos table holds (ticker, starts_at, ends_at, status) rows
--   - Badge catalog gets 'ipo-early-backer' (rare) +
--     'first-buyer-of-artist' (legendary — only the very first buyer of
--     an IPO, per ticker, ever earns it with that metadata)
--   - Trigger on filled_orders inspects active IPOs and awards badges
--   - An admin RPC (start_artist_ipo) creates new IPOs manually — later
--     this can be called from the fetcher when it detects a new ticker
--
-- What's deferred (intentionally — can layer without schema change):
--   - True auction / clearing-price mechanics
--   - Reservations / limit-style pre-orders for IPOs
--   - Per-IPO price overrides (IPO window currently uses the formula
--     price — the event is about social drama, not price discovery)
--
-- APPLIED VIA SUPABASE MCP on 2026-04-24.
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.artist_ipos (
  ticker        text primary key,
  starts_at     timestamptz not null default now(),
  ends_at       timestamptz not null,
  status        text not null default 'active'
                check (status in ('active', 'ended')),
  created_at    timestamptz default now(),
  check (ends_at > starts_at)
);

create index if not exists artist_ipos_active_idx
  on public.artist_ipos (ends_at)
  where status = 'active';

alter table public.artist_ipos enable row level security;

drop policy if exists "artist_ipos_select_auth" on public.artist_ipos;
create policy "artist_ipos_select_auth"
  on public.artist_ipos for select
  to authenticated using (true);

insert into public.badges (slug, name, description, rarity) values
  ('ipo-early-backer',       'IPO Early Backer',       'Bought a new artist during their 24-hour IPO window.', 'rare'),
  ('first-buyer-of-artist',  'First Buyer',            'Was the very first person to buy a newly-listed artist.', 'legendary')
on conflict (slug) do nothing;

create or replace function public.badges_on_filled_order_ipo()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ipo               record;
  v_already_a_buyer   boolean;
  v_any_prior_buyer   boolean;
begin
  if new.side is distinct from 'buy' then
    return new;
  end if;

  select * into v_ipo
  from artist_ipos
  where ticker = new.ticker
    and status = 'active'
    and now() between starts_at and ends_at;

  if v_ipo.ticker is null then
    return new;
  end if;

  select exists(
    select 1 from filled_orders fo
    where fo.user_id = new.user_id
      and fo.ticker = new.ticker
      and fo.side = 'buy'
      and fo.filled_at < new.filled_at
      and fo.filled_at >= v_ipo.starts_at
  ) into v_already_a_buyer;

  if not v_already_a_buyer then
    perform public.award_badge(new.user_id, 'ipo-early-backer',
      jsonb_build_object(
        'ticker',    new.ticker,
        'ipo_start', v_ipo.starts_at,
        'ipo_end',   v_ipo.ends_at
      ));
  end if;

  select exists(
    select 1 from filled_orders fo
    where fo.ticker = new.ticker
      and fo.side = 'buy'
      and fo.filled_at < new.filled_at
  ) into v_any_prior_buyer;

  if not v_any_prior_buyer then
    perform public.award_badge(new.user_id, 'first-buyer-of-artist',
      jsonb_build_object('ticker', new.ticker));
  end if;

  return new;
end;
$$;

drop trigger if exists on_filled_order_ipo_badges on public.filled_orders;
create trigger on_filled_order_ipo_badges
  after insert on public.filled_orders
  for each row execute function public.badges_on_filled_order_ipo();

create or replace function public.start_artist_ipo(
  p_ticker         text,
  p_duration_hours int default 24
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ticker text := upper(btrim(coalesce(p_ticker, '')));
  v_hours  int  := greatest(1, least(coalesce(p_duration_hours, 24), 168));
  v_ends   timestamptz := now() + (v_hours || ' hours')::interval;
begin
  if char_length(v_ticker) = 0 then
    return jsonb_build_object('error', 'invalid_ticker');
  end if;

  insert into artist_ipos (ticker, starts_at, ends_at, status)
  values (v_ticker, now(), v_ends, 'active')
  on conflict (ticker) do update
    set starts_at = excluded.starts_at,
        ends_at   = excluded.ends_at,
        status    = 'active';

  return jsonb_build_object(
    'ok',       true,
    'ticker',   v_ticker,
    'ends_at',  v_ends
  );
end;
$$;

revoke all    on function public.start_artist_ipo(text, int) from public;
grant execute on function public.start_artist_ipo(text, int) to service_role;

create or replace function public.close_expired_ipos()
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count int;
begin
  update artist_ipos
  set status = 'ended'
  where status = 'active' and ends_at <= now();
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all    on function public.close_expired_ipos() from public;
grant execute on function public.close_expired_ipos() to service_role;

select cron.schedule(
  'close-expired-ipos',
  '15 0 * * *',
  $inner$select public.close_expired_ipos();$inner$
);
