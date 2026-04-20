/* =========================================================
   Muses — shared nav + footer + reveal for marketing pages
   ========================================================= */

(function () {
  const page = document.body.dataset.page || '';

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
          <li><a href="/waitlist" data-page="waitlist">Waitlist</a></li>
        </ul>
        <div class="nav-cta-wrap">
          <a class="nav-signin" href="/signin">Sign in</a>
          <a class="nav-cta-secondary" href="/signup">Sign up</a>
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
        <a href="/waitlist" data-page="waitlist">Waitlist</a>
      </nav>
      <div class="md-cta">
        <a class="btn-primary" href="/signup" style="width: 100%; justify-content: center;">
          Sign up — it's free <svg><use href="#i-arrow-up-right"/></svg>
        </a>
        <a class="btn-ghost" href="/exchange" style="width:100%; justify-content:center; margin-top:10px;">
          Launch app <svg><use href="#i-arrow-up-right"/></svg>
        </a>
        <a href="/signin" style="display:block; text-align:center; margin-top:14px; font-family:var(--sans); font-size:14px; color:var(--ink-dim); text-decoration:none;">Already have an account? <span style="color:var(--violet);">Sign in</span></a>
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
            <li><a href="/blog">Blog</a></li>
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

  const PROTOTYPE_BANNER_HTML = `
    <div class="proto-banner" role="note">
      <span class="proto-dot"></span>
      <b>Prototype.</b>&nbsp;Paper trading only<span class="proto-full"> — prices are real, money is virtual.</span><span class="proto-short"> —</span>
      <a href="/faq">Learn more</a>
    </div>
  `;

  const navMount = document.getElementById('nav-mount');
  if (navMount) {
    navMount.innerHTML = PROTOTYPE_BANNER_HTML + NAV_HTML;
  }
  const footMount = document.getElementById('footer-mount');
  if (footMount) footMount.innerHTML = FOOTER_HTML;

  // Mobile sticky CTA (hidden on waitlist page itself)
  if (page !== 'waitlist') {
    const stickyCta = document.createElement('a');
    stickyCta.className = 'mobile-sticky-cta';
    stickyCta.href = '/waitlist';
    stickyCta.setAttribute('aria-label', 'Join the Muses waitlist');
    stickyCta.textContent = 'Join the waitlist';
    document.body.appendChild(stickyCta);
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const h = document.documentElement;
        const scrolled = h.scrollTop / Math.max(1, h.scrollHeight - h.clientHeight);
        // Hide the floating CTA once the user is near the footer so it
        // doesn't cover the disclaimer / "©" line at the page bottom.
        const nearBottom = scrolled > 0.92;
        stickyCta.classList.toggle('show', scrolled > 0.25 && !nearBottom);
        ticking = false;
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
  }

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

  // Page fade-in
  requestAnimationFrame(() => document.body.classList.add('loaded'));

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
