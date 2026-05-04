#!/usr/bin/env node
/**
 * Generates a static SEO landing page per artist into ../artists/<ticker>.html.
 * Reads artist roster from ./artists.json (canonical list).
 *
 * Re-run this whenever artists.json changes. Pages are designed to:
 *  - rank for "<artist name> stock", "<artist> Spotify stats", etc.
 *  - link to /exchange/<ticker> for actual trading
 *  - share well via OG tags (per-artist title/description)
 *  - inject MusicGroup + BreadcrumbList JSON-LD for rich results
 *
 * Usage:  node app/build-artist-pages.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const ARTISTS_JSON = path.join(__dirname, 'artists.json');
const OUT_DIR = path.join(ROOT, 'artists');
const SITEMAP = path.join(ROOT, 'sitemap.xml');

const TODAY = new Date().toISOString().slice(0, 10);
const SITE = 'https://muses.exchange';

// ── Helpers ────────────────────────────────────────────────────────────────
function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Pretty genre line — adds article + small descriptor for keyword density.
function genreCopy(genre) {
  const g = (genre || '').trim();
  const article = /^[aeiouAEIOU]/.test(g) ? 'an' : 'a';
  return `${article} ${g}`;
}

// Slug used in URL: lowercase ticker. Stable, short, brand-consistent.
function slug(artist) {
  return artist.ticker.toLowerCase();
}

// ── Page template ──────────────────────────────────────────────────────────
function renderPage(artist, related) {
  const ticker = artist.ticker;
  const name = artist.name;
  const genre = artist.genre || 'music';
  const url = `${SITE}/artists/${slug(artist)}`;
  const trade = `${SITE}/exchange/${ticker.toLowerCase()}`;

  const title = `${name} ($${ticker}) — Stream-priced stock on Muses Exchange`;
  const desc = `Paper-trade $${ticker} on Muses — ${name}'s "stock" price is driven by real Spotify monthly listeners and YouTube views. $10,000 in virtual credits, no deposit, no KYC.`;

  // BreadcrumbList JSON-LD: Home > Artists > <Name>
  const breadcrumbs = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Muses', item: SITE + '/' },
      { '@type': 'ListItem', position: 2, name: 'Artists', item: SITE + '/artists' },
      { '@type': 'ListItem', position: 3, name: name, item: url },
    ],
  };

  // MusicGroup JSON-LD — tells Google this is an artist entity.
  const musicGroup = {
    '@context': 'https://schema.org',
    '@type': 'MusicGroup',
    name: name,
    genre: genre,
    url: url,
    sameAs: artist.spotifyId
      ? [`https://open.spotify.com/artist/${artist.spotifyId}`]
      : undefined,
  };

  // Related artists in same genre (max 5) — internal linking helps SEO.
  const relatedHtml = related
    .map(
      (r) => `
        <a class="artist-related-card" href="/artists/${slug(r)}">
          <span class="ticker">$${escapeHtml(r.ticker)}</span>
          <span class="name">${escapeHtml(r.name)}</span>
        </a>`
    )
    .join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(desc)}">
<meta property="og:title" content="${escapeHtml(name + ' ($' + ticker + ') · Muses Exchange')}">
<meta property="og:description" content="${escapeHtml(desc)}">
<meta property="og:type" content="profile">
<meta property="og:site_name" content="Muses">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${SITE}/og-image.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:type" content="image/png">
<meta property="og:image:alt" content="Muses — a stock market for music, priced by streams.">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeHtml(name + ' ($' + ticker + ')')}">
<meta name="twitter:description" content="${escapeHtml(desc)}">
<meta name="twitter:image" content="${SITE}/og-image.png">
<meta name="twitter:image:alt" content="Muses — a stock market for music, priced by streams.">
<meta name="theme-color" content="#0b0910">
<link rel="canonical" href="${url}">
<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23b98fff' stroke-width='2.4' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='2,22 7.6,4 12,15 16.4,2 22,22'/%3E%3C/svg%3E">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,300;9..144,400;9..144,500;9..144,600;9..144,700;9..144,800;9..144,900&family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/muse-shared.css?v=20260420b">
<style>
  /* Per-artist page styles — scoped to body[data-page="artist-static"]. */
  body[data-page="artist-static"] .artist-hero {
    padding: 80px 24px 40px;
    text-align: center;
    max-width: 880px;
    margin: 0 auto;
  }
  .artist-hero .ticker-badge {
    display: inline-flex; align-items: center; gap: 6px;
    background: rgba(167, 139, 250, 0.14);
    border: 1px solid rgba(167, 139, 250, 0.32);
    color: #b98fff;
    font-family: 'JetBrains Mono', 'SF Mono', monospace;
    font-size: 13px; font-weight: 700; letter-spacing: 0.04em;
    padding: 6px 14px; border-radius: 999px;
    margin-bottom: 18px;
  }
  .artist-hero h1 {
    font-family: var(--serif);
    font-size: clamp(40px, 7vw, 72px);
    line-height: 1.05;
    margin: 0 0 16px;
  }
  .artist-hero h1 em { font-style: italic; color: var(--ink-dim); }
  .artist-hero .lede {
    font-family: var(--sans);
    font-size: 18px; line-height: 1.6;
    color: var(--ink-dim);
    max-width: 640px; margin: 0 auto 28px;
  }
  .artist-hero .cta-row {
    display: flex; gap: 12px; justify-content: center; flex-wrap: wrap;
  }
  .artist-stats {
    max-width: 880px; margin: 40px auto;
    display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 16px;
    padding: 0 24px;
  }
  .artist-stat-card {
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 14px;
    padding: 20px 22px;
  }
  .artist-stat-card .label {
    font-size: 11px; font-weight: 700;
    text-transform: uppercase; letter-spacing: 0.08em;
    color: var(--ink-faint);
    margin-bottom: 6px;
  }
  .artist-stat-card .value {
    font-family: var(--serif);
    font-size: 32px;
    color: var(--ink);
  }
  .artist-content {
    max-width: 760px; margin: 60px auto;
    padding: 0 24px;
    font-family: var(--sans);
    font-size: 17px; line-height: 1.7;
    color: var(--ink-dim);
  }
  .artist-content h2 {
    font-family: var(--serif);
    font-size: 32px;
    color: var(--ink);
    margin: 40px 0 16px;
  }
  .artist-content p { margin: 0 0 16px; }
  .artist-related {
    max-width: 880px; margin: 60px auto;
    padding: 0 24px;
  }
  .artist-related h2 {
    font-family: var(--serif);
    font-size: 28px;
    color: var(--ink);
    margin: 0 0 20px;
  }
  .artist-related-grid {
    display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 12px;
  }
  .artist-related-card {
    display: flex; flex-direction: column; gap: 4px;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 12px;
    padding: 14px 16px;
    text-decoration: none;
    transition: border-color .15s ease;
  }
  .artist-related-card:hover { border-color: rgba(167, 139, 250, 0.4); }
  .artist-related-card .ticker {
    font-family: 'JetBrains Mono', 'SF Mono', monospace;
    font-size: 11px; color: #b98fff;
  }
  .artist-related-card .name {
    font-family: var(--sans); font-size: 14px;
    font-weight: 600; color: var(--ink);
  }
</style>
<script type="application/ld+json">
${JSON.stringify(musicGroup, null, 2)}
</script>
<script type="application/ld+json">
${JSON.stringify(breadcrumbs, null, 2)}
</script>
</head>
<body data-page="artist-static">

<div class="ambient"></div>
<div class="grain"></div>

<svg width="0" height="0" style="position:absolute" aria-hidden="true">
  <defs>
    <symbol id="i-logo" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="2,22 7.6,4 12,15 16.4,2 22,22"/></symbol>
    <symbol id="i-arrow-up-right" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="7" y1="17" x2="17" y2="7"/><polyline points="7 7 17 7 17 17"/></symbol>
    <symbol id="i-menu" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></symbol>
  </defs>
</svg>

<div id="nav-mount"></div>

<section class="artist-hero">
  <div class="ticker-badge">$${escapeHtml(ticker)} · ${escapeHtml(genre)}</div>
  <h1>${escapeHtml(name)} <em>on Muses.</em></h1>
  <p class="lede">
    Buy and sell ${escapeHtml(name)}'s "stock" with $10,000 in virtual credits.
    Prices update every 30 minutes against ${escapeHtml(name)}'s real Spotify monthly listeners and YouTube views.
  </p>
  <div class="cta-row">
    <a class="btn-primary" href="/exchange/${escapeHtml(ticker.toLowerCase())}">Trade $${escapeHtml(ticker)} <svg><use href="#i-arrow-up-right"/></svg></a>
    <a class="btn-ghost" href="/artists">All artists</a>
  </div>
</section>

<section class="artist-stats" data-artist-ticker="${escapeHtml(ticker)}">
  <div class="artist-stat-card">
    <div class="label">Current price</div>
    <div class="value" data-stat="price">—</div>
  </div>
  <div class="artist-stat-card">
    <div class="label">Genre</div>
    <div class="value">${escapeHtml(genre)}</div>
  </div>
  <div class="artist-stat-card">
    <div class="label">Monthly listeners</div>
    <div class="value" data-stat="listeners">—</div>
  </div>
  <div class="artist-stat-card">
    <div class="label">24h change</div>
    <div class="value" data-stat="change">—</div>
  </div>
</section>

<section class="artist-content">
  <h2>What is the $${escapeHtml(ticker)} stock on Muses?</h2>
  <p>
    On Muses, ${escapeHtml(name)} trades under the ticker <strong>$${escapeHtml(ticker)}</strong> as ${genreCopy(genre)} artist.
    Their share price is a real function of streaming numbers — primarily Spotify monthly listeners and YouTube channel views — plus chart positions and cultural momentum.
    Every 30 minutes the prices recalculate against fresh data pulled from public Spotify and YouTube APIs.
  </p>
  <p>
    Muses is paper trading: when you buy a share of $${escapeHtml(ticker)}, you spend virtual credits, not real money.
    There's no deposit, no withdrawal, no KYC — just a $10,000 starting balance to test how well your read on the music industry tracks the actual numbers.
  </p>
  <h2>How is ${escapeHtml(name)}'s price calculated?</h2>
  <p>
    Three signals drive the share price:
  </p>
  <ul>
    <li><strong>Spotify monthly listeners</strong> — the largest weight. Rising listeners means rising market share, which lifts the price.</li>
    <li><strong>YouTube channel reach</strong> — total views plus 30-day trend, factored in as a secondary signal.</li>
    <li><strong>Chart positions and cultural momentum</strong> — Billboard charts, viral moments, release timing.</li>
  </ul>
  <p>
    Trading activity moves the price within a ±25% band around the streaming-derived "fair value" — so buy pressure can lift $${escapeHtml(ticker)} above its fundamentals, and selling can push it below.
  </p>
  <h2>Who is ${escapeHtml(name)}?</h2>
  <p>
    ${escapeHtml(name)} is ${genreCopy(genre)} artist on the Muses roster of 105+ artists.
    Read more on <a href="https://en.wikipedia.org/wiki/Special:Search/${encodeURIComponent(name)}" rel="noopener">Wikipedia</a> or
    <a href="https://open.spotify.com/${artist.spotifyId ? 'artist/' + artist.spotifyId : 'search/' + encodeURIComponent(name)}" rel="noopener">Spotify</a>.
  </p>
  <h2>Start trading $${escapeHtml(ticker)}</h2>
  <p>
    Sign up free with $10,000 in virtual credits. Buy ${escapeHtml(name)} at the current price, hold for the long-term thesis, or trade short-term against streaming-driven momentum.
    <a href="/exchange/${escapeHtml(ticker.toLowerCase())}">Open the $${escapeHtml(ticker)} trading page →</a>
  </p>
</section>

${
  related.length > 0
    ? `<section class="artist-related">
  <h2>More ${escapeHtml(genre)} artists</h2>
  <div class="artist-related-grid">${relatedHtml}
  </div>
</section>`
    : ''
}

<div id="footer-mount"></div>

<script src="/muse-shared.js?v=20260427a"></script>
<script src="/app/prices.js" defer onerror="console.warn('app/prices.js not found — run app/fetch-prices.py to generate it')"></script>
<script>
  // Hydrate the stats card from prices.js if available. Falls back to "—".
  (function () {
    const ticker = ${JSON.stringify(ticker)};
    const fmtPrice = (n) => '$' + Number(n).toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 });
    const fmtListeners = (n) => {
      if (!n) return '—';
      if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\\.0$/, '') + 'M';
      if (n >= 1_000) return (n / 1_000).toFixed(0) + 'K';
      return String(n);
    };
    const fmtChange = (pct) => {
      if (pct == null) return '—';
      const sign = pct >= 0 ? '+' : '';
      return sign + pct.toFixed(2) + '%';
    };
    const apply = (data) => {
      if (!data || !data.artists) return false;
      const a = data.artists.find(x => x.ticker === ticker);
      if (!a) return false;
      const setText = (sel, val) => { const el = document.querySelector(sel); if (el) el.textContent = val; };
      if (a.price != null) setText('[data-stat="price"]', fmtPrice(a.price));
      if (a.monthlyListeners != null) setText('[data-stat="listeners"]', fmtListeners(a.monthlyListeners));
      if (a.change24h != null) setText('[data-stat="change"]', fmtChange(a.change24h));
      return true;
    };
    if (!apply(window.__MUSE_PRICES)) {
      let tries = 0;
      const t = setInterval(() => {
        tries++;
        if (apply(window.__MUSE_PRICES) || tries > 40) clearInterval(t);
      }, 250);
    }
  })();
</script>
</body>
</html>
`;
}

// ── Build ──────────────────────────────────────────────────────────────────
function build() {
  const artists = JSON.parse(fs.readFileSync(ARTISTS_JSON, 'utf8'));
  if (!Array.isArray(artists) || artists.length === 0) {
    console.error('artists.json missing or empty');
    process.exit(1);
  }

  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  // Group by genre for the "more <genre> artists" section.
  const byGenre = new Map();
  for (const a of artists) {
    if (!byGenre.has(a.genre)) byGenre.set(a.genre, []);
    byGenre.get(a.genre).push(a);
  }

  let written = 0;
  for (const a of artists) {
    const sameGenre = (byGenre.get(a.genre) || [])
      .filter((x) => x.ticker !== a.ticker)
      .slice(0, 5);
    const html = renderPage(a, sameGenre);
    fs.writeFileSync(path.join(OUT_DIR, slug(a) + '.html'), html);
    written++;
  }
  console.log(`Wrote ${written} artist pages → artists/`);

  // Update sitemap.xml — append <url> entries for every artist if not
  // present yet. Keep existing entries (preserves any non-artist URLs).
  // Simplest approach: rebuild the artist section. Find the closing
  // </urlset> tag and inject new entries before it, after stripping any
  // pre-existing /artists/<x> entries.
  let sitemap = fs.readFileSync(SITEMAP, 'utf8');
  // Strip any existing <url>...artists/...</url> blocks
  sitemap = sitemap.replace(
    /\s*<url>[^<]*<loc>[^<]*\/artists\/[^<]+<\/loc>[\s\S]*?<\/url>/g,
    ''
  );
  const newEntries = artists
    .map(
      (a) => `  <url>
    <loc>${SITE}/artists/${slug(a)}</loc>
    <lastmod>${TODAY}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.7</priority>
  </url>`
    )
    .join('\n');
  sitemap = sitemap.replace('</urlset>', newEntries + '\n</urlset>');
  fs.writeFileSync(SITEMAP, sitemap);
  console.log(`Sitemap updated with ${artists.length} artist URLs`);
}

build();
