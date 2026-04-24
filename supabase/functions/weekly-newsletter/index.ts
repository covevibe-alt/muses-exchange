// ════════════════════════════════════════════════════════════════════════════
// Edge Function — weekly-newsletter (v2)
// ════════════════════════════════════════════════════════════════════════════
// Triggered Sundays at 18:00 UTC by pg_cron. Sends each opted-in user a
// personalized digest with:
//   - Weekly P&L + rank + portfolio value
//   - Season progress (if participating)
//   - Biggest winner + biggest loser in THEIR holdings (24h)
//   - Market-wide top 3 gainers + top 3 losers (24h)
//   - Top 3 traders of the week
//
// Prices pulled from the static prices.js served by the live site — the
// same file the exchange client reads, so market context stays in sync
// without duplicating the fetcher infra. Holdings come from portfolios.snapshot.
//
// Resend API key read from vault.secrets via get_resend_api_key() RPC.
// Plaintext never touches code, logs, or git.
// ════════════════════════════════════════════════════════════════════════════

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const APP_URL = 'https://muses.exchange';
const FROM_ADDRESS = 'Muses Exchange <onboarding@resend.dev>';

type PriceArtist = { ticker: string; name: string; price: number; chg24h?: number; change24h?: number; genre?: string };
type PricesJson = {
  updatedAt?: string;
  marketIndex?: number;
  topGainers?: Array<{ ticker: string; chg24h: number }>;
  topLosers?: Array<{ ticker: string; chg24h: number }>;
  artists?: PriceArtist[];
};

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
function upHex(up: boolean): string { return up ? '#6effb8' : '#ff7a7a'; }

async function fetchPrices(): Promise<PricesJson | null> {
  try {
    const res = await fetch(APP_URL + '/app/prices.js', { headers: { 'Cache-Control': 'no-cache' } });
    if (!res.ok) return null;
    const text = await res.text();
    const m = text.match(/window\.__MUSE_PRICES\s*=\s*(\{[\s\S]*?\})\s*;?\s*$/);
    if (!m) return null;
    return JSON.parse(m[1]) as PricesJson;
  } catch (e) {
    console.warn('[newsletter] fetchPrices failed:', (e as Error).message);
    return null;
  }
}

function computeHoldingsMovers(holdings: Record<string, unknown>, artistsByTicker: Map<string, PriceArtist>) {
  const entries: Array<{ ticker: string; name: string; chg: number; value: number }> = [];
  for (const [ticker, raw] of Object.entries(holdings || {})) {
    const h = raw as { shares?: number; qty?: number; avgCost?: number; avg_cost?: number };
    const qty = h.shares ?? h.qty ?? 0;
    if (!qty) continue;
    const a = artistsByTicker.get(ticker);
    if (!a) continue;
    const chg = a.chg24h ?? a.change24h ?? 0;
    entries.push({ ticker, name: a.name || ticker, chg, value: qty * a.price });
  }
  if (!entries.length) return { winner: null, loser: null };
  entries.sort((a, b) => b.chg - a.chg);
  return {
    winner: entries[0],
    loser: entries[entries.length - 1],
  };
}

function buildEmail(data: {
  displayName: string;
  weeklyReturn: number;
  weeklyRank: number | null;
  portfolioValue: number;
  seasonName: string;
  seasonReturn: number | null;
  topTraders: Array<{ rank: number; name: string; returnPct: number }>;
  topMarketGainers: Array<{ ticker: string; name: string; chg: number }>;
  topMarketLosers: Array<{ ticker: string; name: string; chg: number }>;
  holdingWinner: { ticker: string; name: string; chg: number; value: number } | null;
  holdingLoser:  { ticker: string; name: string; chg: number; value: number } | null;
  unsubscribeUrl: string;
}): { subject: string; html: string; text: string } {
  const isUp = data.weeklyReturn >= 0;
  const rankLabel = data.weeklyRank ? '#' + data.weeklyRank : '—';
  const subject = `Your Muses week — ${fmtPct(data.weeklyReturn)} (rank ${rankLabel})`;

  const dateStr = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  const trow = (t: { rank: number; name: string; returnPct: number }) =>
    `<tr><td style="padding:12px 16px;border-bottom:1px solid #2a2440;color:#8a8a9b;font-size:13px;width:44px">#${t.rank}</td><td style="padding:12px 16px;border-bottom:1px solid #2a2440;color:#fff;font-size:14px">${escapeHTML(t.name)}</td><td style="padding:12px 16px;border-bottom:1px solid #2a2440;color:${upHex(t.returnPct >= 0)};text-align:right;font-size:14px;font-weight:600;font-variant-numeric:tabular-nums">${fmtPct(t.returnPct)}</td></tr>`;

  const mrow = (m: { ticker: string; name: string; chg: number }) =>
    `<tr><td style="padding:10px 16px;border-bottom:1px solid #2a2440;color:#b98fff;font-size:13px;font-weight:600;font-family:'SF Mono',Monaco,monospace;width:70px">$${escapeHTML(m.ticker)}</td><td style="padding:10px 16px;border-bottom:1px solid #2a2440;color:#e8e6ea;font-size:13px">${escapeHTML(m.name)}</td><td style="padding:10px 16px;border-bottom:1px solid #2a2440;color:${upHex(m.chg >= 0)};text-align:right;font-size:13px;font-weight:600;font-variant-numeric:tabular-nums">${fmtPct(m.chg)}</td></tr>`;

  const topTradersRows = data.topTraders.length > 0
    ? data.topTraders.map(trow).join('')
    : `<tr><td colspan="3" style="padding:22px 16px;color:#8a8a9b;text-align:center;font-size:13px">No close-eligible traders yet. Trade more to appear here.</td></tr>`;

  const gainersRows = data.topMarketGainers.length > 0
    ? data.topMarketGainers.map(mrow).join('')
    : `<tr><td colspan="3" style="padding:18px 16px;color:#8a8a9b;text-align:center;font-size:13px">Market data unavailable this week.</td></tr>`;
  const losersRows = data.topMarketLosers.length > 0
    ? data.topMarketLosers.map(mrow).join('')
    : '';

  const seasonBlock = data.seasonReturn !== null
    ? `<table width="100%" cellpadding="0" cellspacing="0" style="margin-top:10px"><tr><td style="padding:14px 18px;background:linear-gradient(135deg,rgba(185,143,255,0.10),rgba(185,143,255,0.02));border-radius:12px;border:1px solid rgba(185,143,255,0.24)"><div style="font-size:10px;color:#b98fff;text-transform:uppercase;letter-spacing:0.1em;font-weight:600">${escapeHTML(data.seasonName)}</div><div style="font-size:18px;font-weight:700;color:${upHex(data.seasonReturn >= 0)};margin-top:4px;font-variant-numeric:tabular-nums">${fmtPct(data.seasonReturn)}</div></td></tr></table>`
    : '';

  const holdingsBlock = (data.holdingWinner || data.holdingLoser) ? `
<tr><td style="padding:10px 36px 0">
  <h2 style="font-size:11px;font-weight:600;margin:0 0 14px;color:#b98fff;text-transform:uppercase;letter-spacing:0.12em">Your Holdings (24h)</h2>
  <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;border-spacing:8px 0">
    <tr>
      ${data.holdingWinner ? `
      <td style="width:50%;padding:16px 18px;background:rgba(110,255,184,0.06);border:1px solid rgba(110,255,184,0.22);border-radius:12px;vertical-align:top">
        <div style="font-size:10px;color:#6effb8;text-transform:uppercase;letter-spacing:0.1em;font-weight:600">Best mover</div>
        <div style="font-size:15px;font-weight:700;color:#fff;margin-top:6px">${escapeHTML(data.holdingWinner.name)}</div>
        <div style="font-size:11px;color:#8a8a9b;margin-top:2px;font-family:'SF Mono',Monaco,monospace">$${escapeHTML(data.holdingWinner.ticker)}</div>
        <div style="font-size:18px;font-weight:700;color:#6effb8;margin-top:10px;font-variant-numeric:tabular-nums">${fmtPct(data.holdingWinner.chg)}</div>
      </td>` : '<td style="width:50%"></td>'}
      ${data.holdingLoser && data.holdingLoser.ticker !== (data.holdingWinner && data.holdingWinner.ticker) ? `
      <td style="width:50%;padding:16px 18px;background:rgba(255,122,122,0.06);border:1px solid rgba(255,122,122,0.22);border-radius:12px;vertical-align:top">
        <div style="font-size:10px;color:#ff7a7a;text-transform:uppercase;letter-spacing:0.1em;font-weight:600">Worst mover</div>
        <div style="font-size:15px;font-weight:700;color:#fff;margin-top:6px">${escapeHTML(data.holdingLoser.name)}</div>
        <div style="font-size:11px;color:#8a8a9b;margin-top:2px;font-family:'SF Mono',Monaco,monospace">$${escapeHTML(data.holdingLoser.ticker)}</div>
        <div style="font-size:18px;font-weight:700;color:#ff7a7a;margin-top:10px;font-variant-numeric:tabular-nums">${fmtPct(data.holdingLoser.chg)}</div>
      </td>` : '<td style="width:50%"></td>'}
    </tr>
  </table>
</td></tr>` : '';

  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>Your Muses week</title></head>
<body style="margin:0;padding:0;background:#08060c;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#e8e6ea">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#08060c"><tr><td style="padding:40px 16px">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background:#13101a;border-radius:18px;border:1px solid #2a2440;overflow:hidden">

<tr><td style="padding:32px 36px 24px;background:linear-gradient(135deg,rgba(139,92,246,0.14),rgba(139,92,246,0.02) 60%,transparent)">
  <div style="display:inline-block;font-size:10px;font-weight:600;color:#b98fff;text-transform:uppercase;letter-spacing:0.15em;padding:4px 10px;background:rgba(185,143,255,0.12);border-radius:999px;border:1px solid rgba(185,143,255,0.28)">Sunday digest · ${escapeHTML(dateStr)}</div>
  <h1 style="font-size:26px;font-weight:700;margin:18px 0 6px;color:#fff;letter-spacing:-0.01em">Your week, ${escapeHTML(data.displayName)}</h1>
  <div style="font-size:14px;color:#8a8a9b;margin:0">Here's where you landed and what moved around you.</div>
</td></tr>

<tr><td style="padding:24px 36px 4px">
  <table width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding:22px 24px;background:#1a1628;border-radius:14px;border:1px solid #2a2440">
    <div style="font-size:10px;color:#8a8a9b;text-transform:uppercase;letter-spacing:0.12em;font-weight:600">Weekly return</div>
    <div style="font-size:36px;font-weight:800;color:${upHex(isUp)};margin-top:8px;letter-spacing:-0.01em;font-variant-numeric:tabular-nums">${fmtPct(data.weeklyReturn)}</div>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:14px">
      <tr>
        <td style="font-size:11px;color:#8a8a9b;text-transform:uppercase;letter-spacing:0.08em;padding-right:16px">Rank<br><span style="font-size:15px;font-weight:700;color:#fff;text-transform:none;letter-spacing:normal;display:inline-block;margin-top:4px">${rankLabel}</span></td>
        <td style="font-size:11px;color:#8a8a9b;text-transform:uppercase;letter-spacing:0.08em">Portfolio<br><span style="font-size:15px;font-weight:700;color:#fff;text-transform:none;letter-spacing:normal;display:inline-block;margin-top:4px">${fmtCurrency(data.portfolioValue)}</span></td>
      </tr>
    </table>
  </td></tr></table>
  ${seasonBlock}
</td></tr>

${holdingsBlock}

<tr><td style="padding:22px 36px 4px">
  <h2 style="font-size:11px;font-weight:600;margin:14px 0 14px;color:#b98fff;text-transform:uppercase;letter-spacing:0.12em">Market Movers (24h)</h2>
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#1a1628;border-radius:12px;border:1px solid #2a2440;overflow:hidden">
    <tr><td style="padding:10px 16px;background:rgba(110,255,184,0.06);color:#6effb8;font-size:10px;text-transform:uppercase;letter-spacing:0.1em;font-weight:600">Top gainers</td></tr>
    ${gainersRows}
    ${losersRows ? `<tr><td style="padding:10px 16px;background:rgba(255,122,122,0.06);color:#ff7a7a;font-size:10px;text-transform:uppercase;letter-spacing:0.1em;font-weight:600;border-top:1px solid #2a2440">Top losers</td></tr>${losersRows}` : ''}
  </table>
</td></tr>

<tr><td style="padding:22px 36px 4px">
  <h2 style="font-size:11px;font-weight:600;margin:14px 0 14px;color:#b98fff;text-transform:uppercase;letter-spacing:0.12em">Top 3 traders this week</h2>
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#1a1628;border-radius:12px;border:1px solid #2a2440;overflow:hidden">${topTradersRows}</table>
</td></tr>

<tr><td style="padding:32px 36px 36px;text-align:center">
  <a href="${APP_URL}/exchange" style="display:inline-block;padding:14px 32px;background:#8b5cf6;color:#fff;text-decoration:none;border-radius:10px;font-weight:700;font-size:14px;letter-spacing:0.01em;box-shadow:0 8px 24px -8px rgba(139,92,246,0.5)">Open your portfolio →</a>
  <div style="font-size:12px;color:#5a5a6a;margin-top:14px">See the full leaderboard, your matchup, and live prices.</div>
</td></tr>

<tr><td style="padding:22px 36px 26px;border-top:1px solid #2a2440;text-align:center;font-size:11px;color:#5a5a6a;background:#0f0d17">
  Muses Exchange · Paper trading, real data<br>
  <a href="${data.unsubscribeUrl}" style="color:#5a5a6a;text-decoration:underline">Unsubscribe from the weekly digest</a>
</td></tr>

</table></td></tr></table></body></html>`;

  const holdingsText = (data.holdingWinner || data.holdingLoser)
    ? `\nYour holdings (24h):${data.holdingWinner ? `\n  Best: ${data.holdingWinner.name} ($${data.holdingWinner.ticker}) ${fmtPct(data.holdingWinner.chg)}` : ''}${data.holdingLoser && data.holdingLoser.ticker !== (data.holdingWinner && data.holdingWinner.ticker) ? `\n  Worst: ${data.holdingLoser.name} ($${data.holdingLoser.ticker}) ${fmtPct(data.holdingLoser.chg)}` : ''}\n`
    : '';

  const gainersText = data.topMarketGainers.length
    ? '\nMarket top gainers (24h):\n' + data.topMarketGainers.map(m => `  $${m.ticker}  ${m.name}  ${fmtPct(m.chg)}`).join('\n') + '\n'
    : '';
  const losersText = data.topMarketLosers.length
    ? 'Market top losers (24h):\n' + data.topMarketLosers.map(m => `  $${m.ticker}  ${m.name}  ${fmtPct(m.chg)}`).join('\n') + '\n'
    : '';

  const text = `Muses Exchange — Your week\n\nHi ${data.displayName},\n\nWeekly return: ${fmtPct(data.weeklyReturn)}\nRank: ${rankLabel}\nPortfolio: ${fmtCurrency(data.portfolioValue)}\n${data.seasonReturn !== null ? `\n${data.seasonName}: ${fmtPct(data.seasonReturn)}\n` : ''}${holdingsText}${gainersText}${losersText}\nTop 3 traders this week:\n${data.topTraders.length > 0 ? data.topTraders.map(t => `  #${t.rank} ${t.name}: ${fmtPct(t.returnPct)}`).join('\n') : '  (nobody yet)'}\n\nOpen your portfolio: ${APP_URL}/exchange\n\nUnsubscribe: ${data.unsubscribeUrl}\n`;

  return { subject, html, text };
}

serve(async (_req) => {
  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: resendKey, error: keyErr } = await admin.rpc('get_resend_api_key');
    if (keyErr || !resendKey) {
      return new Response(JSON.stringify({ error: 'resend_key_unavailable' }), { status: 500 });
    }

    const today = new Date();
    const dayOfWeek = today.getUTCDay();
    const daysSinceFriday = (dayOfWeek - 5 + 7) % 7 || 7;
    const weekEnd = new Date(today);
    weekEnd.setUTCDate(weekEnd.getUTCDate() - daysSinceFriday);
    const weekEndStr = weekEnd.toISOString().slice(0, 10);

    const prices = await fetchPrices();
    const artistsByTicker = new Map<string, PriceArtist>();
    if (prices && Array.isArray(prices.artists)) {
      for (const a of prices.artists) artistsByTicker.set(a.ticker, a);
    }
    const topMarketGainers = (prices?.topGainers || []).slice(0, 3).map(g => {
      const a = artistsByTicker.get(g.ticker);
      return { ticker: g.ticker, name: a?.name || g.ticker, chg: g.chg24h };
    });
    const topMarketLosers = (prices?.topLosers || []).slice(0, 3).map(l => {
      const a = artistsByTicker.get(l.ticker);
      return { ticker: l.ticker, name: a?.name || l.ticker, chg: l.chg24h };
    });

    const { data: top } = await admin
      .from('weekly_snapshots')
      .select('user_id, return_pct_week, rank_in_week')
      .eq('week_end', weekEndStr)
      .order('rank_in_week', { ascending: true })
      .limit(3);
    const topUserIds = (top || []).map(r => r.user_id);
    let topNames = new Map<string, string>();
    if (topUserIds.length > 0) {
      const { data: topLb } = await admin.from('leaderboard').select('user_id, display_name').in('user_id', topUserIds);
      topNames = new Map((topLb || []).map(r => [r.user_id as string, r.display_name as string]));
    }
    const topTraders = (top || []).map(r => ({
      rank: r.rank_in_week as number,
      name: topNames.get(r.user_id as string) || 'trader',
      returnPct: +r.return_pct_week,
    }));

    const { data: seasonsData } = await admin.from('seasons').select('id, name').eq('status', 'active').limit(1);
    const activeSeason = (seasonsData || [])[0];

    const { data: subs } = await admin.from('email_subscriptions').select('user_id, unsubscribe_token').eq('weekly_newsletter', true);

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
          .eq('week_end', weekEndStr).eq('user_id', sub.user_id as string).limit(1);
        const snapshot = (snap || [])[0];
        if (!snapshot) { skipped++; continue; }

        const { data: lbRows } = await admin.from('leaderboard')
          .select('display_name, season_return_pct').eq('user_id', sub.user_id as string).limit(1);
        const lb = (lbRows || [])[0];

        let holdingWinner: { ticker: string; name: string; chg: number; value: number } | null = null;
        let holdingLoser: { ticker: string; name: string; chg: number; value: number } | null = null;
        const { data: portRows } = await admin.from('portfolios').select('snapshot').eq('user_id', sub.user_id as string).limit(1);
        const snap2 = (portRows || [])[0]?.snapshot as { holdings?: Record<string, unknown> } | null;
        if (snap2 && snap2.holdings && artistsByTicker.size > 0) {
          const movers = computeHoldingsMovers(snap2.holdings, artistsByTicker);
          holdingWinner = movers.winner;
          holdingLoser  = movers.loser;
        }

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
          topMarketGainers,
          topMarketLosers,
          holdingWinner,
          holdingLoser,
          unsubscribeUrl,
        });

        const resendRes = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: FROM_ADDRESS,
            to: [email],
            subject, html, text,
            headers: {
              'List-Unsubscribe': `<${unsubscribeUrl}>`,
              'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
            },
          }),
        });

        if (resendRes.ok) {
          sent++;
          await admin.from('email_subscriptions').update({ last_sent_at: new Date().toISOString() }).eq('user_id', sub.user_id as string);
        } else {
          failed++;
          console.warn(`[newsletter] Resend failed for ${sub.user_id}: ${resendRes.status}`);
        }
      } catch (e) {
        failed++;
        console.warn(`[newsletter] Error for ${sub.user_id}:`, (e as Error).message);
      }
    }

    return new Response(
      JSON.stringify({ ok: true, week_end: weekEndStr, sent, failed, skipped, prices_ok: !!prices }),
      { headers: { 'Content-Type': 'application/json' } },
    );
  } catch (e) {
    console.error('[newsletter] Top-level error:', e);
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500 });
  }
});
