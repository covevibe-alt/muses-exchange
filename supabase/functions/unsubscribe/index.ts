// ════════════════════════════════════════════════════════════════════════════
// Edge Function — unsubscribe
// ════════════════════════════════════════════════════════════════════════════
// One-click unsubscribe link target. Takes ?token=<uuid> from the email
// footer, flips email_subscriptions.weekly_newsletter to false, returns
// a minimal HTML confirmation page.
//
// Supports both GET (user clicks the footer link) and POST (RFC 8058
// List-Unsubscribe=One-Click header from Gmail/Outlook).
// ════════════════════════════════════════════════════════════════════════════

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

function htmlPage(title: string, body: string, status = 200): Response {
  const page = `<!doctype html>
<html><head><meta charset="utf-8"><title>${title} — Muses Exchange</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body { margin: 0; background: #0b0910; color: #e8e6ea; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; min-height: 100vh; display: flex; align-items: center; justify-content: center; }
  .card { max-width: 480px; margin: 40px 20px; padding: 40px 32px; background: #13101a; border-radius: 14px; border: 1px solid #2a2440; text-align: center; }
  h1 { font-size: 22px; font-weight: 700; margin: 0 0 12px; color: #fff; }
  p  { font-size: 14px; color: #aaa; line-height: 1.6; margin: 8px 0; }
  a  { color: #b98fff; text-decoration: none; }
</style></head>
<body><div class="card"><h1>${title}</h1>${body}<p style="margin-top:24px;font-size:12px;color:#5a5a6a"><a href="https://muses.exchange">Back to Muses Exchange</a></p></div></body></html>`;
  return new Response(page, { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

serve(async (req) => {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return htmlPage('Method not allowed', '<p>Use the unsubscribe link from your email.</p>', 405);
  }

  const url = new URL(req.url);
  const token = url.searchParams.get('token');
  if (!token) {
    return htmlPage('Invalid link', '<p>This unsubscribe link is missing a token. Please use the link from your most recent Muses email.</p>', 400);
  }

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: rows, error: findErr } = await admin
    .from('email_subscriptions')
    .select('user_id, weekly_newsletter')
    .eq('unsubscribe_token', token)
    .limit(1);

  if (findErr) {
    console.warn('[unsubscribe] Lookup failed:', findErr.message);
    return htmlPage('Something went wrong', '<p>We could not process your request. Please try again in a few minutes.</p>', 500);
  }

  const sub = (rows || [])[0];
  if (!sub) {
    return htmlPage('Link expired', '<p>This unsubscribe link is no longer valid. If you still want to unsubscribe, open the latest Muses email and click the link there.</p>', 404);
  }

  if (!sub.weekly_newsletter) {
    return htmlPage("You're already unsubscribed", '<p>You will not receive any more weekly emails from Muses Exchange.</p>');
  }

  const { error: updErr } = await admin
    .from('email_subscriptions')
    .update({ weekly_newsletter: false, unsubscribed_at: new Date().toISOString() })
    .eq('user_id', sub.user_id);

  if (updErr) {
    console.warn('[unsubscribe] Update failed:', updErr.message);
    return htmlPage('Something went wrong', '<p>We could not save your preference. Please try again in a few minutes.</p>', 500);
  }

  return htmlPage("You're unsubscribed", '<p>You will not receive any more weekly emails from Muses Exchange.</p><p>You can re-subscribe any time from Settings → Notifications inside the app.</p>');
});
