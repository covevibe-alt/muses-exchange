# Muse — Exchange Backend (MVP)

This folder is the **price engine** for the Muse Exchange prototype. It pulls
artist metrics from Spotify (and optionally YouTube) every 30 minutes,
turns them into a synthetic "stock price", and writes `prices.json` +
`history.json`. The frontend (the exchange prototype) just reads those
files — no server, no database.

```
app/
├── fetch-prices.py           ← Python fetcher + pricing formula (canonical)
├── artists.json              ← roster (single source of truth, 105 artists)
├── prices.json               ← latest snapshot (committed, static file)
├── prices.js                 ← same data exposed as window.__MUSE_PRICES
│                               for file:// fallback (loaded via <script>)
├── history.json              ← ~6 months of 30-min price points per ticker
├── history.js                ← file:// fallback mirror of history.json
├── listener-ratios.json      ← backup multiplier table used when the
│                               partner API scrape fails
├── youtube-channels.json     ← cached YouTube channel IDs (auto-populated)
├── package.json              ← legacy, Node runtime not required
├── .github/workflows/
│   └── fetch-prices.yml      ← cron: runs every 30 minutes on GitHub Actions
└── README.md                 ← you are here
```

Only `fetch-prices.py` is executed. There is no Node fetcher.

## How the pricing works

The price is a simple market-cap model:

```
fairPrice = (monthlyListeners × VALUE_PER_LISTENER) / SHARES_OUTSTANDING
            × (1 + youtubeBoost + chartBoost)
```

with the constants

```
VALUE_PER_LISTENER  = €0.03     # per monthly listener
SHARES_OUTSTANDING  = 1 000 000 # fixed float per artist
YOUTUBE_BOOST_MAX   = 0.30      # +30% cap
CHART_BOOST_MAX     = 0.25      # +25% cap
```

So an artist with 40 M monthly listeners, no YouTube or chart boost,
prices at `(40 000 000 × 0.03) / 1 000 000 = €1.20`. With the full +30%
YouTube boost and +25% chart boost on top: `€1.20 × 1.55 = €1.86`.

### Where `monthlyListeners` comes from

Spotify's public Web API does **not** expose monthly listeners — only
followers and a `popularity` score. The fetcher scrapes the real
listener count via Spotify's internal partner API (`api-partner.
spotify.com/pathfinder/v1/query`), authenticated with an `sp_dc` cookie
from a logged-in Spotify web session.

- If the scrape succeeds → `monthlyListeners` = real value.
- If it fails (missing/expired cookie, rate limit, etc.) → fallback to
  `followers × 0.6` as a proxy and mark `listeners_source =
  "follower-proxy"` on the output.

Keeping a valid `SPOTIFY_SP_DC` secret is the single biggest lever on
price accuracy. Without it the prices are still coherent, but they track
followers (a slow-moving loyalty metric) instead of listeners (an
activity metric).

### YouTube boost

If `YOUTUBE_API_KEY` is set, the fetcher pulls each artist's channel
`viewCount` and `subscriberCount` from the YouTube Data API and blends
them into `youtubeBoost`, capped at +30%. Without a YouTube key,
`youtubeBoost` is 0 — prices are pure Spotify.

### Chart boost

The fetcher also reads Spotify's editorial **Top 50 Global** and **Viral
50 Global** playlists. Position 1 → 1.0, position 50 → 0.02, off-chart →
0. The two charts are weighted (Top 50 > Viral 50), the max weighted
score is taken, and the result is scaled to a max of +25% on top of the
base price.

### Smoothing

Prices drift instead of leaping. The new price is an EMA against the
previous run:

```
price_today = 0.85 × price_yesterday + 0.15 × fairPrice
```

…**unless** the new fair price is more than 5× off the previous price in
either direction, in which case we skip smoothing and snap to the new
value (protects against a stale/broken previous run locking the price).

Tune weights in `compute_fair_price()` and `blend_price()` in
`fetch-prices.py`.

## One-time setup

### 1. Create a Spotify developer app (free, 2 minutes)

1. Go to <https://developer.spotify.com/dashboard> and log in with any
   Spotify account (free works fine).
2. Click **Create app**.
3. Fill in:
   - **App name:** Muse Exchange (anything is fine)
   - **App description:** Synthetic artist stock market
   - **Redirect URI:** `http://localhost` (we don't use it, but the form
     requires something)
   - **APIs used:** tick **Web API**
4. Accept the terms, click **Save**.
5. On the app page, click **Settings**. Copy:
   - **Client ID**
   - **Client secret** (click "View client secret")

Keep these somewhere safe for the next step.

### 2. Put the app in a GitHub repo

```bash
cd app
git init
git add .
git commit -m "initial commit"
gh repo create muse-exchange --private --source=. --push
```

(Or create the repo on github.com and push manually — either is fine.)

### 3. Add the Spotify credentials as GitHub Actions secrets

1. Open the repo on GitHub → **Settings** → **Secrets and variables** →
   **Actions** → **New repository secret**.
2. Add two secrets:
   - Name: `SPOTIFY_CLIENT_ID`, value: the client ID from step 1
   - Name: `SPOTIFY_CLIENT_SECRET`, value: the client secret from step 1

### 4. (Recommended) Add the `sp_dc` cookie for real monthly listeners

1. In a regular Chrome/Firefox window, log into <https://open.spotify.com>.
2. Open DevTools → **Application** → **Cookies** →
   `https://open.spotify.com`. Find the cookie named `sp_dc` and copy
   its value (a long base64-ish string).
3. Add it as a GitHub Actions secret: `SPOTIFY_SP_DC`.

The cookie rotates roughly every few months. If you see the log line
`! implausible listener count` or the output flips large numbers of
artists to `listeners_source: follower-proxy`, repeat the steps above to
refresh it.

### 5. Run it once to verify

In the repo on GitHub: **Actions** → **Fetch Muse prices** → **Run
workflow**. Within ~30 seconds you should see a new commit:
`chore: update prices 2026-04-08T17:40Z`.

Open `prices.json` in the repo — the numbers should look like real
Spotify data now (instead of the sample values this file ships with).

That's it. From now on it runs itself every 30 minutes.

## Optional: enabling the YouTube signal

The fetcher works with just Spotify. Adding YouTube data lets prices
react to viral YouTube moments. Setup takes about 3 minutes.

### 1. Get a YouTube Data API v3 key

1. Open <https://console.cloud.google.com/>. Sign in with any Google
   account.
2. Create a new project (top bar → project dropdown → **New project** →
   name it "Muse Exchange" → **Create**).
3. Enable the API: go to **APIs & Services → Library**, search for
   **YouTube Data API v3**, click it, click **Enable**.
4. Create credentials: **APIs & Services → Credentials → Create
   credentials → API key**. Copy the key.
5. (Recommended) Click the key you just made and under **API
   restrictions** restrict it to "YouTube Data API v3" only.

### 2. Add the key

**Locally:** create `app/.env` (kept out of git — check `.gitignore`)
and add one line:

```
YOUTUBE_API_KEY=AIzaSy...your-key-here
```

**On GitHub Actions:** add `YOUTUBE_API_KEY` as another repository
secret alongside your Spotify ones.

### 3. First run is slower (and the second run finishes the job)

The first time the fetcher runs with a YouTube key, it resolves each
artist's YouTube channel ID via a search call (100 quota units each,
one per artist). It caches the results in `youtube-channels.json` so
every subsequent run just hits the cheap stats endpoint (~1 unit per
call).

Daily quota budget, free tier: **10,000 units**. With 105 artists the
resolver would need 10,500 units for a full cold start, so it's capped
at 80 resolutions per run (8,000 units). The remaining ~25 artists
finish on the next run. No action from you — just wait 30 minutes.

After both runs complete, every subsequent run costs ~1 unit. You could
run it every 5 minutes for the rest of time and still stay under the
free tier.

## Running it locally (optional)

```bash
cd app
export SPOTIFY_CLIENT_ID=your_id_here
export SPOTIFY_CLIENT_SECRET=your_secret_here
export SPOTIFY_SP_DC=your_cookie_value   # optional but recommended
export YOUTUBE_API_KEY=AIzaSy...          # optional
python3 fetch-prices.py
```

Needs Python 3.11+. The fetcher uses only the Python standard library —
no `pip install` required.

## Adding or removing artists

Edit **`artists.json`** — it's the single source of truth for the whole
roster. Each entry needs a ticker, name, and genre. The Spotify ID is
optional: leave it as `""` and the fetcher will auto-resolve it via
Spotify search on the next run, writing it back to the file.

```json
{ "ticker": "NEWA", "name": "New Artist", "genre": "Pop", "spotifyId": "" }
```

Ticker must be unique and ≤ 5 characters (the UI is built around
tickers that size). When the roster size changes (e.g. 24 → 105), the
Muse Index automatically rebases to 1000 on the new composition.

## Where the prototype reads this file

The exchange prototype (`Muse - Exchange Prototype.html`) loads price
data two ways:

1. **`file://` fallback** — when the prototype is opened as a local
   file, browsers block `fetch()` from same-origin JSON. The fetcher
   therefore writes `prices.js` and `history.js` alongside the JSON.
   These are loaded via `<script>` tags and expose
   `window.__MUSE_PRICES` / `window.__MUSE_HISTORY`.
2. **`http(s)://` deploy** — when served over HTTP (Netlify, GitHub
   Pages, a raw URL, etc.), the prototype can `fetch('prices.json')`
   directly. Point it at e.g.:

```
https://raw.githubusercontent.com/<you>/muse-exchange/main/prices.json
```

Both work — the prototype just needs *a* JSON file in that shape.

## Troubleshooting

**"Spotify token request failed: 400 invalid_client"** — double-check
the secrets in GitHub Actions. No quotes, no leading spaces.

**"missing Spotify data for …"** — the Spotify ID in `artists.json` is
wrong or the artist was removed. Re-copy the ID from the artist's share
link.

**Lots of `listeners_source: follower-proxy` in `prices.json`** — the
`sp_dc` cookie is missing or expired. Refresh it (see setup step 4).

**Prices barely move between runs** — that's by design. The EMA
smoothing (0.85 / 0.15) is intentionally slow. For more drama, raise
the `0.15` in `blend_price()` toward `0.4` or so.

**First run wipes my sample prices.json** — yes. The sample file only
exists to unblock frontend work before your Spotify credentials are
ready; the first real run replaces it.
