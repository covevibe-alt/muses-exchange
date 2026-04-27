-- ════════════════════════════════════════════════════════════════════════════
-- Migration 023 — Referral system (Chunk E.2)
-- ════════════════════════════════════════════════════════════════════════════
-- New column on profiles:
--   • referred_by uuid — points at the user who referred this account.
--     Set ONCE at signup (idempotent — no self-referrals).
--
-- New table:
--   • referrals(id, referrer_id, referee_id, status, granted_at)
--     status ∈ ('pending', 'granted'). Inserted at signup with status='pending'
--     when set_referrer() runs. Flipped to 'granted' on first filled order.
--
-- New RPCs:
--   • set_referrer(p_referrer_handle text)  — called from frontend after
--     signup if a ?ref=USERNAME URL param was captured. Idempotent.
--   • get_my_referral_stats() — returns the calling user's referral counts
--     + total credits earned, for the profile widget.
--
-- New trigger:
--   • trg_grant_referral_on_first_trade — on first INSERT into filled_orders
--     for a given user, flips their pending referral row to 'granted',
--     credits the referrer's prediction_balances by $1000, and awards the
--     referrer the 'referrer' (Talent Scout) badge.
--
-- APPLIED VIA SUPABASE MCP on 2026-04-27.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.profiles
  add column if not exists referred_by uuid references auth.users(id) on delete set null;

create index if not exists profiles_referred_by_idx on public.profiles (referred_by);

create table if not exists public.referrals (
  id           bigserial primary key,
  referrer_id  uuid not null references auth.users(id) on delete cascade,
  referee_id   uuid not null references auth.users(id) on delete cascade,
  status       text not null default 'pending' check (status in ('pending','granted')),
  created_at   timestamptz not null default now(),
  granted_at   timestamptz,
  unique (referee_id)
);

create index if not exists referrals_referrer_idx on public.referrals (referrer_id);
create index if not exists referrals_status_idx   on public.referrals (status);

alter table public.referrals enable row level security;

drop policy if exists "referrals_select_own" on public.referrals;
create policy "referrals_select_own" on public.referrals
  for select to authenticated
  using (auth.uid() = referrer_id or auth.uid() = referee_id);

create or replace function public.set_referrer(p_referrer_handle text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id     uuid := auth.uid();
  v_handle      text := lower(btrim(coalesce(p_referrer_handle, '')));
  v_referrer_id uuid;
  v_already     uuid;
begin
  if v_user_id is null then
    return jsonb_build_object('error', 'not_authenticated');
  end if;
  if v_handle is null or char_length(v_handle) = 0 then
    return jsonb_build_object('error', 'invalid_handle');
  end if;

  select referred_by into v_already from profiles where user_id = v_user_id;
  if v_already is not null then
    return jsonb_build_object('ok', true, 'note', 'already_set');
  end if;

  select user_id into v_referrer_id
  from profiles
  where lower(handle) = v_handle
  limit 1;

  if v_referrer_id is null then
    return jsonb_build_object('error', 'referrer_not_found');
  end if;
  if v_referrer_id = v_user_id then
    return jsonb_build_object('error', 'self_referral_not_allowed');
  end if;

  update profiles set referred_by = v_referrer_id where user_id = v_user_id;

  insert into referrals (referrer_id, referee_id, status)
  values (v_referrer_id, v_user_id, 'pending')
  on conflict (referee_id) do nothing;

  return jsonb_build_object('ok', true, 'referrer_id', v_referrer_id);
end;
$$;

revoke all    on function public.set_referrer(text) from public;
grant execute on function public.set_referrer(text) to authenticated;

create or replace function public._grant_referral_on_first_trade()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_referrer_id  uuid;
  v_prior_count  int;
  v_referrer_badge_id int;
  v_referral_grant_amount numeric := 1000;
begin
  select count(*) into v_prior_count
  from filled_orders
  where user_id = new.user_id and filled_at < new.filled_at;

  if v_prior_count > 0 then
    return new;
  end if;

  select referred_by into v_referrer_id
  from profiles where user_id = new.user_id;

  if v_referrer_id is null then
    return new;
  end if;

  insert into referrals (referrer_id, referee_id, status, granted_at)
  values (v_referrer_id, new.user_id, 'granted', now())
  on conflict (referee_id) do update set
    status     = 'granted',
    granted_at = now()
  where referrals.status = 'pending';

  perform public.ensure_prediction_balance(v_referrer_id);
  update prediction_balances
  set balance    = balance + v_referral_grant_amount,
      updated_at = now()
  where user_id = v_referrer_id;

  select id into v_referrer_badge_id from badges where slug = 'referrer';
  if v_referrer_badge_id is not null then
    insert into user_badges (user_id, badge_id)
    values (v_referrer_id, v_referrer_badge_id)
    on conflict (user_id, badge_id) do nothing;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_grant_referral_on_first_trade on public.filled_orders;
create trigger trg_grant_referral_on_first_trade
  after insert on public.filled_orders
  for each row
  execute function public._grant_referral_on_first_trade();

create or replace function public.get_my_referral_stats()
returns jsonb
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  with r as (
    select
      count(*) filter (where status = 'pending') as pending_count,
      count(*) filter (where status = 'granted') as granted_count
    from referrals where referrer_id = auth.uid()
  ),
  me as (
    select handle from profiles where user_id = auth.uid()
  )
  select jsonb_build_object(
    'handle',         (select handle from me),
    'pending_count',  coalesce((select pending_count from r), 0),
    'granted_count',  coalesce((select granted_count from r), 0),
    'total_credits',  coalesce((select granted_count from r), 0) * 1000
  );
$$;

revoke all    on function public.get_my_referral_stats() from public;
grant execute on function public.get_my_referral_stats() to authenticated;
