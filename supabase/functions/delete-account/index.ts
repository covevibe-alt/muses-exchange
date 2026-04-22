// ════════════════════════════════════════════════════════════════════════════
// Edge Function — delete-account
// ════════════════════════════════════════════════════════════════════════════
// GDPR Art. 17 self-service deletion endpoint. Called by the exchange client
// when the user taps "Delete my account" in Settings → Account.
//
// Why an Edge Function, not client-side:
//   The browser uses the anon key, which cannot call auth.admin.deleteUser().
//   The service-role key, which can, must never ship to the client. This
//   function sits between the two: it takes the user's JWT, confirms it's
//   valid, extracts the sub (user id) from it, then uses the service role
//   to delete that specific user and only that user.
//
// All user-owned rows in the public schema reference auth.users(id) with
// ON DELETE CASCADE, so deleting the auth user automatically sweeps:
//   - public.portfolios
//   - public.profiles
//   - public.holdings
//   - public.transactions
//   - public.open_orders
//   - public.filled_orders
//   - public.leaderboard
//
// If we ever add a user-owned table without cascade, add its cleanup here
// BEFORE the admin.deleteUser call — otherwise the orphan rows become RLS
// inaccessible (their user_id no longer resolves) but still occupy space.
// ════════════════════════════════════════════════════════════════════════════

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

serve(async (req) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }
  if (req.method !== 'POST') {
    return json({ error: 'method_not_allowed' }, 405);
  }

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
  const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY');
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
    return json({ error: 'server_misconfigured' }, 500);
  }

  // Extract the caller's JWT from Authorization: Bearer …
  const authHeader = req.headers.get('Authorization') ?? '';
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  const jwt = match?.[1];
  if (!jwt) {
    return json({ error: 'missing_authorization' }, 401);
  }

  // Use an anon-key client with the user's JWT to verify the token and
  // resolve the user id. This is the same pattern Supabase recommends:
  // never trust a user_id from the request body; always derive it from the
  // JWT the anon client just validated.
  const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });

  const { data: userData, error: userErr } = await anonClient.auth.getUser();
  if (userErr || !userData?.user) {
    return json({ error: 'invalid_token' }, 401);
  }
  const userId = userData.user.id;

  // Escalate to the service-role client to call admin.deleteUser.
  const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Belt-and-braces: clear the snapshot column first in case something
  // breaks the cascade in a future migration. If the cascade works as
  // expected, the row is gone after admin.deleteUser anyway.
  try {
    await adminClient
      .from('portfolios')
      .update({ snapshot: null })
      .eq('user_id', userId);
  } catch (_e) {
    // Non-fatal — continue to the admin delete.
  }

  const { error: delErr } = await adminClient.auth.admin.deleteUser(userId);
  if (delErr) {
    return json({ error: 'delete_failed', detail: delErr.message }, 500);
  }

  return json({ ok: true, user_id: userId });
});
