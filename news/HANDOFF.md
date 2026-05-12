# News system — what's built, what you need to do

## What changed this session

The blog section is now a **News** section, with a layout modeled on bitcoinmagazine.nl (three-column featured row, top-5 strip, breadcrumb + sidebar article layout, trust card, related articles list). Dark theme retained throughout — same `--ink`, `--ink-dim`, `--violet` palette as the rest of the site.

## File summary

### NEW
- **`news/index.html`** — three-column news index (left side card, hero center, text list right) + Top-5 row below
- **`news/what-is-a-stock-market-for-artists.html`** — restyled article 1 with breadcrumb, hero image, two-column body+sidebar, trust card
- **`news/how-spotify-streams-translate-to-artist-value.html`** — restyled article 2, same layout
- **`news/_TEMPLATE.html`** — reusable template for future articles
- **`app/news-styles.css`** — scoped styles for `body[data-page="news"]` and `body[data-page="news-post"]`. Loaded only on news pages.

### REPLACED (via `.new` files)
- **`netlify.toml`** — added `/blog` → `/news` and `/blog/*` → `/news/:splat` 301 redirects
- **`sitemap.xml`** — `/blog/*` URLs replaced with `/news/*` URLs, priority bumped 0.5 → 0.7 for `/news`
- **`muse-shared.js`** — footer link text "Blog" → "News" and href `/blog` → `/news`

### REMOVED
- `blog.html` and the `blog/` directory entirely. The netlify.toml 301 redirects handle any external link to `/blog` or `/blog/X`.

## How to deploy (one minute)

```bash
cd ~/Documents/Claude/Projects/Muse
bash _internal/migrate-blog-to-news.sh
git add -A
git commit -m "news: btcm.nl-style layout + blog → news rename"
git push
```

The migration script:
1. Verifies all `.new` files and new `/news/*` files exist
2. Backs up `netlify.toml`, `sitemap.xml`, `muse-shared.js`, `blog.html` to timestamped `.bak` files
3. Renames `.new` → live, deletes old `blog.html` + `blog/`
4. Validates the result — redirects present, sitemap clean, muse-shared.js updated

If anything fails it aborts before destroying state. Backups are left at `*.bak.TIMESTAMP` for safety.

## Things to verify after deploy

1. **`https://muses.exchange/news`** loads the new three-column index with article cards
2. **`https://muses.exchange/news/what-is-a-stock-market-for-artists`** renders correctly:
   - Breadcrumb at top: Home / News / Foundations
   - Hero image (Sabrina Carpenter)
   - Two-column layout with trust card sidebar
   - Drop cap on first paragraph
   - Inline `data-top-movers` and `data-artist-card="SABR"` widgets render real data (not "Loading...")
3. **`https://muses.exchange/blog`** 301-redirects to `/news`
4. **`https://muses.exchange/blog/what-is-a-stock-market-for-artists`** 301-redirects to `/news/what-is-a-stock-market-for-artists`
5. **Sitemap** at `https://muses.exchange/sitemap.xml` has `/news` URLs and zero `/blog` URLs
6. **Footer link** on any page now says "News" and links to `/news`

If the live widgets show "Loading..." forever on a news article, `app/prices.js` isn't loading — check browser network tab.

## Writing future news articles

1. Copy `news/_TEMPLATE.html` to `news/your-slug.html`
2. Replace every `[[FILL]]` placeholder
3. Pick a hero image — use an artist's Spotify image URL from `app/prices.js`. The `prices.js` file has per-artist `image` fields like `https://i.scdn.co/image/ab6761610000e5eb78e45cfa4697ce3c437cb455` for Sabrina Carpenter, `https://i.scdn.co/image/ab6761610000e5eb4293385d324db8558179afd9` for Drake, etc.
4. Drop in `<div data-top-movers></div>` and `<div data-artist-card="XXXX"></div>` widgets — they hydrate automatically from live data
5. Add a `<url>` block to `sitemap.xml` (priority 0.6, monthly)
6. Commit + push

## Widget reference (unchanged from before)

```html
<div data-artist-card="DRKE"></div>    <!-- live price card for one artist -->
<div data-top-movers></div>             <!-- today's top 5 gainers -->
<div data-market-index></div>           <!-- inline pill: market index value -->
```

Tickers come from `app/prices.js` — use the 4-letter format (DRKE, SABR, BNNY, SZA, OLVR, etc.).

## Things to do manually (not codeable)

The Search Console / Twitter list / Google Alerts items from the previous handoff still apply. Specifically for this migration:

1. **Re-submit the new sitemap in Google Search Console** — the URL set has changed (/blog → /news). Search Console → Sitemaps → re-submit `sitemap.xml`. Google will fetch the new version on its next crawl.
2. **Update any external links** you've already shared pointing to `/blog/X` — they'll 301 redirect, but a direct link is always faster than a redirected one.

## Confidence levels on the build

- **Layout fidelity to bitcoinmagazine.nl:** Moderate-to-high. Three-column featured row, Top-5 strip, breadcrumb + sidebar article layout, trust card on the right, related-articles list — all present. The exact typography weight, image aspect ratios, and spacing match within a few pixels.
- **Visual cohesion with rest of site:** High. Same dark palette, same fonts (Fraunces serif + Inter sans), same nav and footer.
- **Live widgets working on news pages:** Moderate. `news-styles.css` includes light overrides for the embed cards to look right in the news context. If something looks off, it's likely a CSS specificity issue and a 5-minute fix.
- **Redirect chain `/blog/X` → `/news/X`:** High. Standard Netlify `force = true` redirect, no edge cases.
- **SEO continuity through the rename:** Moderate. 301s preserve link equity, but you're effectively asking Google to re-index. Expect a 1-3 week dip in any `/blog/X` impressions before `/news/X` rankings catch up. If you were ranking on those URLs (you weren't — they were a week old), this would matter more.

## Files written

```
mnt/Muse/
├── netlify.toml.new                                         (REPLACES netlify.toml)
├── sitemap.xml.new                                          (REPLACES sitemap.xml)
├── muse-shared.js.new                                       (REPLACES muse-shared.js)
├── news/
│   ├── HANDOFF.md                                           (this file)
│   ├── _TEMPLATE.html                                       (article template)
│   ├── index.html                                           (news index page)
│   ├── what-is-a-stock-market-for-artists.html              (article 1)
│   └── how-spotify-streams-translate-to-artist-value.html   (article 2)
├── app/
│   └── news-styles.css                                      (scoped news layout styles)
└── _internal/
    └── migrate-blog-to-news.sh                              (deploy script)
```
