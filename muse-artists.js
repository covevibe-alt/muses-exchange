/* =========================================================================
   Muse — shared artist-photo loader

   Fetches artist profile photos from Wikipedia and injects them into any
   element with a matching `data-ticker` attribute. Works across all
   marketing site pages. Gradient + initial remains the fallback if a
   fetch fails.

   Usage on a page:
     1. Give any avatar div a data-ticker attr, e.g. data-ticker="SABR"
     2. Include this script: <script src="muse-artists.js"></script>
     3. For dynamically-rendered avatars, call window.MuseArtists.inject()
        after your render function runs.
   ========================================================================= */
(function () {
  const ARTIST_WIKI = {
    SABR: 'Sabrina_Carpenter',
    BNNY: 'Bad_Bunny',
    CHPL: 'Chappell_Roan',
    TSWF: 'Taylor_Swift',
    WKND: 'The_Weeknd',
    TYLA: 'Tyla',
    PESO: 'Peso_Pluma',
    OLVR: 'Olivia_Rodrigo',
    DRKE: 'Drake_(musician)',
    BILL: 'Billie_Eilish',
    TATE: 'Tate_McRae',
    ROSA: 'Rosalía_(singer)',
    TRVS: 'Travis_Scott',
    KROL: 'Karol_G',
    LANA: 'Lana_Del_Rey',
    ICE:  'Ice_Spice',
    DUAL: 'Dua_Lipa',
    REMA: 'Rema_(singer)',
    MARI: 'The_Marías',
    CLRO: 'Clairo',
    KDOT: 'Kendrick_Lamar',
    SZA:  'SZA',
    AYRA: 'Ayra_Starr',
    BEAB: 'Beabadoobee',
  };

  const ARTIST_IMGS = {};
  let loadPromise = null;

  function preloadImage(url) {
    return new Promise(resolve => {
      const img = new Image();
      img.onload = () => resolve(true);
      img.onerror = () => resolve(false);
      img.src = url;
    });
  }

  function inject(root) {
    (root || document).querySelectorAll('[data-ticker]').forEach(el => {
      const url = ARTIST_IMGS[el.dataset.ticker];
      if (!url) return;
      const existing = el.querySelector('img.artist-photo');
      if (existing && existing.src === url) return;
      if (existing) existing.remove();
      const img = document.createElement('img');
      img.src = url;
      img.className = 'artist-photo';
      img.alt = '';
      img.onerror = () => img.remove();
      el.appendChild(img);
    });
  }

  function load() {
    if (loadPromise) return loadPromise;
    // Fast path: if window.__MUSE_PRICES is loaded (prices.js), every
    // artist already has a Spotify CDN image URL. Use those directly and
    // skip the Wikipedia round-trip entirely. This covers all 105 artists.
    if (window.__MUSE_PRICES && Array.isArray(window.__MUSE_PRICES.artists)) {
      window.__MUSE_PRICES.artists.forEach(a => {
        if (a.image && a.ticker) ARTIST_IMGS[a.ticker] = a.image;
      });
      inject();
    }
    loadPromise = Promise.all(Object.entries(ARTIST_WIKI).map(async ([ticker, wiki]) => {
      if (ARTIST_IMGS[ticker]) return; // already have a Spotify image

      try {
        const res = await fetch('https://en.wikipedia.org/api/rest_v1/page/summary/' + encodeURIComponent(wiki));
        if (!res.ok) return;
        const data = await res.json();
        const candidates = [];
        if (data.thumbnail && data.thumbnail.source) {
          candidates.push(data.thumbnail.source.replace(/\/\d+px-/, '/320px-'));
          candidates.push(data.thumbnail.source);
        }
        if (data.originalimage && data.originalimage.source) {
          candidates.push(data.originalimage.source);
        }
        for (const url of candidates) {
          if (await preloadImage(url)) {
            ARTIST_IMGS[ticker] = url;
            break;
          }
        }
      } catch (e) {}
    })).then(() => inject());
    return loadPromise;
  }

  window.MuseArtists = {
    WIKI: ARTIST_WIKI,
    IMGS: ARTIST_IMGS,
    inject,
    load,
    ready: () => load(),
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', load);
  } else {
    load();
  }
})();
