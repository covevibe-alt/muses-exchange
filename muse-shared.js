/* =========================================================
   Muses — shared nav + footer + reveal for marketing pages
   ========================================================= */

(function () {
  const page = document.body.dataset.page || '';

  /* Referral capture (Chunk E.4). If ?ref=USERNAME is in the URL, stash it
     in localStorage so exchange.html can call set_referrer() once the user
     authenticates. Any page (marketing, signup, signin) does the capture. */
  (function captureRef() {
    try {
      const qs = new URLSearchParams(location.search);
      const ref = qs.get('ref');
      if (ref && /^[A-Za-z0-9_-]{2,32}$/.test(ref)) {
        localStorage.setItem('muse_pending_ref', ref);
      }
    } catch (_e) { /* ignore */ }
  })();

  /* Plausible analytics — privacy-friendly, no cookies, GDPR-compliant.
     Uses Plausible's per-account bootstrap (pa-l2ZPZ9CJzbwtv0SHjAGZE.js).
     Only loads on muses.exchange in production; skipped on localhost and
     file:// previews so local sessions don't pollute the dashboard. */
  (function loadPlausible() {
    const host = location.hostname;
    if (!host || host === 'localhost' || host === '127.0.0.1' || location.protocol === 'file:') return;
    const s = document.createElement('script');
    s.async = true;
    s.src = 'https://plausible.io/js/pa-l2ZPZ9CJzbwtv0SHjAGZE.js';
    document.head.appendChild(s);
    window.plausible = window.plausible || function () { (plausible.q = plausible.q || []).push(arguments); };
    plausible.init = plausible.init || function (i) { plausible.o = i || {}; };
    plausible.init();
  })();

  /* =========================================================
     Funnel events — fired at most once per user, ever.
     landing (auto pageview)  →  viewed_artist  →  first_buy
         →  first_sell  →  return_day2
     first_visit + return_day2 are wired here (shared pages).
     viewed_artist / first_buy / first_sell are wired in the
     prototype itself (exchange.html) since that's where the
     trading actions live.
     ========================================================= */
  (function trackFunnel() {
    try {
      const host = location.hostname;
      if (!host || host === 'localhost' || host === '127.0.0.1' || location.protocol === 'file:') return;
      const DAY = 24 * 60 * 60 * 1000;
      const now = Date.now();
      const first = parseInt(localStorage.getItem('muse_first_visit_at') || '0', 10);
      if (!first) {
        localStorage.setItem('muse_first_visit_at', String(now));
        if (window.plausible) plausible('first_visit');
      } else if (!localStorage.getItem('muse_return_day2_fired') && (now - first) >= DAY) {
        if (window.plausible) plausible('return_day2');
        localStorage.setItem('muse_return_day2_fired', '1');
      }
    } catch (e) { /* localStorage disabled — skip silently */ }
  })();

  const NAV_HTML = `
    <div class="nav-wrap">
      <nav class="nav">
        <a class="brand" href="/">
          <div class="brand-mark"><svg><use href="#i-logo"/></svg></div>
          <div class="brand-name">Muses<sup>Exchange</sup></div>
        </a>
        <ul class="nav-links">
          <li><a href="/how-it-works" data-page="how">How it works</a></li>
          <li><a href="/artists" data-page="artists">Artists</a></li>
          <li><a href="/faq" data-page="faq">FAQ</a></li>
          <li><a href="/news" data-page="news">News</a></li>
        </ul>
        <div class="nav-cta-wrap">
          <!-- Desktop CTA cluster. Two buttons only: a quiet "Sign in" for
               returning users, and a single primary "Launch app" to drive
               cold visitors into the prototype. Sign-up used to live here
               too but the trio was visually noisy — Sign up stays in the
               mobile drawer and in inline page CTAs. -->
          <a class="nav-signin" href="/signin">Sign in</a>
          <a class="nav-cta" href="/exchange">
            Launch app <svg><use href="#i-arrow-up-right"/></svg>
          </a>
        </div>
        <button class="nav-menu-btn" aria-label="Open menu" id="navMenuBtn"><svg><use href="#i-menu"/></svg></button>
      </nav>
    </div>
    <div class="drawer-backdrop" id="drawerBackdrop"></div>
    <aside class="mobile-drawer" id="mobileDrawer" aria-label="Mobile navigation">
      <button class="md-close" id="mdClose" aria-label="Close menu">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
      <nav class="md-nav">
        <a href="/how-it-works" data-page="how">How it works</a>
        <a href="/artists" data-page="artists">Artists</a>
        <a href="/faq" data-page="faq">FAQ</a>
        <a href="/news" data-page="news">News</a>
      </nav>
      <div class="md-cta">
        <a class="btn-primary" href="/signup" style="width: 100%; justify-content: center;">
          Sign up — it's free <svg><use href="#i-arrow-up-right"/></svg>
        </a>
        <a class="btn-ghost" href="/exchange" style="width:100%; justify-content:center; margin-top:10px;">
          Launch app <svg><use href="#i-arrow-up-right"/></svg>
        </a>
        <a href="/signin" style="display:block; text-align:center; margin-top:14px; padding:12px 16px; min-height:44px; font-family:var(--sans); font-size:14px; color:var(--ink-dim); text-decoration:none;">Already have an account? <span style="color:var(--violet);">Sign in</span></a>
      </div>
    </aside>
  `;

  const FOOTER_HTML = `
    <footer>
      <div class="foot-grid">
        <div class="foot-brand">
          <a class="brand" href="/">
            <div class="brand-mark"><svg><use href="#i-logo"/></svg></div>
            <div class="brand-name">Muses<sup>Exchange</sup></div>
          </a>
          <p class="foot-tag">A paper-trading prototype where artists trade like stocks, priced by real Spotify and YouTube data. Independently built in the Netherlands.</p>
        </div>
        <div class="foot-col">
          <h4>Product</h4>
          <ul>
            <li><a href="/exchange">Launch app</a></li>
            <li><a href="/how-it-works">How it works</a></li>
            <li><a href="/artists">Artists</a></li>
            <li><a href="/waitlist">Waitlist</a></li>
            <li><a href="/faq">FAQ</a></li>
          </ul>
        </div>
        <div class="foot-col">
          <h4>Project</h4>
          <ul>
            <li><a href="/about">About</a></li>
            <li><a href="/press">Press</a></li>
            <li><a href="/news">News</a></li>
            <li><a href="/contact">Contact</a></li>
          </ul>
        </div>
        <div class="foot-col">
          <h4>Legal</h4>
          <ul>
            <li><a href="/terms">Terms</a></li>
            <li><a href="/privacy">Privacy</a></li>
            <li><a href="/risk">Risk notice</a></li>
            <li><a href="/cookies">Cookies</a></li>
            <li><a href="/licenses">Licenses</a></li>
          </ul>
        </div>
      </div>
      <div class="foot-bottom">
        <div>© 2026 Muses · muses.exchange</div>
        <div class="disclaimer">Muses is a paper-trading prototype. Prices track real streaming data; money is virtual. Muses is not a regulated investment service, not a broker-dealer, and does not hold client funds.</div>
      </div>
    </footer>
  `;

  /* Top-of-page live ticker — hydrates from window.__MUSE_PRICES.
     Replaces the old paper-trading disclaimer banner. Shows top artists
     by monthly listeners + a few biggest movers. Desktop: horizontal
     scroll. Mobile: auto-scrolling marquee. */
  /* Top-of-page live ticker — same .ticker-tape style as /exchange.
     Marquee scroll on all screen sizes, pauses on hover. */
  const TICKER_HTML = `
    <style>
      .muse-ticker-tape {
        display: flex; align-items: center;
        height: 38px;
        background: rgba(0,0,0,0.55);
        border-bottom: 1px solid rgba(255,255,255,0.08);
        overflow: hidden;
        position: relative;
        flex: 0 0 auto;
      }
      .muse-ticker-tape .tt-status {
        display: flex; align-items: center; gap: 8px;
        flex: 0 0 auto;
        padding: 0 18px;
        height: 100%;
        font-size: 10px; font-weight: 800;
        color: #ff4d6d;
        letter-spacing: 0.14em;
        font-family: var(--sans, Inter, sans-serif);
        border-right: 1px solid rgba(255,255,255,0.08);
        background: rgba(255,77,109,0.06);
      }
      .muse-ticker-tape .tt-dot {
        width: 7px; height: 7px; border-radius: 50%;
        background: #ff4d6d;
        box-shadow: 0 0 10px #ff4d6d;
        animation: tt-pulse 1.6s ease-in-out infinite;
      }
      @keyframes tt-pulse {
        0%, 100% { opacity: 1; transform: scale(1); }
        50% { opacity: 0.4; transform: scale(0.85); }
      }
      .muse-ticker-tape .tt-track-mask {
        flex: 1; min-width: 0; height: 100%;
        overflow: hidden; position: relative;
      }
      .muse-ticker-tape .tt-track {
        display: flex; align-items: center; height: 100%;
        width: max-content;
        animation: tt-scroll 360s linear infinite;
        will-change: transform;
      }
      .muse-ticker-tape:hover .tt-track { animation-play-state: paused; }
      @keyframes tt-scroll {
        from { transform: translateX(0); }
        to   { transform: translateX(-50%); }
      }
      .muse-ticker-tape .tt-item {
        display: inline-flex; align-items: center; gap: 10px;
        padding: 0 22px;
        height: 100%;
        border-right: 1px solid rgba(255,255,255,0.04);
        cursor: pointer;
        font-size: 12px;
        text-decoration: none;
        color: rgba(255,255,255,0.85);
        transition: background .15s ease, color .15s ease;
        font-family: var(--sans, Inter, sans-serif);
      }
      .muse-ticker-tape .tt-item:hover { background: rgba(139,92,246,0.08); color: #fff; }
      .muse-ticker-tape .tt-item .tt-tk {
        font-family: 'JetBrains Mono','SF Mono',monospace;
        font-weight: 700;
        font-size: 11px;
        letter-spacing: 0.04em;
        color: rgba(255,255,255,0.95);
      }
      .muse-ticker-tape .tt-item .tt-pr {
        font-weight: 700;
        color: rgba(255,255,255,0.95);
      }
      .muse-ticker-tape .tt-item .tt-ch { font-weight: 700; font-size: 11px; }
      .muse-ticker-tape .tt-item .tt-ch.up   { color: #4ade80; }
      .muse-ticker-tape .tt-item .tt-ch.down { color: #f87171; }
      .muse-ticker-tape .tt-item .tt-ch.flat { color: rgba(255,255,255,0.42); }
      .muse-ticker-tape .tt-loading {
        display: inline-flex; align-items: center; padding: 0 22px;
        color: rgba(255,255,255,0.40);
        font-size: 12px;
      }
      @media (max-width: 768px) {
        .muse-ticker-tape { height: 34px; }
        .muse-ticker-tape .tt-status { padding: 0 12px; font-size: 9px; }
        .muse-ticker-tape .tt-item { padding: 0 14px; gap: 7px; }
        .muse-ticker-tape .tt-track { animation-duration: 180s; }
      }
    </style>
    <div class="muse-ticker-tape" aria-label="Live artist ticker">
      <div class="tt-status"><span class="tt-dot"></span><span>LIVE</span></div>
      <div class="tt-track-mask">
        <div class="tt-track" data-ticker-track>
          <span class="tt-loading">Loading market data…</span>
        </div>
      </div>
    </div>
  `;

  const navMount = document.getElementById('nav-mount');
  if (navMount) {
    navMount.innerHTML = TICKER_HTML + NAV_HTML;
  }
  const footMount = document.getElementById('footer-mount');
  if (footMount) footMount.innerHTML = FOOTER_HTML;

  /* =========================================================
     Cookies disclaimer banner
     =========================================================
     Strictly speaking Muses does not require a cookie banner (see
     /cookies for the legal reasoning), but a visible disclaimer is
     a UX expectation. The banner appears once, dismissal is stored
     in localStorage, and the visible position is bottom-left so it
     never blocks primary CTAs. */
  (function initCookieBanner() {
    try {
      if (localStorage.getItem('muse:cookies-ack') === '1') return;
    } catch (e) {/* ignore */}
    if (document.getElementById('muse-cookie-banner')) return;

    const css = document.createElement('style');
    css.textContent = `
      .muse-cookie-banner {
        position: fixed;
        left: 20px;
        bottom: 20px;
        z-index: 90;
        max-width: 380px;
        padding: 18px 22px;
        background: rgba(18, 15, 28, 0.95);
        border: 1px solid rgba(247, 243, 234, 0.14);
        border-radius: 16px;
        backdrop-filter: blur(14px);
        -webkit-backdrop-filter: blur(14px);
        box-shadow: 0 20px 50px rgba(0,0,0,0.5);
        font-family: var(--sans, Inter, sans-serif);
        color: var(--ink, #f7f3ea);
        transform: translateY(20px);
        opacity: 0;
        transition: transform .35s cubic-bezier(.2,.7,.2,1), opacity .35s ease;
      }
      .muse-cookie-banner.in { transform: translateY(0); opacity: 1; }
      .muse-cookie-banner p {
        font-size: 13px;
        line-height: 1.55;
        color: rgba(247, 243, 234, 0.78);
        margin: 0 0 14px;
      }
      .muse-cookie-banner p strong {
        color: var(--ink, #f7f3ea);
        font-weight: 600;
      }
      .muse-cookie-banner a {
        color: var(--violet, #c084fc);
        text-decoration: none;
      }
      .muse-cookie-banner a:hover { text-decoration: underline; }
      .muse-cookie-actions {
        display: flex;
        gap: 10px;
        align-items: center;
      }
      .muse-cookie-btn {
        flex: 1;
        padding: 9px 16px;
        background: var(--ink, #f7f3ea);
        color: #0b0910;
        border: none;
        border-radius: 999px;
        font-family: var(--sans, Inter, sans-serif);
        font-weight: 600;
        font-size: 13px;
        cursor: pointer;
        transition: transform .15s ease;
      }
      .muse-cookie-btn:hover { transform: translateY(-1px); }
      .muse-cookie-link {
        font-size: 12px;
        color: rgba(247, 243, 234, 0.58);
        text-decoration: underline;
      }
      .muse-cookie-link:hover { color: var(--ink, #f7f3ea); }
      @media (max-width: 600px) {
        .muse-cookie-banner {
          left: 12px;
          right: 12px;
          bottom: 12px;
          max-width: none;
          padding: 16px 18px;
        }
      }
    `;
    document.head.appendChild(css);

    const banner = document.createElement('div');
    banner.id = 'muse-cookie-banner';
    banner.className = 'muse-cookie-banner';
    banner.setAttribute('role', 'dialog');
    banner.setAttribute('aria-label', 'Cookies notice');
    banner.innerHTML = `
      <p>
        <strong>Cookies, briefly.</strong>
        Muses uses only what's strictly necessary — session storage to keep you signed in, and cookieless analytics. No tracking, no ads. <a href="/cookies">Read the policy</a>.
      </p>
      <div class="muse-cookie-actions">
        <button type="button" class="muse-cookie-btn" id="muse-cookie-ack">Got it</button>
        <a class="muse-cookie-link" href="/privacy">Privacy</a>
      </div>
    `;
    document.body.appendChild(banner);
    requestAnimationFrame(() => banner.classList.add('in'));

    const ackBtn = document.getElementById('muse-cookie-ack');
    if (ackBtn) {
      ackBtn.addEventListener('click', () => {
        try { localStorage.setItem('muse:cookies-ack', '1'); } catch (e) {/* ignore */}
        banner.classList.remove('in');
        setTimeout(() => banner.remove(), 350);
      });
    }
  })();

  /* Hydrate the top-of-page ticker from live prices. Pulls a mix of top
     artists by monthly listeners and a few biggest movers. Re-runs on
     prices.js load (gives blog-embeds-style retry behaviour). */
  /* Fair-price computation matching the exchange's pricing model.
     listener-share × dynamic market cap, divided by 10K shares, plus
     YouTube/popularity/chart boosts. Mirrors computeFairPrice() in
     exchange.html so the ticker shows the same prices as the live app. */
  /* PRICING CONSTANTS — must stay in lockstep with exchange.html's
     PRICING object so marketing fair prices match the exchange.
     If you change one, change the other. */
  const MUSE_PRICING = {
    sharesOutstanding: 10000,
    baseMarketCap:     50000000,
    capPerArtist:      500000,
    valuePerListener:  0.03,
  };

  function computeFairPriceMuse(a, totalListeners, totalCap) {
    const listeners = (a && a.monthlyListeners) || 0;
    let marketCap;
    if (totalListeners > 0) {
      marketCap = (listeners / totalListeners) * totalCap;
    } else {
      marketCap = listeners * MUSE_PRICING.valuePerListener;
    }
    const base = Math.max(0.01, marketCap / MUSE_PRICING.sharesOutstanding);
    const yt  = (a && a.youtubeBoost)     || 0;
    const pop = (a && a.popularityBoost)  || 0;
    const ch  = (a && a.chartBoost)       || 0;
    return base * (1 + yt + pop + ch);
  }
  window.computeFairPriceMuse = computeFairPriceMuse;

  /* Single source of truth for marketing prices.
     ===============================================
     As soon as window.__MUSE_PRICES is available, compute the fair
     price for every artist exactly once and cache it on
     `artist.fairPriceMuse`. Every marketing surface — ticker,
     leaderboard, hero, watchlist, chart, order book, CTA chips,
     featured cards, big-step demos — reads from this same cached
     value, so they're guaranteed to display the SAME number.

     This is the same formula the exchange's computeFairPrice uses
     (modulo a listener-momentum boost ≤±6% that requires history
     data and an order-flow bias ≤±8% that requires live trading
     state — neither is available on marketing pages).

     Call ensureFairPrices() before reading prices; it's a no-op if
     prices are already cached or data isn't loaded yet. */
  let __pricesCached = false;
  function ensureFairPrices() {
    if (__pricesCached) return true;
    const data = window.__MUSE_PRICES;
    if (!data || !Array.isArray(data.artists) || !data.artists.length) return false;
    const totalListeners = data.totalMarketListeners
      || data.artists.reduce(function (s, a) { return s + ((a && a.monthlyListeners) || 0); }, 0);
    const totalCap = Math.max(
      MUSE_PRICING.baseMarketCap,
      data.artists.length * MUSE_PRICING.capPerArtist
    );
    data.artists.forEach(function (a) {
      a.fairPriceMuse = computeFairPriceMuse(a, totalListeners, totalCap);
    });
    // Stash totals so callers don't have to recompute
    data._marketingTotalListeners = totalListeners;
    data._marketingTotalCap = totalCap;
    __pricesCached = true;
    return true;
  }
  window.ensureMarketingFairPrices = ensureFairPrices;
  // Try immediately; if prices.js hasn't loaded yet, retry on a short interval
  if (!ensureFairPrices()) {
    let tries = 0;
    const t = setInterval(function () {
      tries++;
      if (ensureFairPrices() || tries > 80) clearInterval(t);
    }, 250);
  }

  function hydrateTicker() {
    const track = document.querySelector('[data-ticker-track]');
    const data = window.__MUSE_PRICES;
    if (!track) return false;
    if (!data || !Array.isArray(data.artists) || data.artists.length === 0) return false;

    // Total listeners (use backend hint if present, else sum)
    const totalListeners = (data.totalMarketListeners
      || data.artists.reduce(function (s, a) { return s + ((a && a.monthlyListeners) || 0); }, 0));
    // Dynamic market cap — $50M base, scales with roster ($500K per artist)
    const totalCap = Math.max(50000000, data.artists.length * 500000);

    const slugify = function (n) {
      return (n || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    };
    const fmtPrice = function (p) {
      if (p == null || isNaN(p)) return '—';
      // Match the exchange formatting: $1.23 for small, $1,234.56 for large
      const n = Number(p);
      if (n >= 1000) return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      return '$' + n.toFixed(2);
    };
    const fmtCh = function (c) {
      if (c == null || isNaN(c)) return { txt: '· 0.00%', cls: 'flat' };
      const cls = c > 0.01 ? 'up' : c < -0.01 ? 'down' : 'flat';
      const arrow = c > 0.01 ? '▲' : c < -0.01 ? '▼' : '·';
      return { txt: arrow + ' ' + Math.abs(c).toFixed(2) + '%', cls: cls };
    };

    // Ensure single source of truth — cache fair prices once before
    // any UI reads them. Every surface (ticker, leaderboard, hero, CTA
    // chips, etc.) reads a.fairPriceMuse so the numbers always match.
    ensureFairPrices();

    const items = data.artists.slice();
    const renderItem = function (a) {
      const price = (a && typeof a.fairPriceMuse === 'number')
        ? a.fairPriceMuse
        : computeFairPriceMuse(a, totalListeners, totalCap);
      const c = fmtCh(a.chg24h);
      const slug = slugify(a.name);
      return '<a class="tt-item" href="/artists/' + slug + '" data-tk="' + (a.ticker || '') + '">' +
             '<span class="tt-tk">' + (a.ticker || '') + '</span>' +
             '<span class="tt-pr">' + fmtPrice(price) + '</span>' +
             '<span class="tt-ch ' + c.cls + '">' + c.txt + '</span>' +
             '</a>';
    };
    const half = items.map(renderItem).join('');
    track.innerHTML = half + half;
    return true;
  }

  if (!hydrateTicker()) {
    let tickerTries = 0;
    const tickerInt = setInterval(() => {
      tickerTries++;
      if (hydrateTicker() || tickerTries > 80) clearInterval(tickerInt);
    }, 250);
  }

  /* =========================================================
     Marketing-surface price hydration
     =========================================================
     Replaces hardcoded prices on marketing pages with live data
     pulled from prices.js. The exchange itself uses the same
     fair-price formula, so prices stay in sync across the site.

     Targets (no-op if absent on the current page):
     - .hero-card-float (homepage hero floating cards)
     - .ps-watch-item   (product showcase watchlist rows)
     - .ps-chart-head   (product showcase chart header + stats)
     - .ps-orderbook    (product showcase order book)
     - .bs-card         (how-it-works big-step demo cards)

     Each surface uses `data-ticker="XXX"` on a child element to
     identify which artist to look up. */
  function hydrateMarketingSurfaces() {
    const data = window.__MUSE_PRICES;
    if (!data || !Array.isArray(data.artists) || data.artists.length === 0) return false;

    // Single source of truth — cache fair prices once on a.fairPriceMuse
    // so every consumer reads the SAME number across all surfaces.
    ensureFairPrices();

    const totalListeners = data._marketingTotalListeners
      || data.artists.reduce(function (s, a) { return s + ((a && a.monthlyListeners) || 0); }, 0);
    const totalCap = data._marketingTotalCap
      || Math.max(MUSE_PRICING.baseMarketCap, data.artists.length * MUSE_PRICING.capPerArtist);

    const byTicker = {};
    data.artists.forEach(function (a) {
      if (a && a.ticker) byTicker[a.ticker] = a;
    });

    function fmtPrice(p) {
      if (p == null || isNaN(p)) return '—';
      const n = Number(p);
      if (n >= 1000) return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      return '$' + n.toFixed(2);
    }
    function fmtBig(n) {
      if (n == null || isNaN(n)) return '—';
      if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
      if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
      if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
      return String(n);
    }
    function priceFor(tk) {
      const a = byTicker[tk];
      if (!a) return null;
      return (typeof a.fairPriceMuse === 'number')
        ? a.fairPriceMuse
        : computeFairPriceMuse(a, totalListeners, totalCap);
    }
    function chgFor(tk) {
      const a = byTicker[tk];
      return a ? (a.chg24h || 0) : 0;
    }
    function applyChange(el, chg, withTodaySuffix) {
      if (!el) return;
      const arrow = chg > 0.01 ? '▲' : chg < -0.01 ? '▼' : '·';
      const cls = chg > 0.01 ? 'up' : chg < -0.01 ? 'down' : 'flat';
      el.textContent = arrow + ' ' + Math.abs(chg).toFixed(2) + '%' + (withTodaySuffix ? ' today' : '');
      el.classList.remove('up', 'down', 'flat');
      el.classList.add(cls);
    }

    // 1. Hero floating cards (homepage)
    document.querySelectorAll('.hero-card-float').forEach(function (card) {
      const av = card.querySelector('.hcf-avatar[data-ticker]');
      if (!av) return;
      const tk = av.getAttribute('data-ticker');
      const price = priceFor(tk);
      if (price == null) return;
      const priceEl = card.querySelector('.hcf-price');
      const chgEl = card.querySelector('.hcf-change');
      if (priceEl) priceEl.textContent = fmtPrice(price);
      applyChange(chgEl, chgFor(tk), true);
    });

    // 2. Product showcase watchlist (homepage)
    document.querySelectorAll('.ps-watch-item').forEach(function (item) {
      const av = item.querySelector('.ps-watch-avatar[data-ticker]');
      if (!av) return;
      const tk = av.getAttribute('data-ticker');
      const price = priceFor(tk);
      if (price == null) return;
      const chg = chgFor(tk);
      const chgEl = item.querySelector('.ps-watch-chg');
      if (chgEl) {
        const arrow = chg > 0.01 ? '▲' : chg < -0.01 ? '▼' : '·';
        const cls = chg > 0.01 ? 'up' : chg < -0.01 ? 'down' : 'flat';
        chgEl.textContent = fmtPrice(price) + ' · ' + arrow + ' ' + Math.abs(chg).toFixed(2) + '%';
        chgEl.classList.remove('up', 'down', 'flat');
        chgEl.classList.add(cls);
      }
    });

    // 3. Product showcase chart header + stats (homepage)
    document.querySelectorAll('.ps-chart-head').forEach(function (head) {
      const av = head.querySelector('.ps-chart-avatar[data-ticker]');
      if (!av) return;
      const tk = av.getAttribute('data-ticker');
      const a = byTicker[tk];
      if (!a) return;
      const price = priceFor(tk);
      const priceEl = head.querySelector('.ps-chart-price');
      const chgEl = head.querySelector('.ps-chart-chg');
      if (priceEl) priceEl.textContent = fmtPrice(price);
      applyChange(chgEl, chgFor(tk), true);
      // Derive open/high/low from current price (rough but consistent demo values)
      const panel = head.closest('.ps-panel');
      if (panel) {
        const stats = panel.querySelectorAll('.ps-stat-value');
        if (stats[0]) stats[0].textContent = fmtPrice(price * 0.943);
        if (stats[1]) stats[1].textContent = fmtPrice(price * 1.012);
        if (stats[2]) stats[2].textContent = fmtPrice(price * 0.928);
        if (stats[3]) stats[3].textContent = fmtBig(a.monthlyListeners || 0);
      }
    });

    // 4. Order book — anchored to the chart artist in the same product screen
    document.querySelectorAll('.ps-orderbook').forEach(function (ob) {
      const screen = ob.closest('.ps-screen');
      if (!screen) return;
      const chartAv = screen.querySelector('.ps-chart-avatar[data-ticker]');
      if (!chartAv) return;
      const tk = chartAv.getAttribute('data-ticker');
      const price = priceFor(tk);
      if (price == null) return;
      const rows = ob.querySelectorAll('.ps-ob-row');
      const offsets = [0.0021, 0.0014, 0.0009, -0.0001, -0.0010, -0.0021];
      rows.forEach(function (row, i) {
        const spans = row.querySelectorAll('span');
        if (spans.length >= 1 && offsets[i] !== undefined) {
          spans[0].textContent = (price * (1 + offsets[i])).toFixed(2);
        }
      });
    });

    // 5. How-it-works big-step cards
    document.querySelectorAll('.bs-card').forEach(function (card) {
      const av = card.querySelector('[data-ticker]');
      if (!av) return;
      const tk = av.getAttribute('data-ticker');
      const price = priceFor(tk);
      if (price == null) return;
      const chg = chgFor(tk);
      const priceEl = card.querySelector('.bs-card-price');
      if (priceEl) {
        const arrow = chg > 0.01 ? '▲' : chg < -0.01 ? '▼' : '·';
        const cls = chg > 0.01 ? 'up' : chg < -0.01 ? 'down' : 'flat';
        priceEl.innerHTML = fmtPrice(price) + ' <span class="' + cls + '">' + arrow + ' ' + Math.abs(chg).toFixed(2) + '%</span>';
      }
    });

    return true;
  }
  if (!hydrateMarketingSurfaces()) {
    let mTries = 0;
    const mInt = setInterval(() => {
      mTries++;
      if (hydrateMarketingSurfaces() || mTries > 80) clearInterval(mInt);
    }, 250);
  }


  // Mobile sticky waitlist CTA removed per Sander request 2026-05-12.

  // Mobile only: hide the sticky nav on scroll-down, show it on scroll-up.
  // Keeps the hamburger reachable without eating vertical space while reading.
  // The nav re-appears whenever the user scrolls up, even a small amount — so
  // it feels responsive, not sluggish. Desktop is wide enough that the nav
  // doesn't feel in the way, so we leave that behavior alone.
  (function initNavAutoHide(){
    const navWrap = document.querySelector('.nav-wrap');
    if (!navWrap) return;
    let lastY = window.scrollY || 0;
    let navTicking = false;
    const THRESHOLD = 6;   // px of movement before we flip state
    const TOP_BUFFER = 80; // always show when near the very top
    const isMobile = () => window.matchMedia('(max-width: 760px)').matches;
    const onNavScroll = () => {
      if (navTicking) return;
      navTicking = true;
      requestAnimationFrame(() => {
        if (!isMobile()){
          navWrap.classList.remove('nav-hidden');
          lastY = window.scrollY || 0;
          navTicking = false;
          return;
        }
        const y = window.scrollY || 0;
        if (y < TOP_BUFFER){
          navWrap.classList.remove('nav-hidden');
        } else if (y > lastY + THRESHOLD){
          navWrap.classList.add('nav-hidden');
        } else if (y < lastY - THRESHOLD){
          navWrap.classList.remove('nav-hidden');
        }
        lastY = y;
        navTicking = false;
      });
    };
    window.addEventListener('scroll', onNavScroll, { passive: true });
  })();

  // Page fade-in removed — body renders immediately (was causing a 300-500ms
  // blank flash on navigation). Keeping the class toggle for any legacy CSS
  // that might still gate on it.
  document.body.classList.add('loaded');

  // Mark current nav item
  document.querySelectorAll(`.nav-links a[data-page="${page}"], .md-nav a[data-page="${page}"]`)
    .forEach(el => el.classList.add('current'));

  // Mobile drawer wiring
  const openBtn = document.getElementById('navMenuBtn');
  const drawer = document.getElementById('mobileDrawer');
  const backdrop = document.getElementById('drawerBackdrop');
  const closeBtn = document.getElementById('mdClose');
  if (openBtn && drawer && backdrop) {
    const open = () => {
      drawer.classList.add('open');
      backdrop.classList.add('open');
      document.body.style.overflow = 'hidden';
    };
    const close = () => {
      drawer.classList.remove('open');
      backdrop.classList.remove('open');
      document.body.style.overflow = '';
    };
    openBtn.addEventListener('click', open);
    backdrop.addEventListener('click', close);
    if (closeBtn) closeBtn.addEventListener('click', close);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && drawer.classList.contains('open')) close();
    });
  }

  // Reveal on scroll.
  // Thresholds are loose so short mobile viewports (428×831) still fire the
  // reveal when a tall section barely pokes into the viewport — the old
  // 0.1 threshold + -50px rootMargin left some sections stuck at opacity:0
  // at mobile because not enough of the section was ever visible at once.
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach(e => {
        if (e.isIntersecting) {
          e.target.classList.add('in');
          io.unobserve(e.target);
        }
      });
    }, { threshold: 0.01, rootMargin: '0px 0px 0px 0px' });
    document.querySelectorAll('.reveal').forEach(el => io.observe(el));
  } else {
    document.querySelectorAll('.reveal').forEach(el => el.classList.add('in'));
  }

  // Auto-reveal elements already in view
  requestAnimationFrame(() => {
    document.querySelectorAll('.reveal').forEach(el => {
      const r = el.getBoundingClientRect();
      if (r.top < window.innerHeight) el.classList.add('in');
    });
  });

  /* =========================================================
     Auth modal — popup sign in / sign up
     =========================================================
     Triggered by clicking any link with href="/signin" or
     href="/signup". Standalone /signin and /signup pages stay
     functional as fallbacks (email confirmation, password reset,
     no-JS clients).

     SETUP REQUIRED (Sander, ToDo before launch):
     1. Supabase Auth → Providers → enable Google + Facebook,
        add OAuth client ID/secret from Google Cloud Console
        and Meta for Developers. Until enabled, OAuth buttons
        will surface a friendly "provider not configured" error.
     2. Cloudflare Turnstile → dash.cloudflare.com → Turnstile →
        create widget for muses.exchange, replace TURNSTILE_SITEKEY
        below with the real key. The default key
        1x00000000000000000000AA is Cloudflare's always-passes
        test key — fine for development, MUST be swapped before
        launch.
     3. (Optional) Supabase Auth → Settings → CAPTCHA Protection →
        enable with the matching Turnstile secret key for
        server-side verification. Without this, the widget renders
        but Supabase doesn't verify the token. */
  (function initAuthModal() {
    const SUPABASE_URL = 'https://bhyjdvqbfearmrkxvppl.supabase.co';
    const SUPABASE_KEY = 'sb_publishable_rJy9Oi0xt7U2HfiUs1-S9w_klZz82Lh';
    const TURNSTILE_SITEKEY = '0x4AAAAAADP-I4plvXT5vlaW'; // Muses Exchange widget (cloudflare)

    // Inject CSS once
    if (!document.getElementById('muse-auth-modal-style')) {
      const style = document.createElement('style');
      style.id = 'muse-auth-modal-style';
      style.textContent = `
        .muse-auth-backdrop {
          position: fixed; inset: 0; z-index: 250;
          background: rgba(0, 0, 0, 0.72);
          backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
          display: grid; place-items: center; padding: 24px;
          opacity: 0; pointer-events: none;
          transition: opacity .25s ease;
        }
        .muse-auth-backdrop.open { opacity: 1; pointer-events: auto; }
        .muse-auth-modal {
          width: 100%; max-width: 440px;
          background: #161321;
          border: 1px solid rgba(247, 243, 234, 0.12);
          border-radius: 24px;
          box-shadow: 0 40px 100px rgba(0, 0, 0, 0.6),
                      inset 0 1px 0 rgba(255, 255, 255, 0.05);
          padding: 36px 32px 30px;
          position: relative;
          color: #f7f3ea;
          font-family: var(--sans, Inter, sans-serif);
          transform: translateY(20px) scale(0.98);
          transition: transform .3s cubic-bezier(.2,.7,.2,1);
          max-height: calc(100vh - 48px);
          overflow-y: auto;
        }
        .muse-auth-backdrop.open .muse-auth-modal { transform: translateY(0) scale(1); }
        .muse-auth-close {
          position: absolute; top: 18px; right: 18px;
          width: 36px; height: 36px; border-radius: 50%;
          background: transparent;
          border: 1px solid rgba(247, 243, 234, 0.12);
          color: rgba(247, 243, 234, 0.6);
          cursor: pointer;
          display: grid; place-items: center;
          transition: border-color .15s, color .15s, background .15s;
        }
        .muse-auth-close:hover {
          border-color: rgba(247, 243, 234, 0.3);
          color: #f7f3ea;
          background: rgba(247, 243, 234, 0.04);
        }
        .muse-auth-close svg { width: 14px; height: 14px; }
        .muse-auth-eyebrow {
          font-size: 11px; font-weight: 600;
          text-transform: uppercase; letter-spacing: 0.18em;
          color: #c084fc;
          display: inline-flex; align-items: center; gap: 8px;
          margin-bottom: 12px;
        }
        .muse-auth-eyebrow::before {
          content: ""; width: 6px; height: 6px; border-radius: 999px;
          background: #cfff5e;
          box-shadow: 0 0 8px #cfff5e;
        }
        .muse-auth-title {
          font-family: var(--serif, Fraunces, serif);
          font-size: 32px; font-weight: 500;
          line-height: 1.05; letter-spacing: -0.025em;
          margin: 0 0 8px;
        }
        .muse-auth-title em {
          font-style: italic; font-weight: 500;
          background: linear-gradient(120deg, #ffd7c2 0%, #c084fc 60%, #a855f7 100%);
          -webkit-background-clip: text; background-clip: text;
          color: transparent;
        }
        .muse-auth-lede {
          font-size: 14px;
          color: rgba(247, 243, 234, 0.66);
          line-height: 1.55;
          margin: 0 0 24px;
        }
        .muse-auth-oauth {
          display: flex; flex-direction: column; gap: 10px;
          margin-bottom: 20px;
        }
        .muse-oauth-btn {
          display: flex; align-items: center; justify-content: center; gap: 10px;
          width: 100%; padding: 13px 18px;
          background: rgba(247, 243, 234, 0.05);
          border: 1px solid rgba(247, 243, 234, 0.18);
          border-radius: 12px;
          color: #f7f3ea;
          font-family: inherit; font-weight: 600; font-size: 14px;
          cursor: pointer;
          transition: background .15s, border-color .15s, transform .15s;
        }
        .muse-oauth-btn:hover {
          background: rgba(247, 243, 234, 0.09);
          border-color: rgba(247, 243, 234, 0.28);
        }
        .muse-oauth-btn:active { transform: translateY(1px); }
        .muse-oauth-btn:disabled { opacity: 0.5; cursor: wait; }
        .muse-oauth-btn svg { width: 18px; height: 18px; flex-shrink: 0; }
        .muse-auth-divider {
          display: flex; align-items: center; gap: 14px;
          margin: 18px 0; color: rgba(247, 243, 234, 0.4);
          font-size: 11px; font-weight: 600;
          text-transform: uppercase; letter-spacing: 0.16em;
        }
        .muse-auth-divider::before,
        .muse-auth-divider::after {
          content: ""; flex: 1; height: 1px;
          background: rgba(247, 243, 234, 0.1);
        }
        .muse-auth-field { margin-bottom: 14px; }
        .muse-auth-label {
          display: block; font-size: 12px; font-weight: 500;
          color: rgba(247, 243, 234, 0.66);
          margin-bottom: 8px;
          letter-spacing: 0.01em;
        }
        .muse-auth-input {
          width: 100%; padding: 13px 16px;
          background: rgba(247, 243, 234, 0.03);
          border: 1px solid rgba(247, 243, 234, 0.12);
          border-radius: 12px;
          color: #f7f3ea;
          font-family: inherit; font-size: 15px;
          transition: border-color .15s, background .15s;
        }
        .muse-auth-input:focus {
          outline: none;
          border-color: #c084fc;
          background: rgba(192, 132, 252, 0.06);
        }
        .muse-auth-input::placeholder { color: rgba(247, 243, 234, 0.32); }
        .muse-auth-submit {
          width: 100%; padding: 14px;
          background: #f7f3ea; color: #0b0910;
          border: none; border-radius: 999px;
          font-family: inherit; font-weight: 600; font-size: 15px;
          cursor: pointer;
          transition: transform .15s, box-shadow .15s, opacity .15s;
          margin-top: 8px;
        }
        .muse-auth-submit:hover {
          transform: translateY(-1px);
          box-shadow: 0 10px 30px rgba(247, 243, 234, 0.22);
        }
        .muse-auth-submit:disabled { opacity: 0.55; cursor: wait; transform: none; box-shadow: none; }
        .muse-auth-turnstile { margin: 14px 0 0; min-height: 65px; }
        .muse-auth-alt {
          margin-top: 18px;
          font-size: 13px;
          color: rgba(247, 243, 234, 0.6);
          text-align: center;
        }
        .muse-auth-alt button {
          background: none; border: 0; padding: 0;
          font: inherit; cursor: pointer;
          color: #c084fc;
          text-decoration: underline;
        }
        .muse-auth-alert {
          padding: 12px 14px; border-radius: 10px;
          font-size: 13px; line-height: 1.45;
          margin-bottom: 14px; display: none;
        }
        .muse-auth-alert.ok {
          background: rgba(110, 255, 184, 0.08);
          border: 1px solid rgba(110, 255, 184, 0.3);
          color: #8df0cf;
        }
        .muse-auth-alert.err {
          background: rgba(255, 107, 138, 0.08);
          border: 1px solid rgba(255, 107, 138, 0.3);
          color: #ffb3c3;
        }
        .muse-auth-alert.show { display: block; }
        .muse-auth-forgot {
          display: block; text-align: right; padding: 4px 0;
          font-size: 12px; font-weight: 500;
          color: #c084fc; text-decoration: none;
          background: none; border: 0; cursor: pointer;
          margin-top: -4px; margin-left: auto;
        }
        .muse-auth-forgot:hover { text-decoration: underline; }
        .muse-auth-terms {
          font-size: 11px;
          color: rgba(247, 243, 234, 0.5);
          line-height: 1.55;
          margin: 14px 0 0;
          text-align: center;
        }
        .muse-auth-terms a {
          color: rgba(247, 243, 234, 0.7);
          text-decoration: underline;
        }
        .muse-auth-terms a:hover { color: #f7f3ea; }
        @media (max-width: 480px) {
          .muse-auth-modal { padding: 28px 22px 24px; }
          .muse-auth-title { font-size: 26px; }
        }
      `;
      document.head.appendChild(style);
    }

    // Build modal markup
    if (document.getElementById('muse-auth-modal-root')) return;
    const root = document.createElement('div');
    root.id = 'muse-auth-modal-root';
    root.className = 'muse-auth-backdrop';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', 'Sign in or sign up');
    root.innerHTML = `
      <div class="muse-auth-modal" data-mode="signin">
        <button class="muse-auth-close" type="button" aria-label="Close" id="muse-auth-close">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
        <div class="muse-auth-eyebrow" id="muse-auth-eyebrow">Welcome back</div>
        <h2 class="muse-auth-title" id="muse-auth-title">Sign in to <em>Muses.</em></h2>
        <p class="muse-auth-lede" id="muse-auth-lede">Pick up where you left off — check your portfolio, trade the market, and see what's moving.</p>

        <div class="muse-auth-alert" id="muse-auth-alert"></div>

        <div class="muse-auth-oauth">
          <button type="button" class="muse-oauth-btn" data-oauth="google" aria-label="Continue with Google">
            <svg viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z"/></svg>
            Continue with Google
          </button>
          <!-- Facebook OAuth removed per Sander 2026-05-15. Meta for Developers
               setup is significantly heavier than Google (legal agreements,
               phone verification, app review) and Facebook sign-in usage has
               been declining. Easy to re-add later by restoring the
               <button data-oauth="facebook"> below and enabling the provider
               in Supabase Auth → Providers → Facebook. -->
        </div>

        <div class="muse-auth-divider">or with email</div>

        <form id="muse-auth-form" autocomplete="on" novalidate>
          <div class="muse-auth-field">
            <label class="muse-auth-label" for="muse-auth-email">Email address</label>
            <input class="muse-auth-input" type="email" id="muse-auth-email" name="email"
                   placeholder="you@example.com" autocomplete="email" required>
          </div>
          <div class="muse-auth-field">
            <label class="muse-auth-label" for="muse-auth-password">Password</label>
            <input class="muse-auth-input" type="password" id="muse-auth-password" name="password"
                   placeholder="At least 8 characters" autocomplete="current-password"
                   minlength="8" required>
          </div>
          <button type="button" class="muse-auth-forgot" id="muse-auth-forgot">Forgot your password?</button>
          <div class="muse-auth-turnstile" id="muse-auth-turnstile" style="display:none"></div>
          <button type="submit" class="muse-auth-submit" id="muse-auth-submit">Sign in</button>
          <p class="muse-auth-terms" id="muse-auth-terms" style="display:none">
            By creating an account you agree to our
            <a href="/terms">terms</a> and <a href="/privacy">privacy policy</a>.
          </p>
        </form>

        <p class="muse-auth-alt">
          <span id="muse-auth-alt-text">Don't have an account?</span>
          <button type="button" id="muse-auth-toggle">Create one</button>
        </p>
      </div>
    `;
    document.body.appendChild(root);

    // Element refs
    const modal = root.querySelector('.muse-auth-modal');
    const closeBtn = root.querySelector('#muse-auth-close');
    const eyebrow = root.querySelector('#muse-auth-eyebrow');
    const title = root.querySelector('#muse-auth-title');
    const lede = root.querySelector('#muse-auth-lede');
    const alertBox = root.querySelector('#muse-auth-alert');
    const form = root.querySelector('#muse-auth-form');
    const emailInput = root.querySelector('#muse-auth-email');
    const pwInput = root.querySelector('#muse-auth-password');
    const forgotBtn = root.querySelector('#muse-auth-forgot');
    const submitBtn = root.querySelector('#muse-auth-submit');
    const turnstileWrap = root.querySelector('#muse-auth-turnstile');
    const termsP = root.querySelector('#muse-auth-terms');
    const altText = root.querySelector('#muse-auth-alt-text');
    const toggleBtn = root.querySelector('#muse-auth-toggle');

    let supabaseClient = null;
    let supabaseLoading = null;
    let turnstileLoading = null;
    let turnstileWidgetId = null;
    let turnstileToken = '';
    let currentMode = 'signin'; // 'signin' | 'signup'

    function showAlert(kind, msg) {
      alertBox.className = 'muse-auth-alert show ' + kind;
      alertBox.textContent = msg;
    }
    function clearAlert() {
      alertBox.className = 'muse-auth-alert';
      alertBox.textContent = '';
    }
    function setMode(mode) {
      currentMode = mode;
      if (mode === 'signup') {
        modal.dataset.mode = 'signup';
        eyebrow.textContent = 'Get started';
        title.innerHTML = 'Create your <em>Muses account.</em>';
        lede.textContent = '$10,000 in virtual credits the moment you confirm your email. No deposit, no KYC.';
        submitBtn.textContent = 'Create account';
        pwInput.setAttribute('autocomplete', 'new-password');
        pwInput.placeholder = 'At least 8 characters';
        forgotBtn.style.display = 'none';
        termsP.style.display = 'block';
        altText.textContent = 'Already have an account?';
        toggleBtn.textContent = 'Sign in';
        turnstileWrap.style.display = 'block';
        ensureTurnstile();
      } else {
        modal.dataset.mode = 'signin';
        eyebrow.textContent = 'Welcome back';
        title.innerHTML = 'Sign in to <em>Muses.</em>';
        lede.textContent = "Pick up where you left off — check your portfolio, trade the market, and see what's moving.";
        submitBtn.textContent = 'Sign in';
        pwInput.setAttribute('autocomplete', 'current-password');
        pwInput.placeholder = 'Your password';
        forgotBtn.style.display = 'block';
        termsP.style.display = 'none';
        altText.textContent = "Don't have an account?";
        toggleBtn.textContent = 'Create one';
        turnstileWrap.style.display = 'none';
      }
      clearAlert();
    }

    async function getSupabase() {
      if (supabaseClient) return supabaseClient;
      if (!supabaseLoading) {
        supabaseLoading = import('https://esm.sh/@supabase/supabase-js@2')
          .then(mod => {
            supabaseClient = mod.createClient(SUPABASE_URL, SUPABASE_KEY);
            return supabaseClient;
          });
      }
      return supabaseLoading;
    }

    function ensureTurnstile() {
      // Inject Turnstile script once
      if (!turnstileLoading && !window.turnstile) {
        turnstileLoading = new Promise((resolve, reject) => {
          const s = document.createElement('script');
          s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
          s.async = true;
          s.defer = true;
          s.onload = () => resolve();
          s.onerror = () => reject(new Error('Turnstile script failed to load'));
          document.head.appendChild(s);
        });
      }
      const tryRender = () => {
        if (!window.turnstile) return false;
        if (turnstileWidgetId != null) return true;
        turnstileWidgetId = window.turnstile.render(turnstileWrap, {
          sitekey: TURNSTILE_SITEKEY,
          theme: 'dark',
          callback: (tok) => { turnstileToken = tok; },
          'error-callback': () => { turnstileToken = ''; },
          'expired-callback': () => { turnstileToken = ''; },
        });
        return true;
      };
      if (!tryRender()) {
        (turnstileLoading || Promise.resolve()).then(() => {
          let tries = 0;
          const t = setInterval(() => {
            tries++;
            if (tryRender() || tries > 40) clearInterval(t);
          }, 200);
        }).catch(() => { /* offline / blocked — skip */ });
      }
    }

    function resetTurnstile() {
      if (window.turnstile && turnstileWidgetId != null) {
        try { window.turnstile.reset(turnstileWidgetId); } catch (e) { /* ignore */ }
      }
      turnstileToken = '';
    }

    function open(mode) {
      setMode(mode || 'signin');
      root.classList.add('open');
      document.body.style.overflow = 'hidden';
      // focus first input shortly after transition starts
      setTimeout(() => { emailInput && emailInput.focus(); }, 60);
    }
    function close() {
      root.classList.remove('open');
      document.body.style.overflow = '';
      clearAlert();
      form.reset();
      resetTurnstile();
    }

    // Backdrop click closes; modal click does not
    root.addEventListener('click', (e) => {
      if (e.target === root) close();
    });
    closeBtn.addEventListener('click', close);

    // ESC closes
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && root.classList.contains('open')) close();
    });

    // Tab toggle
    toggleBtn.addEventListener('click', () => {
      setMode(currentMode === 'signin' ? 'signup' : 'signin');
    });

    // OAuth handler
    root.querySelectorAll('.muse-oauth-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const provider = btn.dataset.oauth;
        if (!provider) return;
        clearAlert();
        btn.disabled = true;
        const origText = btn.textContent;
        btn.textContent = 'Redirecting…';
        try {
          const supa = await getSupabase();
          const { error } = await supa.auth.signInWithOAuth({
            provider: provider,
            options: {
              redirectTo: window.location.origin + '/exchange',
            }
          });
          if (error) throw error;
          // signInWithOAuth normally redirects; if it returns here, something's off
        } catch (err) {
          const msg = (err && err.message) || '';
          if (/provider is not enabled/i.test(msg) || /unsupported provider/i.test(msg)) {
            showAlert('err', provider[0].toUpperCase() + provider.slice(1) +
              ' sign-in isn\'t configured yet. Use email and password for now.');
          } else {
            showAlert('err', msg || 'Could not start sign-in. Try again or use email.');
          }
          btn.disabled = false;
          btn.textContent = origText;
        }
      });
    });

    // Email/password submit
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearAlert();
      const email = emailInput.value.trim();
      const password = pwInput.value;
      if (!email || !password) {
        showAlert('err', 'Enter your email and password.');
        return;
      }
      if (currentMode === 'signup' && password.length < 8) {
        showAlert('err', 'Password must be at least 8 characters.');
        return;
      }

      submitBtn.disabled = true;
      const origText = submitBtn.textContent;
      submitBtn.textContent = currentMode === 'signup' ? 'Creating account…' : 'Signing in…';

      try {
        const supa = await getSupabase();
        if (currentMode === 'signup') {
          const opts = {
            emailRedirectTo: window.location.origin + '/exchange',
          };
          if (turnstileToken) opts.captchaToken = turnstileToken;
          const { error } = await supa.auth.signUp({
            email, password, options: opts
          });
          if (error) throw error;
          showAlert('ok',
            "Account created. Check your inbox for the confirmation link — your $10,000 in virtual credits is waiting.");
          form.reset();
          resetTurnstile();
        } else {
          const { error } = await supa.auth.signInWithPassword({ email, password });
          if (error) throw error;
          showAlert('ok', 'Signed in. Loading the exchange…');
          setTimeout(() => { window.location.href = '/exchange'; }, 400);
        }
      } catch (err) {
        const raw = (err && err.message) || '';
        let msg = raw || 'Something went wrong. Please try again.';
        if (/invalid login credentials/i.test(raw)) msg = 'Wrong email or password. Try again.';
        else if (/email not confirmed/i.test(raw)) msg = "You haven't confirmed your email yet. Check your inbox.";
        else if (/user already registered/i.test(raw)) msg = 'An account with this email already exists. Try signing in.';
        else if (/password should be at least/i.test(raw)) msg = 'Password must be at least 8 characters.';
        else if (/captcha/i.test(raw)) msg = "Please complete the bot check above before continuing.";
        showAlert('err', msg);
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = origText;
      }
    });

    // Forgot password
    forgotBtn.addEventListener('click', async () => {
      const email = emailInput.value.trim();
      if (!email) {
        showAlert('err', 'Enter your email above first, then click "Forgot your password?" again.');
        emailInput.focus();
        return;
      }
      try {
        const supa = await getSupabase();
        const { error } = await supa.auth.resetPasswordForEmail(email, {
          redirectTo: window.location.origin + '/signin'
        });
        if (error) throw error;
        showAlert('ok', 'If an account exists for ' + email + ', we just emailed a reset link.');
      } catch (err) {
        showAlert('err', 'Could not send reset link. Try again in a moment.');
      }
    });

    // Expose open() globally so any page can trigger
    window.museAuth = { open, close };

    // Delegated click handler: intercept links to /signin and /signup
    // and open the modal instead. Allow ctrl/cmd-click to open the real
    // page (for users who want to deep-link or share the URL).
    document.addEventListener('click', (e) => {
      const a = e.target && e.target.closest && e.target.closest('a[href="/signin"], a[href="/signup"]');
      if (!a) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return; // let new-tab work
      // Skip if we're already on /signin or /signup — keep those as is for direct flow
      if (document.body.dataset.page === 'signin' || document.body.dataset.page === 'signup') return;
      e.preventDefault();
      open(a.getAttribute('href') === '/signup' ? 'signup' : 'signin');
    });

    // Allow opening via URL hash for sharing or post-action redirects
    function openFromHash() {
      const h = location.hash.toLowerCase();
      if (h === '#signin' || h === '#signup') open(h.slice(1));
    }
    openFromHash();
    window.addEventListener('hashchange', openFromHash);
  })();

  /* =========================================================
     Interactive layer — Cosmos-style polish
     =========================================================
     Five additions that fire automatically on every page:
       1. Scroll progress bar at top of long content pages
       2. Scattered floating live-ticker chips around .cta-strip
       3. Count-up animation for [data-count-up] elements
       4. 3D hover-tilt for [data-tilt] (auto-applied to many cards)
       5. Cursor-spotlight on [data-spotlight] / .page-hero / .hero-wrap

     All effects respect prefers-reduced-motion and degrade to static
     visuals gracefully. CSS is injected once, listeners are passive,
     and per-element animation work runs inside rAF. */
  (function initInteractiveLayer() {
    if (document.getElementById('muse-fx-style')) return;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const css = document.createElement('style');
    css.id = 'muse-fx-style';
    css.textContent = `
      /* =========================================================
         Global header-em override (per Sander 2026-05-15)
         =========================================================
         Removes italic styling from <em> inside headers across the
         entire site while preserving the violet→coral gradient
         used to color the "second part" of headlines. Combines
         many existing selectors (.hero-title em, .page-hero-title em,
         .section-title em, .cta-title em, news article titles, FAQ
         titles, big-step h3 em, etc.) so we don't have to edit each
         page individually. Uses a generic selector reaching any em
         inside h1/h2/h3/h4 plus the most common compound classes. */
      h1 em, h2 em, h3 em, h4 em,
      .hero-title em, .page-hero-title em, .section-title em,
      .cta-title em, .news-article-title em, .news-side-card h5 em,
      .news-grid-card h3 em, .bs-body h3 em, .humans-item figcaption em,
      .signup-title em, .faq-cat h3 em, .faq-q em,
      .image-band-caption h3 em, .image-split figcaption em,
      .wl-hero-title em, .wl-tier h3 em, .legal-doc h2 em,
      .news-section-head h1 em, .about-wrap p em {
        font-style: normal !important;
      }
      /* Keep the violet→coral gradient for the inline accent — same
         palette as before but without the italic slant. */
      .hero-title em, .page-hero-title em, .section-title em,
      .cta-title em, .news-article-title em, .signup-title em,
      .image-band-caption h3 em, .image-split figcaption em,
      .wl-hero-title em, .news-section-head h1 em {
        background: linear-gradient(120deg, #ffd7c2 0%, #c084fc 40%, #a855f7 80%);
        -webkit-background-clip: text;
        background-clip: text;
        color: transparent;
        font-weight: 500;
      }
      /* CTA card em uses the warmer blush color for contrast against
         the violet gradient background of the .cta-card. */
      .cta-title em {
        background: linear-gradient(120deg, #ffd7c2 0%, #ffcaae 50%, #ffaa7a 100%);
        -webkit-background-clip: text;
        background-clip: text;
        color: transparent;
      }

      /* Scroll progress bar */
      .muse-scroll-progress {
        position: fixed; top: 0; left: 0; right: 0;
        height: 2px;
        background: linear-gradient(90deg, #c084fc 0%, #ff8a65 60%, #cfff5e 100%);
        transform-origin: 0 50%;
        transform: scaleX(var(--p, 0));
        z-index: 100; pointer-events: none;
        will-change: transform;
        box-shadow: 0 0 12px rgba(192, 132, 252, 0.5);
      }

      /* Hover-tilt cards */
      [data-tilt] {
        transform-style: preserve-3d;
        transition: transform .25s cubic-bezier(.2,.7,.2,1);
        will-change: transform;
      }

      /* Cursor spotlight */
      [data-spotlight] { position: relative; overflow: hidden; isolation: isolate; }
      [data-spotlight]::after {
        content: ""; position: absolute; inset: 0;
        background: radial-gradient(
          640px circle at var(--sx, 50%) var(--sy, 50%),
          rgba(192, 132, 252, 0.18) 0%,
          rgba(192, 132, 252, 0.05) 24%,
          transparent 50%
        );
        pointer-events: none;
        z-index: 0;
        opacity: var(--so, 0);
        transition: opacity .4s ease;
        mix-blend-mode: screen;
      }
      [data-spotlight] > * { position: relative; z-index: 1; }

      /* Scattered live-ticker chips on CTA strips */
      .cta-strip { position: relative; overflow: visible; }
      .muse-cta-scatter {
        position: absolute; inset: -40px -20px;
        pointer-events: none;
        z-index: 0;
        overflow: visible;
      }
      .muse-cta-chip {
        position: absolute;
        padding: 8px 14px;
        background: rgba(22, 19, 33, 0.75);
        border: 1px solid rgba(247, 243, 234, 0.14);
        border-radius: 999px;
        backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
        font-family: ui-monospace, 'SF Mono', monospace;
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 0.04em;
        color: rgba(247, 243, 234, 0.72);
        white-space: nowrap;
        display: inline-flex; align-items: center; gap: 8px;
        box-shadow: 0 12px 30px rgba(0, 0, 0, 0.4);
        opacity: 0;
        transform: translateY(8px) rotate(var(--r, 0deg)) scale(0.95);
        transition: opacity .8s ease, transform .8s cubic-bezier(.2,.7,.2,1);
      }
      .muse-cta-chip.in {
        opacity: 1;
        /* Once revealed, the per-animation-pattern keyframes take over
           the transform; we don't override here so they can run. */
      }
      .muse-cta-chip .chip-tk { color: rgba(247, 243, 234, 0.92); }
      .muse-cta-chip .chip-up   { color: #6effb8; }
      .muse-cta-chip .chip-down { color: #ff6b8a; }
      .muse-cta-chip .chip-flat { color: rgba(247, 243, 234, 0.5); }
      /* Four drift patterns shared by hero tiles and CTA chips.
         Each is contained within ~24px of motion. */
      .muse-cta-chip-anim-A { animation: muse-driftA 13s ease-in-out infinite; animation-delay: var(--d, 0s); }
      .muse-cta-chip-anim-B { animation: muse-driftB 15s ease-in-out infinite; animation-delay: var(--d, 0s); }
      .muse-cta-chip-anim-C { animation: muse-driftC 11s ease-in-out infinite; animation-delay: var(--d, 0s); }
      .muse-cta-chip-anim-D { animation: muse-driftD 17s ease-in-out infinite; animation-delay: var(--d, 0s); }
      @keyframes muse-driftA {
        0%, 100% { transform: translate(0, 0)   rotate(var(--r, 0deg)); }
        25%      { transform: translate(8px, -14px) rotate(calc(var(--r, 0deg) + 2deg)); }
        50%      { transform: translate(-4px, -22px) rotate(calc(var(--r, 0deg) - 1deg)); }
        75%      { transform: translate(-10px, -8px) rotate(calc(var(--r, 0deg) + 1.5deg)); }
      }
      @keyframes muse-driftB {
        0%, 100% { transform: translate(0, 0)    rotate(var(--r, 0deg)); }
        33%      { transform: translate(-14px, 10px) rotate(calc(var(--r, 0deg) - 3deg)); }
        66%      { transform: translate(10px, 18px)  rotate(calc(var(--r, 0deg) + 2.5deg)); }
      }
      @keyframes muse-driftC {
        0%, 100% { transform: translate(0, 0)    rotate(var(--r, 0deg)); }
        20%      { transform: translate(12px, 8px)   rotate(calc(var(--r, 0deg) + 2deg)); }
        50%      { transform: translate(18px, -6px)  rotate(calc(var(--r, 0deg) - 1deg)); }
        80%      { transform: translate(-6px, -14px) rotate(calc(var(--r, 0deg) + 1deg)); }
      }
      @keyframes muse-driftD {
        0%, 100% { transform: translate(0, 0)    rotate(var(--r, 0deg)); }
        50%      { transform: translate(-16px, -16px) rotate(calc(var(--r, 0deg) - 2.5deg)); }
      }
      /* Legacy keyframe kept for any inline-style consumers */
      @keyframes muse-chip-float {
        0%, 100% { translate: 0 0; }
        50%      { translate: 0 -6px; }
      }
      .cta-card { position: relative; z-index: 1; }
      /* Keep the inner card stacked above the scatter, but DON'T blanket
         every direct child with position:relative — that was killing the
         scatter's absolute positioning and collapsing it to 0px height. */

      /* Count-up — visual stability while value is 0 */
      [data-count-up] { font-variant-numeric: tabular-nums; }

      @media (prefers-reduced-motion: reduce) {
        .muse-cta-chip { animation: none; opacity: 1; transform: translateY(0) rotate(var(--r, 0deg)); transition: none; }
        [data-tilt] { transform: none !important; transition: none; }
        [data-spotlight]::after { display: none; }
        .muse-scroll-progress { transition: none; }
      }
      @media (max-width: 760px) {
        /* Hover-tilt is awkward on touch — disable */
        [data-tilt] { transform: none !important; }
        /* Fewer chips on mobile, smaller */
        .muse-cta-chip { font-size: 10px; padding: 6px 11px; }
      }
    `;
    document.head.appendChild(css);

    /* -------------------------------------------------------
       1. Scroll progress bar
       ------------------------------------------------------- */
    (function initScrollProgress() {
      const page = document.body.dataset.page || '';
      // Only show on long content pages
      const longPages = ['news-post', 'terms', 'privacy', 'risk', 'cookies', 'licenses', 'faq', 'how', 'about'];
      if (longPages.indexOf(page) === -1) return;

      const bar = document.createElement('div');
      bar.className = 'muse-scroll-progress';
      bar.setAttribute('aria-hidden', 'true');
      document.body.appendChild(bar);

      let ticking = false;
      const update = () => {
        const h = document.documentElement;
        const max = (h.scrollHeight - h.clientHeight) || 1;
        const p = Math.max(0, Math.min(1, (h.scrollTop || window.scrollY) / max));
        bar.style.setProperty('--p', String(p));
        ticking = false;
      };
      window.addEventListener('scroll', () => {
        if (!ticking) { requestAnimationFrame(update); ticking = true; }
      }, { passive: true });
      update();
    })();

    /* -------------------------------------------------------
       2. Scattered live-ticker chips on .cta-strip
       ------------------------------------------------------- */
    /* -------------------------------------------------------
       Hero scatter — Cosmos-style artist photo tiles
       -------------------------------------------------------
       Populates [data-cosmos] container with 14-22 floating artist
       image tiles. Uses real images from window.__MUSE_PRICES.
       Cards are positioned with explicit spread points, sized in
       three buckets (s/m/l), and assigned one of four drift
       animations so no two tiles move in sync. Tiles fade+scale in
       with a stagger so the hero "blooms" on load. */
    (function initHeroScatter() {
      const containers = document.querySelectorAll('[data-cosmos]');
      if (!containers.length) return;

      // Position grid — spread tiles across the hero canvas while
      // keeping a safe corridor through the middle (35%-65% horizontal,
      // 18%-72% vertical) so they don't cover the central text.
      // Each entry: top%, left%, size bucket, animation pattern.
      // 22 tiles total — JS picks the right count for viewport.
      const POSITIONS = [
        // Far left column
        { t: 4,   l: 3,   sz: 'm', a: 'A' },
        { t: 28,  l: 7,   sz: 's', a: 'B' },
        { t: 50,  l: 2,   sz: 'm', a: 'C' },
        { t: 70,  l: 6,   sz: 'l', a: 'A' },
        { t: 88,  l: 12,  sz: 's', a: 'D' },
        // Left-middle
        { t: 10,  l: 22,  sz: 'm', a: 'D' },
        { t: 38,  l: 18,  sz: 's', a: 'C' },
        { t: 78,  l: 22,  sz: 'm', a: 'B' },
        // Top center (just above text)
        { t: -2,  l: 38,  sz: 's', a: 'B' },
        { t: -4,  l: 58,  sz: 'm', a: 'A' },
        // Bottom center (just below text)
        { t: 95,  l: 40,  sz: 's', a: 'C' },
        { t: 92,  l: 60,  sz: 'm', a: 'D' },
        // Right-middle
        { t: 12,  l: 76,  sz: 'l', a: 'C' },
        { t: 40,  l: 80,  sz: 's', a: 'A' },
        { t: 76,  l: 76,  sz: 'm', a: 'B' },
        // Far right column
        { t: 4,   l: 92,  sz: 'm', a: 'D' },
        { t: 30,  l: 95,  sz: 's', a: 'B' },
        { t: 54,  l: 93,  sz: 'm', a: 'A' },
        { t: 72,  l: 90,  sz: 's', a: 'C' },
        { t: 92,  l: 86,  sz: 'l', a: 'D' },
        // Extra accents
        { t: 60,  l: 14,  sz: 's', a: 'B' },
        { t: 22,  l: 88,  sz: 's', a: 'A' },
      ];

      // Size buckets in pixels — varied for visual depth
      const SIZES = { s: 54, m: 76, l: 104 };

      // Pre-defined gradient fallbacks (for letter-avatar mode when
      // image fails to load)
      const FALLBACK_GRADIENTS = [
        'linear-gradient(135deg,#ff8a65,#c084fc)',
        'linear-gradient(135deg,#7c3aed,#4c1d95)',
        'linear-gradient(135deg,#cfff5e,#6effb8)',
        'linear-gradient(135deg,#a855f7,#ff8a65)',
        'linear-gradient(135deg,#ff6b8a,#ff8a65)',
        'linear-gradient(135deg,#6effb8,#c084fc)',
        'linear-gradient(135deg,#c084fc,#a855f7)',
        'linear-gradient(135deg,#ffd7c2,#c084fc)',
      ];

      function mount() {
        const data = window.__MUSE_PRICES;
        if (!data || !Array.isArray(data.artists) || !data.artists.length) return false;

        containers.forEach(function (container) {
          // Don't double-mount
          if (container.children.length) return;

          // Pick top artists by monthly listeners — these have the
          // most recognizable photos.
          const byListeners = data.artists
            .slice()
            .filter(function (a) { return a && a.image; })
            .sort(function (a, b) { return (b.monthlyListeners || 0) - (a.monthlyListeners || 0); });
          if (!byListeners.length) return;

          // Tile count for viewport
          const w = window.innerWidth;
          const count = w < 600 ? 9 : w < 900 ? 14 : w < 1280 ? 18 : POSITIONS.length;

          const picks = byListeners.slice(0, count);

          picks.forEach(function (artist, i) {
            const pos = POSITIONS[i];
            if (!pos) return;
            const size = SIZES[pos.sz] || SIZES.m;
            const rotation = ((i * 137) % 30) - 15; // -15..14 deg, deterministic
            const enterDelay = 80 + i * 90; // ms — staggered entrance

            // Single .hero-mini element — image, glow, and animation all
            // live on the same node so the WHOLE tile (with shadow) floats
            // together. Previous version had a nested .hero-mini-inner that
            // animated, which caused the image to drift INSIDE a static
            // outer box — fixed 2026-05-15.
            const tile = document.createElement('div');
            tile.className = 'hero-mini';
            tile.style.setProperty('--x', pos.l + '%');
            tile.style.setProperty('--y', pos.t + '%');
            tile.style.setProperty('--s', size + 'px');
            tile.style.setProperty('--r', rotation + 'deg');
            tile.style.setProperty('--enterDelay', (enterDelay / 1000) + 's');
            tile.style.setProperty('--anim', 'drift' + pos.a);
            // Vary duration per tile so the patterns desync over time
            tile.style.setProperty('--dur', (10 + (i % 5) * 1.4) + 's');
            tile.style.setProperty('--d', ((i % 6) * 0.7) + 's');

            // Real Spotify image; fall back to letter avatar on error
            const img = document.createElement('img');
            img.className = 'hero-mini-img';
            img.src = artist.image;
            img.alt = ''; // decorative — name is in the hero text below
            img.loading = i < 8 ? 'eager' : 'lazy';
            img.decoding = 'async';
            img.referrerPolicy = 'no-referrer';
            img.onerror = function () {
              // Image failed — replace with gradient + letter
              const fb = document.createElement('div');
              fb.className = 'hero-mini-fallback';
              fb.style.background = FALLBACK_GRADIENTS[i % FALLBACK_GRADIENTS.length];
              fb.textContent = (artist.name || artist.ticker || '?').charAt(0).toUpperCase();
              img.replaceWith(fb);
            };
            tile.appendChild(img);

            // Subtle purple→coral overlay
            const glow = document.createElement('div');
            glow.className = 'hero-mini-glow';
            tile.appendChild(glow);

            container.appendChild(tile);

            // Trigger entrance on next frame
            requestAnimationFrame(function () {
              requestAnimationFrame(function () {
                tile.classList.add('in');
              });
            });
          });
        });
        return true;
      }

      if (!mount()) {
        let tries = 0;
        const t = setInterval(function () {
          tries++;
          if (mount() || tries > 80) clearInterval(t);
        }, 250);
      }

      /* Subtle cursor parallax — applied at the CONTAINER level so it
         composes cleanly with the per-tile drift animations. The whole
         scatter layer drifts ~12px toward the cursor, giving the scene
         a sense of depth without fighting the individual transforms. */
      if (!reduced && window.matchMedia('(pointer: fine)').matches) {
        containers.forEach(function (container) {
          const hero = container.closest('.hero');
          if (!hero) return;
          container.style.transition = 'transform .8s cubic-bezier(.2,.7,.2,1)';
          let raf = null;
          hero.addEventListener('mousemove', function (e) {
            const rect = hero.getBoundingClientRect();
            const cx = (e.clientX - rect.left) / rect.width  - 0.5;
            const cy = (e.clientY - rect.top)  / rect.height - 0.5;
            if (raf) cancelAnimationFrame(raf);
            raf = requestAnimationFrame(function () {
              container.style.transform =
                'translate(' + (cx * -14).toFixed(1) + 'px, ' +
                (cy * -10).toFixed(1) + 'px)';
            });
          });
          hero.addEventListener('mouseleave', function () {
            container.style.transform = 'translate(0, 0)';
          });
        });
      }
    })();

    /* -------------------------------------------------------
       CTA scatter — same engine, ticker-chip flavor
       ------------------------------------------------------- */
    (function initCtaScatter() {
      const strips = document.querySelectorAll('.cta-strip');
      if (!strips.length) return;

      // Wait for prices.js, then mount chips.
      function mount() {
        const data = window.__MUSE_PRICES;
        if (!data || !Array.isArray(data.artists) || !data.artists.length) return false;

        const totalListeners = (data.totalMarketListeners
          || data.artists.reduce(function (s, a) { return s + ((a && a.monthlyListeners) || 0); }, 0));
        const totalCap = Math.max(50000000, data.artists.length * 500000);
        const fairFn = window.computeFairPriceMuse || function (a) {
          const l = (a && a.monthlyListeners) || 0;
          const mc = totalListeners > 0 ? (l / totalListeners) * totalCap : l * 0.03;
          return Math.max(0.01, mc / 10000);
        };

        // Top movers + a few big names, dedup'd
        const byChange = data.artists.slice().sort((a, b) => Math.abs(b.chg24h || 0) - Math.abs(a.chg24h || 0));
        const byListeners = data.artists.slice().sort((a, b) => (b.monthlyListeners || 0) - (a.monthlyListeners || 0));
        const seen = new Set();
        const picks = [];
        function take(arr, n) {
          for (let i = 0; i < arr.length && picks.length < (picks.length + n) && picks.length < 10; i++) {
            const a = arr[i];
            if (!a || !a.ticker || seen.has(a.ticker)) continue;
            seen.add(a.ticker);
            picks.push(a);
            if (picks.length >= (picks.length === 0 ? n : (picks.length))) {/* noop */}
          }
        }
        // Simpler: just take top 5 movers + top 5 by listeners
        for (let i = 0; i < byChange.length && picks.length < 5; i++) {
          const a = byChange[i];
          if (!a || !a.ticker || seen.has(a.ticker)) continue;
          seen.add(a.ticker); picks.push(a);
        }
        for (let i = 0; i < byListeners.length && picks.length < 10; i++) {
          const a = byListeners[i];
          if (!a || !a.ticker || seen.has(a.ticker)) continue;
          seen.add(a.ticker); picks.push(a);
        }

        function fmtPrice(p) {
          const n = Number(p);
          if (n >= 1000) return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
          return '$' + n.toFixed(2);
        }
        function fmtCh(c) {
          if (c == null || isNaN(c)) return { txt: '· 0.00%', cls: 'chip-flat' };
          const cls = c > 0.01 ? 'chip-up' : c < -0.01 ? 'chip-down' : 'chip-flat';
          const arrow = c > 0.01 ? '▲' : c < -0.01 ? '▼' : '·';
          return { txt: arrow + ' ' + Math.abs(c).toFixed(2) + '%', cls };
        }

        // Chip positions spread across the FULL strip area, including
        // the middle (overlapping the CTA card edges). Each entry:
        //   t/l = top/left % within the strip's inset area
        //   r   = initial rotation in deg
        //   d   = animation delay in seconds
        //   a   = drift animation pattern ('A' | 'B' | 'C' | 'D')
        // Layout choices:
        //   - Top row: 3 chips spread across the top
        //   - Middle: chips on both sides AND across the middle
        //   - Bottom row: 3 chips spread across the bottom
        //   - A few chips overlap the card slightly for depth
        const positions = [
          // Top band
          { t: -8,  l: 8,   r: -6,  d: 0.0, a: 'A' },
          { t: -10, l: 44,  r: 4,   d: 0.6, a: 'C' },
          { t: -6,  l: 78,  r: 5,   d: 1.4, a: 'B' },
          // Middle band (sides + center for depth)
          { t: 30,  l: -6,  r: -8,  d: 0.4, a: 'D' },
          { t: 38,  l: 32,  r: 6,   d: 2.1, a: 'A' },
          { t: 32,  l: 92,  r: 7,   d: 1.8, a: 'C' },
          { t: 60,  l: -10, r: 9,   d: 2.5, a: 'B' },
          { t: 56,  l: 60,  r: -5,  d: 0.9, a: 'D' },
          { t: 64,  l: 96,  r: -7,  d: 3.0, a: 'A' },
          // Bottom band
          { t: 102, l: 12,  r: 4,   d: 1.2, a: 'C' },
          { t: 106, l: 50,  r: -6,  d: 2.6, a: 'B' },
          { t: 100, l: 80,  r: 3,   d: 1.6, a: 'D' },
        ];

        strips.forEach(function (strip) {
          // Don't double-mount
          if (strip.querySelector('.muse-cta-scatter')) return;
          const wrap = document.createElement('div');
          wrap.className = 'muse-cta-scatter';
          wrap.setAttribute('aria-hidden', 'true');

          // Tile count varies with viewport: bigger screens get the
          // full spread; mobile keeps just a handful so the layout
          // doesn't clutter the CTA.
          const w = window.innerWidth;
          const count = w < 600 ? 4 : w < 900 ? 7 : w < 1280 ? 10 : 12;

          for (let i = 0; i < count && i < picks.length && i < positions.length; i++) {
            const a = picks[i];
            const pos = positions[i];
            const price = (typeof a.fairPriceMuse === 'number')
              ? a.fairPriceMuse
              : fairFn(a, totalListeners, totalCap);
            const c = fmtCh(a.chg24h);
            const chip = document.createElement('div');
            chip.className = 'muse-cta-chip muse-cta-chip-anim-' + (pos.a || 'A');
            chip.style.setProperty('--r', pos.r + 'deg');
            chip.style.setProperty('--d', pos.d + 's');
            chip.style.top = pos.t + '%';
            chip.style.left = pos.l + '%';
            chip.innerHTML =
              '<span class="chip-tk">' + a.ticker + '</span>' +
              '<span>' + fmtPrice(price) + '</span>' +
              '<span class="' + c.cls + '">' + c.txt + '</span>';
            wrap.appendChild(chip);
          }
          strip.insertBefore(wrap, strip.firstChild);

          // Stagger reveal
          const chips = wrap.querySelectorAll('.muse-cta-chip');
          chips.forEach(function (chip, idx) {
            setTimeout(function () { chip.classList.add('in'); }, 120 * idx + 100);
          });
        });
        return true;
      }

      if (!mount()) {
        let tries = 0;
        const t = setInterval(function () {
          tries++;
          if (mount() || tries > 40) clearInterval(t);
        }, 250);
      }
    })();

    /* -------------------------------------------------------
       3. Count-up animation for [data-count-up]
       ------------------------------------------------------- */
    (function initCountUp() {
      // Auto-apply to common stat-number classes so we don't have to
      // mark every page individually. The element's current text becomes
      // the target value. Skip if already has the attribute.
      const autoSelectors = [
        '.hero-stat-num',
        '.news-trust-stat-num',
        '.compete-stat-value',
        '.lead-stat-num'
      ];
      document.querySelectorAll(autoSelectors.join(',')).forEach(function (el) {
        if (!el.hasAttribute('data-count-up') && !el.hasAttribute('data-no-count-up')) {
          el.setAttribute('data-count-up', el.textContent.trim());
        }
      });

      const targets = document.querySelectorAll('[data-count-up]');
      if (!targets.length) return;

      function parseTarget(el) {
        const raw = el.dataset.countUp || el.textContent || '0';
        // Extract numeric portion
        const m = String(raw).match(/-?[\d,]+(\.\d+)?/);
        if (!m) return null;
        const num = Number(m[0].replace(/,/g, ''));
        if (isNaN(num)) return null;
        const prefix = raw.slice(0, raw.indexOf(m[0]));
        const suffix = raw.slice(raw.indexOf(m[0]) + m[0].length);
        const decimals = (m[0].split('.')[1] || '').length;
        return { num, prefix, suffix, decimals };
      }

      function format(val, decimals) {
        if (decimals > 0) return val.toFixed(decimals);
        const rounded = Math.round(val);
        if (Math.abs(rounded) >= 1000) {
          return rounded.toLocaleString('en-US');
        }
        return String(rounded);
      }

      function animate(el, info) {
        if (reduced) {
          el.textContent = info.prefix + format(info.num, info.decimals) + info.suffix;
          return;
        }
        const dur = 1200;
        const start = performance.now();
        function step(now) {
          const t = Math.min(1, (now - start) / dur);
          // easeOutCubic
          const eased = 1 - Math.pow(1 - t, 3);
          const val = info.num * eased;
          el.textContent = info.prefix + format(val, info.decimals) + info.suffix;
          if (t < 1) requestAnimationFrame(step);
        }
        requestAnimationFrame(step);
      }

      if ('IntersectionObserver' in window) {
        const io = new IntersectionObserver(function (entries) {
          entries.forEach(function (entry) {
            if (!entry.isIntersecting) return;
            const el = entry.target;
            io.unobserve(el);
            const info = parseTarget(el);
            if (info) animate(el, info);
          });
        }, { threshold: 0.4 });
        targets.forEach(function (t) { io.observe(t); });
      } else {
        // Fallback: just set final value
        targets.forEach(function (el) {
          const info = parseTarget(el);
          if (info) el.textContent = info.prefix + format(info.num, info.decimals) + info.suffix;
        });
      }
    })();

    /* -------------------------------------------------------
       4. 3D hover-tilt for cards
       ------------------------------------------------------- */
    (function initTilt() {
      if (reduced) return;
      if (window.matchMedia('(max-width: 760px)').matches) return; // skip on touch
      if (!window.matchMedia('(pointer: fine)').matches) return; // skip on touch

      // Auto-apply tilt to common card-like elements unless opted-out
      const auto = document.querySelectorAll(
        '.featured-card, .humans-item, .contact-card, .news-hero-card, ' +
        '.news-grid-card, .news-side-card, .sec-card, .engine-card'
      );
      auto.forEach(function (el) {
        if (!el.hasAttribute('data-tilt') && !el.hasAttribute('data-no-tilt')) {
          el.setAttribute('data-tilt', '');
        }
      });

      const tilts = document.querySelectorAll('[data-tilt]');
      const MAX = 5; // degrees

      tilts.forEach(function (el) {
        let raf = null;
        el.addEventListener('mouseenter', function () {
          el.style.transition = 'transform .15s cubic-bezier(.2,.7,.2,1)';
        });
        el.addEventListener('mousemove', function (e) {
          const rect = el.getBoundingClientRect();
          const x = (e.clientX - rect.left) / rect.width;  // 0..1
          const y = (e.clientY - rect.top) / rect.height;  // 0..1
          const rx = (0.5 - y) * MAX * 2;  // tilt up when mouse is near top
          const ry = (x - 0.5) * MAX * 2;  // tilt right when mouse is right
          if (raf) cancelAnimationFrame(raf);
          raf = requestAnimationFrame(function () {
            el.style.transform = 'perspective(900px) rotateX(' + rx.toFixed(2) +
              'deg) rotateY(' + ry.toFixed(2) + 'deg) translateZ(0)';
          });
        });
        el.addEventListener('mouseleave', function () {
          if (raf) cancelAnimationFrame(raf);
          el.style.transition = 'transform .35s cubic-bezier(.2,.7,.2,1)';
          el.style.transform = '';
        });
      });
    })();

    /* -------------------------------------------------------
       5. Cursor spotlight on hero sections
       ------------------------------------------------------- */
    (function initSpotlight() {
      if (reduced) return;
      if (!window.matchMedia('(pointer: fine)').matches) return;

      // Auto-apply to sub-hero surfaces only. Homepage section.hero is
      // intentionally excluded per Sander — the cursor-following gradient
      // was too busy ATF.
      const auto = document.querySelectorAll(
        '.hero-wrap, .page-hero, .news-section-head, .wl-hero, .signup-shell'
      );
      auto.forEach(function (el) {
        if (!el.hasAttribute('data-spotlight') && !el.hasAttribute('data-no-spotlight')) {
          el.setAttribute('data-spotlight', '');
        }
      });

      const targets = document.querySelectorAll('[data-spotlight]');
      targets.forEach(function (el) {
        let raf = null;
        el.addEventListener('mousemove', function (e) {
          const rect = el.getBoundingClientRect();
          const x = ((e.clientX - rect.left) / rect.width) * 100;
          const y = ((e.clientY - rect.top) / rect.height) * 100;
          if (raf) cancelAnimationFrame(raf);
          raf = requestAnimationFrame(function () {
            el.style.setProperty('--sx', x + '%');
            el.style.setProperty('--sy', y + '%');
            el.style.setProperty('--so', '1');
          });
        });
        el.addEventListener('mouseleave', function () {
          el.style.setProperty('--so', '0');
        });
      });
    })();
  })();
})();
