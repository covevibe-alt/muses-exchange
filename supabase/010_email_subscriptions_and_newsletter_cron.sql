-- ════════════════════════════════════════════════════════════════════════════
-- Migration 010 — Email subscriptions + Sunday newsletter cron
-- ════════════════════════════════════════════════════════════════════════════
-- Phase 1 Chunk 3 — automated Sunday digest.
--
--   • email_subscriptions: per-user opt-out state + unsubscribe_token
--   • get_resend_api_key(): security-definer helper to read the Resend API
--     key from vault.decrypted_secrets. Only callable by service_role so
--     the key stays encrypted at rest and never materializes in client JS.
--   • pg_cron job every Sunday at 18:00 UTC triggers the weekly-newsletter
--     Edge Function via pg_net.
--
-- Edge Function auth: verify_jwt=false for the weekly-newsletter endpoint.
-- The newsletter function is self-contained (iterates all users, sends
-- emails) and doesn't accept inputs — a bad-faith curl just triggers an
-- early send. Low blast radius; hardening can come later via a shared
-- cron secret if needed.
--
-- APPLIED VIA SUPABASE MCP on 2026-04-23.
-- Companion Edge Functions deployed in the same change:
--   - weekly-newsletter (verify_jwt=false)
--   - unsubscribe      (verify_jwt=false)
--
-- The Resend API key lives in vault.secrets (encrypted at rest). To rotate:
--   select vault.update_secret(
--     (select id from vault.secrets where name = 'resend_api_key'),
--     '<new-key>'
--   );
-- ════════════════════════════════════════════════════════════════════════════

-- ──────────────────────────────────────────────────────────────────────
-- email_subscriptions
-- ──────────────────────────────────────────────────────────────────────
create table if not exists public.email_subscriptions (
  user_id             uuid primary key references auth.users(id) on delete cascade,
  weekly_newsletter   boolean not null default true,
  unsubscribe_token   uuid not null default gen_random_uuid(),
  last_sent_at        timestamptz,
  unsubscribed_at     timestamptz,
  created_at          timestamptz default now()
);

create unique index if not exists email_subscriptions_token_idx
  on public.email_subscriptions (unsubscribe_token);

-- RLS: users read + update their own row. The unsubscribe Edge Function
-- uses service_role so it isn't subject to these policies.
alter table public.email_subscriptions enable row level security;

drop policy if exists "email_subs_select_own" on public.email_subscriptions;
create policy "email_subs_select_own"
  on public.email_subscriptions for select
  to authenticated using (auth.uid() = user_id);

drop policy if exists "email_subs_update_own" on public.email_subscriptions;
create policy "email_subs_update_own"
  on public.email_subscriptions for update
  to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Auto-create subscription row on signup — mirrors the existing
-- handle_new_user trigger pattern from migration 002.
create or replace function public.handle_new_user_email_subscription()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.email_subscriptions (user_id)
  values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_email_sub on auth.users;
create trigger on_auth_user_created_email_sub
  after insert on auth.users
  for each row execute function public.handle_new_user_email_subscription();

-- Backfill: existing users get subscription rows immediately.
insert into public.email_subscriptions (user_id)
select id from auth.users
on conflict (user_id) do nothing;

-- ──────────────────────────────────────────────────────────────────────
-- get_resend_api_key()
-- ──────────────────────────────────────────────────────────────────────
-- Security-definer RPC. The Edge Function calls this over the service-role
-- client; plaintext never leaves the function's process memory. The vault
-- row is encrypted at rest (pgsodium under the hood).
create or replace function public.get_resend_api_key()
returns text
language sql
security definer
set search_path = public, vault, pg_temp
stable
as $$
  select decrypted_secret
  from vault.decrypted_secrets
  where name = 'resend_api_key'
  limit 1;
$$;

revoke all    on function public.get_resend_api_key() from public;
grant execute on function public.get_resend_api_key() to service_role;

-- ──────────────────────────────────────────────────────────────────────
-- Schedule the cron job
-- ──────────────────────────────────────────────────────────────────────
-- Sunday 18:00 UTC: trigger weekly-newsletter Edge Function.
-- pg_net is async — the http_post returns immediately with a request_id.
-- The Edge Function handles everything; cron's job is just to fire it.
select cron.schedule(
  'weekly-newsletter',
  '0 18 * * 0',
  $inner$
    select net.http_post(
      url     := 'https://bhyjdvqbfearmrkxvppl.supabase.co/functions/v1/weekly-newsletter',
      headers := jsonb_build_object('Content-Type', 'application/json'),
      body    := '{}'::jsonb
    );
  $inner$
);
