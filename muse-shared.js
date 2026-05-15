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
  function computeFairPriceMuse(a, totalListeners, totalCap) {
    const listeners = (a && a.monthlyListeners) || 0;
    let marketCap;
    if (totalListeners > 0) {
      marketCap = (listeners / totalListeners) * totalCap;
    } else {
      marketCap = listeners * 0.03; // fallback
    }
    const base = Math.max(0.01, marketCap / 10000);
    const yt  = (a && a.youtubeBoost)     || 0;
    const pop = (a && a.popularityBoost)  || 0;
    const ch  = (a && a.chartBoost)       || 0;
    return base * (1 + yt + pop + ch);
  }
  window.computeFairPriceMuse = computeFairPriceMuse;

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

    const items = data.artists.slice();
    const renderItem = function (a) {
      const price = computeFairPriceMuse(a, totalListeners, totalCap);
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

    const totalListeners = (data.totalMarketListeners
      || data.artists.reduce(function (s, a) { return s + ((a && a.monthlyListeners) || 0); }, 0));
    const totalCap = Math.max(50000000, data.artists.length * 500000);

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
      return a ? computeFairPriceMuse(a, totalListeners, totalCap) : null;
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
    const TURNSTILE_SITEKEY = '1x00000000000000000000AA'; // ← REPLACE for production

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
          <button type="button" class="muse-oauth-btn" data-oauth="facebook" aria-label="Continue with Facebook">
            <svg viewBox="0 0 24 24"><path fill="#1877F2" d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>
            Continue with Facebook
          </button>
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
})();
