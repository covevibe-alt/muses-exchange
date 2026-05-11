/* =========================================================
   Muses — Blog embed helpers
   ----------------------------------------------------------
   Drop-in widgets for blog articles. Uses window.__MUSE_PRICES
   (loaded by app/prices.js) for live data.

   Available embeds:

   1) Artist card — shows ticker, name, current price, 24h change.
      <div data-artist-card="SABR"></div>

   2) Top movers strip — shows today's top gainers.
      <div data-top-movers></div>

   3) Market index — current index value + 24h change.
      <div data-market-index></div>

   All embeds hydrate on DOMContentLoaded and again after prices
   finish loading (in case the script tag is below the data file).
   ========================================================= */

(function () {
  'use strict';

  function fmtPrice(n) {
    if (n == null || isNaN(n)) return '—';
    return '$' + n.toFixed(2);
  }

  function fmtChange(n) {
    if (n == null || isNaN(n)) return '0.00%';
    const sign = n > 0 ? '+' : '';
    return sign + n.toFixed(2) + '%';
  }

  function changeClass(n) {
    if (n == null || isNaN(n)) return 'muse-embed-flat';
    if (n > 0.01) return 'muse-embed-up';
    if (n < -0.01) return 'muse-embed-down';
    return 'muse-embed-flat';
  }

  function fmtListeners(n) {
    if (n == null || isNaN(n)) return '—';
    if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
    if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
    return String(n);
  }

  function findArtist(ticker) {
    const data = window.__MUSE_PRICES;
    if (!data || !Array.isArray(data.artists)) return null;
    const t = (ticker || '').toUpperCase();
    return data.artists.find(a => a.ticker === t) || null;
  }

  function renderArtistCard(el) {
    const ticker = (el.getAttribute('data-artist-card') || '').toUpperCase();
    const artist = findArtist(ticker);
    if (!artist) {
      el.innerHTML = '<div class="muse-embed-loading">Loading ' + ticker + '…</div>';
      return;
    }
    const slug = (artist.name || '').toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    const cls = changeClass(artist.chg24h);
    el.innerHTML =
      '<a class="muse-embed-card" href="/artists/' + slug + '" data-artist-ticker="' + artist.ticker + '">' +
      '  <div class="muse-embed-card-head">' +
      '    <img class="muse-embed-card-img" src="' + (artist.image || '') + '" alt="' + (artist.name || '') + '" loading="lazy" onerror="this.style.display=&quot;none&quot;">' +
      '    <div class="muse-embed-card-meta">' +
      '      <div class="muse-embed-ticker">$' + artist.ticker + '</div>' +
      '      <div class="muse-embed-name">' + (artist.name || '') + '</div>' +
      '      <div class="muse-embed-genre">' + (artist.genre || '') + '</div>' +
      '    </div>' +
      '  </div>' +
      '  <div class="muse-embed-card-stats">' +
      '    <div class="muse-embed-price">' + fmtPrice(artist.price) + '</div>' +
      '    <div class="muse-embed-change ' + cls + '">' + fmtChange(artist.chg24h) + '</div>' +
      '  </div>' +
      '  <div class="muse-embed-card-footer">' +
      '    <span class="muse-embed-stat"><span class="muse-embed-stat-label">Monthly listeners</span><span class="muse-embed-stat-value">' + fmtListeners(artist.monthlyListeners) + '</span></span>' +
      '    <span class="muse-embed-stat"><span class="muse-embed-stat-label">Followers</span><span class="muse-embed-stat-value">' + fmtListeners(artist.followers) + '</span></span>' +
      '  </div>' +
      '  <div class="muse-embed-card-cta">View on the exchange →</div>' +
      '</a>';
  }

  function renderTopMovers(el) {
    const data = window.__MUSE_PRICES;
    if (!data || !Array.isArray(data.topGainers)) {
      el.innerHTML = '<div class="muse-embed-loading">Loading market data…</div>';
      return;
    }
    const tickers = data.topGainers.slice(0, 5);
    const items = tickers.map(g => {
      const artist = findArtist(g.ticker);
      if (!artist) return '';
      const slug = (artist.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const cls = changeClass(g.chg24h);
      return '<a class="muse-embed-mover" href="/artists/' + slug + '">' +
             '<span class="muse-embed-mover-name">' + artist.name + '</span>' +
             '<span class="muse-embed-mover-ticker">$' + artist.ticker + '</span>' +
             '<span class="muse-embed-mover-change ' + cls + '">' + fmtChange(g.chg24h) + '</span>' +
             '</a>';
    }).join('');
    el.innerHTML =
      '<div class="muse-embed-strip">' +
      '  <div class="muse-embed-strip-head">Today\'s top movers</div>' +
      '  <div class="muse-embed-strip-list">' + items + '</div>' +
      '  <a class="muse-embed-strip-cta" href="/exchange">See the live markets →</a>' +
      '</div>';
  }

  function renderMarketIndex(el) {
    const data = window.__MUSE_PRICES;
    if (!data) {
      el.innerHTML = '<div class="muse-embed-loading">Loading…</div>';
      return;
    }
    el.innerHTML =
      '<div class="muse-embed-mini">' +
      '  <span class="muse-embed-mini-label">Muses market index</span>' +
      '  <span class="muse-embed-mini-value">' + (data.marketIndex != null ? data.marketIndex.toFixed(2) : '—') + '</span>' +
      '</div>';
  }

  function hydrateAll() {
    document.querySelectorAll('[data-artist-card]').forEach(renderArtistCard);
    document.querySelectorAll('[data-top-movers]').forEach(renderTopMovers);
    document.querySelectorAll('[data-market-index]').forEach(renderMarketIndex);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', hydrateAll);
  } else {
    hydrateAll();
  }

  // Re-hydrate once prices load (handles script-order races)
  let tries = 0;
  const t = setInterval(() => {
    tries++;
    if (window.__MUSE_PRICES || tries > 40) {
      clearInterval(t);
      hydrateAll();
    }
  }, 250);
})();
