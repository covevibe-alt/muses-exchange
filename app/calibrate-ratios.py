#!/usr/bin/env python3
"""
calibrate-ratios.py — Daily kworb-based ratio calibration.

Pulls monthly-listener data from kworb.net (publicly available, refreshes
daily on their side), pairs with current follower counts from the Spotify
Web API (authenticated by client_id/client_secret), and writes per-artist
monthly_listeners / followers ratios to app/listener-ratios.json.

The hourly fetch-prices.py reads listener-ratios.json on every run. When
the partner API is unavailable (no SP_DC, expired, etc.), prices fall
back to followers × ratio per artist — and the ratios are kept fresh by
THIS script so the fallback stays accurate.

Replaces the previous in-browser scraper that ran on Sander's Mac.
Stdlib only — no pip install required.
"""

import base64
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
ARTISTS_PATH = os.path.join(HERE, "artists.json")
RATIOS_PATH = os.path.join(HERE, "listener-ratios.json")

KWORB_URL = "https://kworb.net/spotify/listeners.html"
USER_AGENT = (
    "Mozilla/5.0 (compatible; muses-exchange-bot/1.0; +https://muses.exchange)"
)

# Sanity bounds for per-artist values. Outside these we drop the row.
MIN_LISTENERS = 1_000
MAX_LISTENERS = 500_000_000
MIN_FOLLOWERS = 100

# Safety guard: if we end up with fewer than this many ratios, refuse to
# overwrite the existing file. Prevents a one-off kworb outage from
# wiping our entire calibration table.
MIN_RATIOS_TO_OVERWRITE = 30


def get_spotify_token(client_id: str, client_secret: str) -> str:
    """Client credentials flow."""
    data = urllib.parse.urlencode({"grant_type": "client_credentials"}).encode()
    auth = base64.b64encode(f"{client_id}:{client_secret}".encode()).decode()
    req = urllib.request.Request(
        "https://accounts.spotify.com/api/token",
        data=data,
        headers={
            "Authorization": f"Basic {auth}",
            "Content-Type": "application/x-www-form-urlencoded",
        },
    )
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.loads(resp.read())["access_token"]


def fetch_followers(token: str, spotify_ids):
    """Batch up to 50 IDs per request via /v1/artists?ids=…"""
    out = {}
    for i in range(0, len(spotify_ids), 50):
        batch = spotify_ids[i : i + 50]
        ids = ",".join(batch)
        req = urllib.request.Request(
            f"https://api.spotify.com/v1/artists?ids={ids}",
            headers={"Authorization": f"Bearer {token}"},
        )
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                data = json.loads(resp.read())
        except urllib.error.HTTPError as e:
            print(f"  ! Spotify /artists batch failed: HTTP {e.code}", file=sys.stderr)
            continue
        for a in data.get("artists") or []:
            if not a:
                continue
            followers = (a.get("followers") or {}).get("total")
            if isinstance(followers, int) and followers > 0:
                out[a["id"]] = followers
        time.sleep(0.1)
    return out


def fetch_kworb_listeners():
    """Scrape kworb's global listeners page. Returns {spotify_id: int}.

    The table format we parse:
        <tr><td>{rank}</td>
            <td><a href="artist/{spotify_id}_songs.html">{Name}</a> …</td>
            <td>{listeners}</td>…</tr>
    Spotify IDs are 22-char alphanumerics. We extract the ID from the
    href and the listener count from the next <td> after the artist
    cell. Robust enough to survive minor markup tweaks; will need updating
    if kworb ever fundamentally restructures the table.
    """
    req = urllib.request.Request(KWORB_URL, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=30) as resp:
        html = resp.read().decode("utf-8", errors="replace")

    pattern = re.compile(
        r'href="artist/([A-Za-z0-9]{22})_songs\.html"[^>]*>'
        r"[^<]*</a>"
        r"[^<]*</td>\s*"
        r"<td[^>]*>([\d,]+)</td>",
        re.DOTALL,
    )
    out = {}
    for m in pattern.finditer(html):
        sid = m.group(1)
        try:
            listeners = int(m.group(2).replace(",", ""))
        except ValueError:
            continue
        if MIN_LISTENERS <= listeners <= MAX_LISTENERS:
            out[sid] = listeners
    return out


def main() -> int:
    # Load roster.
    with open(ARTISTS_PATH) as f:
        artists = json.load(f)
    spotify_ids = [a["spotifyId"] for a in artists if a.get("spotifyId")]
    print(f"· loaded {len(artists)} artists ({len(spotify_ids)} with Spotify IDs)")

    # Spotify credentials check.
    client_id = os.environ.get("SPOTIFY_CLIENT_ID", "").strip()
    client_secret = os.environ.get("SPOTIFY_CLIENT_SECRET", "").strip()
    if not client_id or not client_secret:
        print(
            "! SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET not set — cannot calibrate",
            file=sys.stderr,
        )
        return 1

    # 1. Spotify followers.
    print("· requesting Spotify access token…")
    token = get_spotify_token(client_id, client_secret)
    print("✓ got token")
    followers = fetch_followers(token, spotify_ids)
    print(f"✓ followers for {len(followers)}/{len(spotify_ids)} artists")

    # 2. kworb listeners.
    print("· scraping kworb.net listeners table…")
    try:
        listeners = fetch_kworb_listeners()
    except Exception as e:
        print(f"! kworb scrape failed: {e}", file=sys.stderr)
        return 2
    print(f"✓ scraped {len(listeners)} kworb rows")

    # 3. Match + compute ratios.
    ratios = {}
    skipped_no_followers = 0
    skipped_no_listeners = 0
    skipped_low_followers = 0
    for a in artists:
        sid = a.get("spotifyId")
        if not sid:
            continue
        f_count = followers.get(sid)
        l_count = listeners.get(sid)
        if not l_count:
            skipped_no_listeners += 1
            continue
        if not f_count:
            skipped_no_followers += 1
            continue
        if f_count < MIN_FOLLOWERS:
            skipped_low_followers += 1
            continue
        ratios[sid] = round(l_count / f_count, 4)

    print(
        f"· match summary: {len(ratios)} matched, "
        f"{skipped_no_listeners} no-listener, "
        f"{skipped_no_followers} no-follower, "
        f"{skipped_low_followers} <{MIN_FOLLOWERS} followers"
    )

    # Safety guard against partial scrapes wiping the table.
    if len(ratios) < MIN_RATIOS_TO_OVERWRITE:
        print(
            f"! only {len(ratios)} ratios computed — refusing to overwrite "
            f"(threshold: {MIN_RATIOS_TO_OVERWRITE}). Existing file preserved.",
            file=sys.stderr,
        )
        return 3

    # Default = median of matched ratios. Used when an artist has no
    # per-artist row (new artist not yet in kworb's table, etc.).
    sorted_r = sorted(ratios.values())
    default_ratio = round(sorted_r[len(sorted_r) // 2], 4)

    output = {
        "calibratedAt": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "calibratedAtUtc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "description": "Per-artist monthlyListeners/followers ratio.",
        "source": "kworb.net listeners table + Spotify Web API followers",
        "defaultRatio": default_ratio,
        "ratios": ratios,
    }
    with open(RATIOS_PATH, "w") as f:
        json.dump(output, f, indent=2)
        f.write("\n")
    print(
        f"✓ wrote {RATIOS_PATH} "
        f"(default {default_ratio}, {len(ratios)} per-artist ratios)"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
