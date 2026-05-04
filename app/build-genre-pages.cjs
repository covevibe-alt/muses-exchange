#!/usr/bin/env node
/**
 * Generates a static SEO landing page per genre into ../genres/<slug>.html.
 * Reads artist roster from ./artists.json and groups by .genre.
 *
 * Targets long-tail queries like "best pop artists 2026", "top hiphop
 * artists by streams", "biggest afropop artists", etc. Each page lists
 * every artist in that genre with internal links to /artists/<ticker>
 * for crawl depth.
 *
 * Usage:  node app/build-genre-pages.cjs
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const ARTISTS_JSON = path.join(__dirname, 'artists.json');
const OUT_DIR = path.join(ROOT, 'genres');
const SITEMAP = path.join(ROOT, 'sitemap.xml');

const TODAY = new Date().toISOString().slice(0, 10);
const SITE = 'https://muses.exchange';

// Per-genre copy: short, varied descriptors so the meta + content
// don't read as templated ("Top X artists" repeated nine times). Each
// blob describes WHY this genre matters on Muses.
const GENRE_COPY = {
  'Pop':         'Pop is the largest sector on Muses — the artists with the most monthly listeners worldwide. Prices in this genre move on viral moments, album cycles, and chart performance.',
  'Hip-hop':     'Hip-hop is the highest-volatility sector on Muses. Streaming numbers swing fast on release weeks, features, and culture cycles, which means prices in this genre move more than any other.',
  'Latin':       'Latin music has been the fastest-growing sector on streaming for years. The Muses Latin index covers reggaetón, Latin pop, regional Mexican, and crossover artists.',
  'R&B':         'R&B trades steadier than the volatile genres but rewards long-term holds — many of the biggest artists here have multi-year compounding streams.',
  'Afropop':     'Afropop is the smallest sector by Muses count but one of the fastest-growing globally. Listener numbers from Nigeria, South Africa, and Ghana drive most of the price action.',
  'Indie':       'Indie on Muses is curated bedroom-pop, indie folk, and indie rock — artists who built audiences without a major label push.',
  'Alt':         'Alt covers alternative rock, alt-pop, and the messier indie-adjacent. The genre indexes rebound on tour announcements and festival lineups.',
  'K-Pop':       'K-Pop has the most coordinated fanbases on streaming. When a comeback drops, the listener spike is sharp and predictable — which is reflected in $-ticker volatility.',
  'Electronic':  'Electronic on Muses spans EDM, house, future bass, and electronic pop. Prices here are driven less by listener counts and more by YouTube view spikes around music videos and festival sets.',
};

// ── Helpers ────────────────────────────────────────────────────────────────
function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function slugifyGenre(g) {
  return g.toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

// ── Page template ──────────────────────────────────────────────────────────
function renderPage(genre, artists, allGenres) {
  const slug = slugifyGenre(genre);
  const url = `${SITE}/genres/${slug}`;
  const count = artists.length;

  const title = `${genre} artists on Muses Exchange — ${count} stocks priced by streams`;
  const desc = `Browse the ${count} ${genre} artists on Muses, ranked by streaming-driven price. Paper-trade with $10,000 in virtual credits — no deposit, no KYC.`;
  const intro = GENRE_COPY[genre] || `${genre} on Muses — ${count} artists priced by real Spotify monthly listeners and YouTube views.`;

  // BreadcrumbList JSON-LD
  const breadcrumbs = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Muses', item: SITE + '/' },
      { '@type': 'ListItem', position: 2, name: 'Artists', item: SITE + '/artists' },
      { '@type': 'ListItem', position: 3, name: genre, item: url },
    ],
  };

  // ItemList JSON-LD — tells Google this is a curated list of artists.
  const itemList = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: `${genre} artists on Muses Exchange`,
    description: desc,
    url: url,
    mainEntity: {
      '@type': 'ItemList',
      numberOfItems: count,
      itemListElement: artists.map((a, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        item: {
          '@type': 'MusicGroup',
          name: a.name,
          url: `${SITE}/artists/${a.ticker.toLowerCase()}`,
          genre: a.genre,
        },
      })),
    },
  };

  // Artists grid — each card links to /artists/<ticker>
  const artistGrid = artists
    .map(
      (a) => `
        <a class="genre-artist-card" href="/artists/${a.ticker.toLowerCase()}">
          <span class="ticker">$${escapeHtml(a.ticker)}</span>
          <span class="name">${escapeHtml(a.name)}</span>
        </a>`
    )
    .join('');

  // Other genres for cross-linking at the bottom
  const otherGenres = allGenres
    .filter((g) => g !== genre)
    .map((g) => `<a class="genre-pill" href="/genres/${slugifyGenre(g)}">${escapeHtml(g)}</a>`)
    .join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(desc)}">
<meta property="og:title" content="${escapeHtml(genre + ' artists · Muses Exchange')}">
<meta property="og:description" content="${escapeHtml(desc)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Muses">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${SITE}/og-image.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:type" content="image/png">
<meta property="og:image:alt" content="Muses — a stock market for music, priced by streams.">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeHtml(genre + ' artists · Muses Exchange')}">
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
  /* Per-genre page styles — scoped to body[data-page="genre-static"]. */
  body[data-page="genre-static"] .genre-hero {
    padding: 80px 24px 40px;
    text-align: center;
    max-width: 880px;
    margin: 0 auto;
  }
  .genre-hero .genre-badge {
    display: inline-flex; align-items: center; gap: 6px;
    background: rgba(167, 139, 250, 0.14);
    border: 1px solid rgba(167, 139, 250, 0.32);
    color: #b98fff;
    font-family: 'JetBrains Mono', 'SF Mono', monospace;
    font-size: 13px; font-weight: 700; letter-spacing: 0.06em;
    padding: 6px 14px; border-radius: 999px;
    margin-bottom: 18px;
    text-transform: uppercase;
  }
  .genre-hero h1 {
    font-family: var(--serif);
    font-size: clamp(40px, 7vw, 72px);
    line-height: 1.05;
    margin: 0 0 16px;
  }
  .genre-hero h1 em { font-style: italic; color: var(--ink-dim); }
  .genre-hero .lede {
    font-family: var(--sans);
    font-size: 18px; line-height: 1.6;
    color: var(--ink-dim);
    max-width: 640px; margin: 0 auto 28px;
  }
  .genre-hero .cta-row {
    display: flex; gap: 12px; justify-content: center; flex-wrap: wrap;
  }
  .genre-grid-wrap {
    max-width: 960px; margin: 40px auto;
    padding: 0 24px;
  }
  .genre-grid-wrap h2 {
    font-family: var(--serif);
    font-size: 28px;
    color: var(--ink);
    margin: 0 0 20px;
  }
  .genre-grid {
    display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: 12px;
  }
  .genre-artist-card {
    display: flex; flex-direction: column; gap: 4px;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 12px;
    padding: 14px 16px;
    text-decoration: none;
    transition: border-color .15s ease, transform .15s ease;
  }
  .genre-artist-card:hover {
    border-color: rgba(167, 139, 250, 0.4);
    transform: translateY(-1px);
  }
  .genre-artist-card .ticker {
    font-family: 'JetBrains Mono', 'SF Mono', monospace;
    font-size: 11px; color: #b98fff;
  }
  .genre-artist-card .name {
    font-family: var(--sans); font-size: 15px;
    font-weight: 600; color: var(--ink);
  }
  .genre-content {
    max-width: 760px; margin: 60px auto;
    padding: 0 24px;
    font-family: var(--sans);
    font-size: 17px; line-height: 1.7;
    color: var(--ink-dim);
  }
  .genre-content h2 {
    font-family: var(--serif);
    font-size: 32px;
    color: var(--ink);
    margin: 40px 0 16px;
  }
  .genre-content p { margin: 0 0 16px; }
  .genre-other {
    max-width: 880px; margin: 60px auto;
    padding: 0 24px;
    text-align: center;
  }
  .genre-other h2 {
    font-family: var(--serif);
    font-size: 24px;
    color: var(--ink);
    margin: 0 0 16px;
  }
  .genre-pill {
    display: inline-block;
    margin: 4px;
    padding: 8px 16px;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.08);
    color: var(--ink);
    font-family: var(--sans);
    font-size: 14px;
    text-decoration: none;
    transition: border-color .15s ease;
  }
  .genre-pill:hover { border-color: rgba(167, 139, 250, 0.4); }
</style>
<script type="application/ld+json">
${JSON.stringify(itemList, null, 2)}
</script>
<script type="application/ld+json">
${JSON.stringify(breadcrumbs, null, 2)}
</script>
</head>
<body data-page="genre-static">

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

<section class="genre-hero">
  <div class="genre-badge">${escapeHtml(genre)} · ${count} artists</div>
  <h1>${escapeHtml(genre)} <em>on Muses.</em></h1>
  <p class="lede">${escapeHtml(intro)}</p>
  <div class="cta-row">
    <a class="btn-primary" href="/exchange/genre/${encodeURIComponent(genre)}">Browse ${escapeHtml(genre)} <svg><use href="#i-arrow-up-right"/></svg></a>
    <a class="btn-ghost" href="/artists">All artists</a>
  </div>
</section>

<section class="genre-grid-wrap">
  <h2>${count} ${escapeHtml(genre)} artists on Muses</h2>
  <div class="genre-grid">${artistGrid}
  </div>
</section>

<section class="genre-content">
  <h2>How ${escapeHtml(genre)} prices work on Muses</h2>
  <p>
    Every artist in the ${escapeHtml(genre)} sector trades as a "stock" with a price driven by three real signals:
  </p>
  <ul>
    <li><strong>Spotify monthly listeners</strong> — the largest weight. Rising listeners means rising market share.</li>
    <li><strong>YouTube channel reach</strong> — total views plus 30-day trend.</li>
    <li><strong>Chart positions and cultural momentum</strong> — Billboard data, viral moments, release timing.</li>
  </ul>
  <p>
    Trading activity moves the price within a ±25% band around the streaming-derived "fair value", so demand can lift an artist above their fundamentals — and selling pressure can push them below.
  </p>
  <h2>Trading ${escapeHtml(genre)} on Muses</h2>
  <p>
    Sign up free with $10,000 in virtual credits. Pick from the ${count} ${escapeHtml(genre)} artists above, build a ${escapeHtml(genre)}-heavy portfolio, or diversify across all 105 artists on the exchange. There's no deposit, no withdrawal, no KYC — just paper trading against real streaming data.
  </p>
  <h2>Monthly ${escapeHtml(genre)} Cup</h2>
  <p>
    Every month, the top 10 traders in each genre cup win virtual credits and badges. Hold any ${escapeHtml(genre)} artist and you're automatically entered. The cup closes at the end of the month and resets on the 1st — see the <a href="/leaderboard">leaderboard</a> for current standings (sign-in required).
  </p>
</section>

<section class="genre-other">
  <h2>Other genres on Muses</h2>
  ${otherGenres}
</section>

<div id="footer-mount"></div>

<script src="/muse-shared.js?v=20260427a"></script>
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

  // Group artists by genre
  const byGenre = new Map();
  for (const a of artists) {
    if (!byGenre.has(a.genre)) byGenre.set(a.genre, []);
    byGenre.get(a.genre).push(a);
  }
  const allGenres = Array.from(byGenre.keys()).sort();

  let written = 0;
  for (const [genre, list] of byGenre) {
    // Sort artists by name for stable output
    list.sort((a, b) => a.name.localeCompare(b.name));
    const html = renderPage(genre, list, allGenres);
    fs.writeFileSync(path.join(OUT_DIR, slugifyGenre(genre) + '.html'), html);
    written++;
  }
  console.log(`Wrote ${written} genre pages → genres/`);
  console.log('Slugs:', allGenres.map(slugifyGenre).join(', '));

  // Update sitemap.xml — strip pre-existing /genres/<x> entries first,
  // then inject all current ones before </urlset>.
  let sitemap = fs.readFileSync(SITEMAP, 'utf8');
  sitemap = sitemap.replace(
    /\s*<url>[^<]*<loc>[^<]*\/genres\/[^<]+<\/loc>[\s\S]*?<\/url>/g,
    ''
  );
  const newEntries = allGenres
    .map(
      (g) => `  <url>
    <loc>${SITE}/genres/${slugifyGenre(g)}</loc>
    <lastmod>${TODAY}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.6</priority>
  </url>`
    )
    .join('\n');
  sitemap = sitemap.replace('</urlset>', newEntries + '\n</urlset>');
  fs.writeFileSync(SITEMAP, sitemap);
  console.log(`Sitemap updated with ${allGenres.length} genre URLs`);
}

build();
