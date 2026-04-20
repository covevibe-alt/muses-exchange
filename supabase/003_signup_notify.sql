-- ════════════════════════════════════════════════════════════════════════════
-- Migration 003 — Signup notification trigger
-- ════════════════════════════════════════════════════════════════════════════
-- Fires an email to sandertbroeke@hotmail.com via the Resend HTTP API every
-- time a row is inserted into auth.users (i.e. someone signs up on Muses).
--
-- Uses:
--   - pg_net          → async HTTP from inside Postgres (ships w/ Supabase)
--   - Supabase Vault  → stores the Resend API key so it's never in code
--
-- One-time setup OUTSIDE this migration (do this after applying the SQL):
--   1. Supabase dashboard → Project Settings → Vault → "Add new secret"
--        name:  resend_api_key
--        value: re_...your Resend API key...
--      Without this secret set, the trigger is a safe no-op — no email fires,
--      signup still succeeds.
--
-- Deliberate choices:
--   - Trigger on auth.users, not public.profiles → I want to hear about every
--     signup *attempt*, including ones that never confirm their email. That's
--     the signal I actually care about at this stage.
--   - SECURITY DEFINER + pinned search_path → function needs vault access, which
--     regular callers don't have. Pinning search_path defends against search-
--     path hijacking when running as elevated role.
--   - Swallow-and-log errors → a broken notification must never block a signup.
-- ════════════════════════════════════════════════════════════════════════════

-- pg_net: ships with Supabase but must be enabled per project.
create extension if not exists pg_net with schema extensions;


create or replace function public.notify_signup()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
declare
  api_key text;
  request_id bigint;
begin
  -- Pull the Resend key out of Vault. If it isn't configured yet, silently
  -- skip — we never want the notification path to break signup.
  select decrypted_secret
    into api_key
    from vault.decrypted_secrets
    where name = 'resend_api_key'
    limit 1;

  if api_key is null or api_key = '' then
    return new;
  end if;

  -- Fire-and-forget POST. pg_net queues the request on its own worker, so
  -- the signup transaction is not blocked on Resend's response.
  select net.http_post(
    url := 'https://api.resend.com/emails',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || api_key
    ),
    body := jsonb_build_object(
      'from',    'Muses <hello@muses.exchange>',
      'to',      jsonb_build_array('sandertbroeke@hotmail.com'),
      'subject', 'New Muses signup: ' || coalesce(new.email, '(no email)'),
      'html',    format(
        '<div style="font-family:-apple-system,Segoe UI,Arial,sans-serif;font-size:14px;line-height:1.6;color:#111;">'
        || '<p><strong>New signup on muses.exchange</strong></p>'
        || '<p>Email: <code>%s</code><br>'
        || 'User ID: <code>%s</code><br>'
        || 'Created: %s</p>'
        || '<p style="color:#666;font-size:12px;">This is an automated notification. '
        || 'Nothing to do — they will receive their confirmation email separately.</p>'
        || '</div>',
        coalesce(new.email, ''),
        new.id,
        new.created_at
      )
    )
  ) into request_id;

  return new;

exception when others then
  -- Log and move on — signups must never fail because of this trigger.
  raise log 'notify_signup failed: %', sqlerrm;
  return new;
end;
$$;


-- (Re)install the trigger. Drop-then-create so reapplying the migration is
-- idempotent.
drop trigger if exists on_auth_user_created_notify on auth.users;

create trigger on_auth_user_created_notify
  after insert on auth.users
  for each row
  execute function public.notify_signup();
