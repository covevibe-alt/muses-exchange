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
})();
