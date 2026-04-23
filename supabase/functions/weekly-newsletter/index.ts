// ════════════════════════════════════════════════════════════════════════════
// Edge Function — weekly-newsletter
// ════════════════════════════════════════════════════════════════════════════
// Triggered every Sunday at 18:00 UTC by pg_cron (migration 010). Sends
// each opted-in user a personalized digest of the week:
//   - Their weekly return-% and rank
//   - Their current season progress
//   - The top 3 traders of the week
//
// Resend API key is stored in vault.secrets (encrypted at rest) and read
// via get_resend_api_key() RPC — plaintext never touches application
// code, logs, or git.
//
// v1 scope: from-address uses onboarding@resend.dev (no domain
// verification needed). For production sends with a muses.exchange
// from-address, verify the domain in Resend dashboard and update
// FROM_ADDRESS below.
// ════════════════════════════════════════════════════════════════════════════

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const APP_URL = 'https://muses.exchange';
const FROM_ADDRESS = 'Muses Exchange <onboarding@resend.dev>';

function escapeHTML(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fmtPct(n: number): string {
  const sign = n >= 0 ? '+' : '';
  return sign + (n || 0).toFixed(2) + '%';
}

function fmtCurrency(n: number): string {
  return '$' + Math.round(n || 0).toLocaleString('en-US');
}

function buildEmail(data: {
  displayName: string;
  weeklyReturn: number;
  weeklyRank: number | null;
  portfolioValue: number;
  seasonName: string;
  seasonReturn: number | null;
  topTraders: Array<{ rank: number; name: string; returnPct: number }>;
  unsubscribeUrl: string;
}): { subject: string; html: string; text: string } {
  const isUp = data.weeklyReturn >= 0;
  const rankLabel = data.weeklyRank ? '#' + data.weeklyRank : 'unranked';
  const subject = `Your Muses week — ${fmtPct(data.weeklyReturn)} (rank ${rankLabel})`;

  const topRows = data.topTraders
    .map(t => `<tr><td style="padding:10px 14px;border-bottom:1px solid #2a2440;color:#8a8a9b;font-size:13px;width:40px">#${t.rank}</td><td style="padding:10px 14px;border-bottom:1px solid #2a2440;color:#fff;font-size:14px">${escapeHTML(t.name)}</td><td style="padding:10px 14px;border-bottom:1px solid #2a2440;color:${t.returnPct >= 0 ? '#6effb8' : '#ff7a7a'};text-align:right;font-size:14px;font-weight:600">${fmtPct(t.returnPct)}</td></tr>`)
    .join('');

  const seasonBlock = data.seasonReturn !== null
    ? `<table width="100%" cellpadding="0" cellspacing="0" style="margin-top:12px"><tr><td style="padding:14px 16px;background:#1a1628;border-radius:10px;border:1px solid #2a2440"><div style="font-size:11px;color:#8a8a9b;text-transform:uppercase;letter-spacing:0.08em">${escapeHTML(data.seasonName)}</div><div style="font-size:18px;font-weight:600;color:${data.seasonReturn >= 0 ? '#6effb8' : '#ff7a7a'};margin-top:4px">${fmtPct(data.seasonReturn)}</div></td></tr></table>`
    : '';

  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>Your Muses week</title></head>
<body style="margin:0;padding:0;background:#0b0910;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#e8e6ea">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0b0910"><tr><td style="padding:40px 20px">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#13101a;border-radius:14px;border:1px solid #2a2440">
<tr><td style="padding:32px 32px 20px">
<div style="font-size:11px;color:#b98fff;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:8px">Muses Exchange · Weekly digest</div>
<h1 style="font-size:24px;font-weight:700;margin:0 0 24px;color:#fff">Your week, ${escapeHTML(data.displayName)}</h1>
<table width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding:18px 20px;background:#1a1628;border-radius:10px;border:1px solid #2a2440">
<div style="font-size:11px;color:#8a8a9b;text-transform:uppercase;letter-spacing:0.08em">Weekly return</div>
<div style="font-size:32px;font-weight:700;color:${isUp ? '#6effb8' : '#ff7a7a'};margin-top:6px">${fmtPct(data.weeklyReturn)}</div>
<div style="font-size:13px;color:#8a8a9b;margin-top:6px">Rank: ${rankLabel} · Portfolio: ${fmtCurrency(data.portfolioValue)}</div>
</td></tr></table>
${seasonBlock}
</td></tr>
<tr><td style="padding:0 32px 20px">
<h2 style="font-size:16px;font-weight:600;margin:20px 0 12px;color:#fff">Top 3 this week</h2>
<table width="100%" cellpadding="0" cellspacing="0" style="background:#1a1628;border-radius:10px;border:1px solid #2a2440;overflow:hidden">${topRows || '<tr><td style="padding:20px;color:#8a8a9b;text-align:center;font-size:13px" colspan="3">Nobody had a close-eligible week yet. Trade more.</td></tr>'}</table>
<div style="margin-top:28px;text-align:center"><a href="${APP_URL}/exchange" style="display:inline-block;padding:12px 28px;background:#8b5cf6;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;font-size:14px">View your portfolio →</a></div>
</td></tr>
<tr><td style="padding:20px 32px;border-top:1px solid #2a2440;text-align:center;font-size:11px;color:#5a5a6a">
Muses Exchange · Paper trading, real data<br>
<a href="${data.unsubscribeUrl}" style="color:#5a5a6a;text-decoration:underline">Unsubscribe from the weekly digest</a>
</td></tr>
</table></td></tr></table></body></html>`;

  const text = `Muses Exchange — Your week\n\nHi ${data.displayName},\n\nWeekly return: ${fmtPct(data.weeklyReturn)}\nRank: ${rankLabel}\nPortfolio: ${fmtCurrency(data.portfolioValue)}\n${data.seasonReturn !== null ? `\n${data.seasonName}: ${fmtPct(data.seasonReturn)}\n` : ''}\nTop 3 traders this week:\n${data.topTraders.length > 0 ? data.topTraders.map(t => `  #${t.rank} ${t.name}: ${fmtPct(t.returnPct)}`).join('\n') : '  (nobody yet)'}\n\nView your portfolio: ${APP_URL}/exchange\n\nUnsubscribe: ${data.unsubscribeUrl}\n`;

  return { subject, html, text };
}

serve(async (_req) => {
  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Resend API key from Supabase Vault.
    const { data: resendKey, error: keyErr } = await admin.rpc('get_resend_api_key');
    if (keyErr || !resendKey) {
      console.error('[newsletter] Failed to read Resend key from vault:', keyErr);
      return new Response(JSON.stringify({ error: 'resend_key_unavailable' }), { status: 500 });
    }

    // Find this week's close. Friday = ISO weekday 5.
    const today = new Date();
    const dayOfWeek = today.getUTCDay();                 // 0=Sun..6=Sat
    const daysSinceFriday = (dayOfWeek - 5 + 7) % 7 || 7; // 0→7 so Friday itself means last Friday
    const weekEnd = new Date(today);
    weekEnd.setUTCDate(weekEnd.getUTCDate() - daysSinceFriday);
    const weekEndStr = weekEnd.toISOString().slice(0, 10);

    // Top 3 traders this week.
    const { data: top } = await admin
      .from('weekly_snapshots')
      .select('user_id, return_pct_week, rank_in_week')
      .eq('week_end', weekEndStr)
      .order('rank_in_week', { ascending: true })
      .limit(3);

    const topUserIds = (top || []).map(r => r.user_id);
    let topNames = new Map<string, string>();
    if (topUserIds.length > 0) {
      const { data: topLb } = await admin
        .from('leaderboard')
        .select('user_id, display_name')
        .in('user_id', topUserIds);
      topNames = new Map((topLb || []).map(r => [r.user_id as string, r.display_name as string]));
    }
    const topTraders = (top || []).map(r => ({
      rank: r.rank_in_week as number,
      name: topNames.get(r.user_id as string) || 'trader',
      returnPct: +r.return_pct_week,
    }));

    // Active season info.
    const { data: seasonsData } = await admin
      .from('seasons')
      .select('id, name')
      .eq('status', 'active')
      .limit(1);
    const activeSeason = (seasonsData || [])[0];

    // Iterate subscribed users.
    const { data: subs } = await admin
      .from('email_subscriptions')
      .select('user_id, unsubscribe_token')
      .eq('weekly_newsletter', true);

    let sent = 0;
    let failed = 0;
    let skipped = 0;

    for (const sub of (subs || [])) {
      try {
        const { data: userData } = await admin.auth.admin.getUserById(sub.user_id as string);
        const email = userData?.user?.email;
        if (!email) { skipped++; continue; }

        const { data: snap } = await admin
          .from('weekly_snapshots')
          .select('return_pct_week, rank_in_week, portfolio_value_end')
          .eq('week_end', weekEndStr)
          .eq('user_id', sub.user_id as string)
          .limit(1);
        const snapshot = (snap || [])[0];
        if (!snapshot) { skipped++; continue; }

        const { data: lbRows } = await admin
          .from('leaderboard')
          .select('display_name, season_return_pct')
          .eq('user_id', sub.user_id as string)
          .limit(1);
        const lb = (lbRows || [])[0];

        const displayName = (lb?.display_name && String(lb.display_name).trim()) || email.split('@')[0] || 'trader';
        const unsubscribeUrl = `${SUPABASE_URL}/functions/v1/unsubscribe?token=${sub.unsubscribe_token}`;

        const { subject, html, text } = buildEmail({
          displayName,
          weeklyReturn: +snapshot.return_pct_week,
          weeklyRank: snapshot.rank_in_week as number | null,
          portfolioValue: +snapshot.portfolio_value_end,
          seasonName: activeSeason?.name || 'This season',
          seasonReturn: lb?.season_return_pct != null ? +lb.season_return_pct : null,
          topTraders,
          unsubscribeUrl,
        });

        const resendRes = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${resendKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: FROM_ADDRESS,
            to: [email],
            subject,
            html,
            text,
            headers: {
              'List-Unsubscribe': `<${unsubscribeUrl}>`,
              'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
            },
          }),
        });

        if (resendRes.ok) {
          sent++;
          await admin
            .from('email_subscriptions')
            .update({ last_sent_at: new Date().toISOString() })
            .eq('user_id', sub.user_id as string);
        } else {
          const errText = await resendRes.text();
          console.warn(`[newsletter] Resend failed for ${sub.user_id}: ${resendRes.status} ${errText}`);
          failed++;
        }
      } catch (e) {
        console.warn(`[newsletter] Error for user ${sub.user_id}:`, (e as Error).message);
        failed++;
      }
    }

    return new Response(
      JSON.stringify({ ok: true, week_end: weekEndStr, sent, failed, skipped }),
      { headers: { 'Content-Type': 'application/json' } },
    );
  } catch (e) {
    console.error('[newsletter] Top-level error:', e);
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500 });
  }
});
