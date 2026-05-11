# Blog system — what's built, what you need to do

## What got built this session

### New files (drop-in, no overwrites)
- **`blog/what-is-a-stock-market-for-artists.html`** — first evergreen, ~1500 words, foundational explainer
- **`blog/how-spotify-streams-translate-to-artist-value.html`** — second evergreen, ~1500 words, methodology article
- **`blog/_TEMPLATE.html`** — reusable article template with `[[FILL]]` placeholders, full SEO + schema markup baked in
- **`app/blog-embeds.js`** — live data widget loader (reads from existing `window.__MUSE_PRICES`)
- **`app/blog-embeds.css`** — styles for the widgets, matches existing dark/violet design

### Replacement files (need to be swapped in)
- **`blog.html.new`** → swap in for `blog.html` (current `blog.html` is the "coming soon" placeholder; new version is a real article grid)
- **`sitemap.xml.new`** → swap in for `sitemap.xml` (adds two new article URLs, bumps `/blog` priority from 0.5 → 0.6)

### NOT changed
- **`robots.txt`** — current rules already allow `/blog/*` (the generic `Allow: /` covers it). No edit needed.
- **`muse-shared.css`** and **`muse-shared.js`** — left alone. New articles consume them as-is.
- **`netlify.toml`** — assumed your existing Pretty-URL rewrite handles `/blog/article-slug` → `/blog/article-slug.html` the same way it handles `/about` → `/about.html`. If not, see "Things to verify" below.

## How to deploy (2 minutes)

```bash
cd ~/Documents/Claude/Projects/Muse
bash _internal/deploy-blog-system.sh
git add blog.html blog/ app/blog-embeds.js app/blog-embeds.css sitemap.xml
git commit -m "blog: ship two evergreen articles + reusable system"
git push
```

Netlify will auto-deploy from main. The script renames the `.new` files, backs up the originals (`*.bak.TIMESTAMP`), and validates the HTML basics.

## Live widgets — how to use them in any future article

Drop any of these inline anywhere in a `<div class="post-content">` block:

```html
<div data-artist-card="DRKE"></div>    <!-- Live price card for one artist (use the 4-letter ticker) -->
<div data-top-movers></div>            <!-- Today's top 5 gainers, auto-updated -->
<div data-market-index></div>          <!-- Inline pill: current market index value -->
```

Tickers come from `/app/prices.js` — same ones the trading exchange uses (DRKE, SABR, BNNY, SZA, etc.).

## Things to verify after deploy

1. **Pretty URLs work for `/blog/*`.** Open `https://muses.exchange/blog/what-is-a-stock-market-for-artists` (no `.html`). If you get a 404, your `netlify.toml` has page-specific rewrites and needs a wildcard rule for `/blog/*`. The fix:
   ```toml
   [[redirects]]
     from = "/blog/:slug"
     to = "/blog/:slug.html"
     status = 200
   ```

2. **Live widgets actually render.** Open one of the articles. You should see a "Today's top movers" card with real artist data and a Sabrina Carpenter / Drake price card. If they say "Loading…" forever, `prices.js` isn't loading on the article pages — check the network tab.

3. **No 404 from sitemap.** Open `https://muses.exchange/sitemap.xml`, confirm the two new article URLs are present.

## What you need to do MANUALLY (not codeable)

The Week-1 plan had four items that don't live in the repo. Listed in priority order:

### 1. Google Search Console (15 min)
- Go to: [search.google.com/search-console](https://search.google.com/search-console)
- Add property: `https://muses.exchange` (URL prefix variant, NOT the domain variant — easier to verify)
- Verify ownership via the HTML tag method:
  - Search Console gives you a `<meta name="google-site-verification" content="…">` tag
  - Add it to the `<head>` of `index.html` (and ideally `muse-shared.js` so it's on every page, but `index.html` is enough)
  - Deploy
  - Click Verify in Search Console
- Submit your sitemap: in Search Console → Sitemaps → enter `sitemap.xml` → Submit

### 2. Google Alerts (5 min)
Go to [google.com/alerts](https://google.com/alerts). Create these:
- **Top 20 artists** — set one per artist for the artists most likely to drive news (suggested: Sabrina Carpenter, Taylor Swift, Drake, Chappell Roan, Bad Bunny, The Weeknd, Olivia Rodrigo, Billie Eilish, SZA, Tate McRae). Frequency: As-it-happens. Delivery: Your email.
- **"music industry" weekly digest** — Search term: `music industry`. Frequency: At most once a week. Delivery: Your email.
- **"Spotify streaming"** — Search term: `Spotify streaming`. Frequency: At most once a day.

### 3. Twitter/X music industry list (10 min)
Create a private list. Add these accounts (verified, music-industry focused):
- @MusicBizWW (Music Business Worldwide)
- @hypebot
- @MusicAlly
- @MIDiAResearch
- @CherieHu (Water & Music)
- @markmulligan (MIDiA)
- @stuartdredge
- @billboard
- @PitchforkRSS
- @StereogumNews
- @VarietyMusic
- @RollingStone
- @HITSDailyDouble

Add another 10–20 music journalists you follow personally to round it out to 30+.

### 4. Newsletter subscriptions
- **Hits Daily Double newsletter** — sign up at [hitsdailydouble.com](https://hitsdailydouble.com)
- **Music Business Worldwide newsletter** — sign up at [musicbusinessworldwide.com](https://www.musicbusinessworldwide.com)
- **MIDIA Research blog** — sub at [midiaresearch.com](https://midiaresearch.com)
- **Water & Music** — sub at [waterandmusic.com](https://waterandmusic.com) (some free tier content available)

## What's next (Day 6–7 of your Week-1 plan)

After this is deployed and the manual items above are done, you're ready to start the **daily data-driven news article** rhythm. Each one:

1. Open your news monitoring stack (Google Alerts + Twitter list)
2. Pick today's biggest music industry story
3. Check `window.__MUSE_PRICES` for an artist whose price moved in connection with it
4. Write a 500–800 word post anchored to that data, with at least one `<div data-artist-card="XXXX"></div>` embedded
5. Save in `/blog/[slug].html` using `_TEMPLATE.html`
6. Add a `<url>` block to `sitemap.xml` (priority 0.6, monthly)
7. Commit + push

**Hard rule:** if you can't find a data angle from your platform for the day's news, don't write that day. Skip rather than dilute.

## Confidence levels on what's been built

- **HTML/CSS quality:** High. Matches existing design system, uses real CSS vars, mobile-tested in markup.
- **SEO setup:** High on structural correctness (canonicals, schema.org, OpenGraph, Twitter cards). Moderate on whether you'll rank — that's a 6–12 month domain authority game regardless of how good the pages are.
- **Live widgets working:** Moderate. They depend on `prices.js` loading correctly on blog-post pages. If it doesn't, see verification step 2 above. The fallback ("Loading…") is graceful.
- **Pretty URLs working on `/blog/*`:** Unknown until you deploy and check. If broken, the fix in verification step 1 is one paragraph of netlify.toml.
- **Sitemap correctness:** High. Validated against the existing 128-URL sitemap and matches the same XML structure.

## Files written, summary

```
mnt/Muse/
├── blog.html.new                                            (REPLACES blog.html)
├── sitemap.xml.new                                          (REPLACES sitemap.xml)
├── blog/
│   ├── _TEMPLATE.html                                       (reusable template)
│   ├── what-is-a-stock-market-for-artists.html              (article 1)
│   ├── how-spotify-streams-translate-to-artist-value.html   (article 2)
│   └── HANDOFF.md                                           (this file)
├── app/
│   ├── blog-embeds.js                                       (widget loader)
│   └── blog-embeds.css                                      (widget styles)
└── _internal/
    └── deploy-blog-system.sh                                (deploy script)
```
