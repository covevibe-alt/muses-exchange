#!/usr/bin/env python3
"""Fetch UEFA Champions League fixtures + results from ESPN's public API.

Writes app/ucl-data.json and app/ucl-data.js (a window.UCL_DATA wrapper, same
pattern as prices.js and wc2026-data.js) for the /ucl predictions pool page.

Why this exists: the pool originally read ESPN straight from the reader's
browser. When that fetch failed — a blocked request, a shape change, a window
ESPN declined to answer — every browser silently kept serving its own stale
cache, so fixtures rendered but results never arrived and nobody scored. This
moves the fetch onto GitHub's runners and commits the answer, so the page has
a server-side source of truth and the browser's own ESPN call becomes a
live-score optimisation rather than the only thing holding the pool up.

Run by .github/workflows/ucl-results.yml. No API key required. Safe by design:

  * Fetched in MONTH windows: ESPN answers a date range it considers too wide
    with an empty event list rather than an error, which is indistinguishable
    from "nothing scheduled".
  * New fetches are MERGED into the existing file by event id, so a partial or
    flaky response can never clobber previously fetched matches.
  * If the fetch fails outright, the script exits 0 without touching the files
    and the last good data keeps being served.
"""

import json
import re
import sys
import time
import unicodedata
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
JSON_PATH = HERE / "ucl-data.json"
JS_PATH = HERE / "ucl-data.js"

BASE = ("https://site.api.espn.com/apis/site/v2/sports/soccer/uefa.champions/"
        "scoreboard")

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0 Safari/537.36")

# Order matters: "quarterfinals" and "semifinals" both contain "final", so the
# narrower rounds have to be tested before the final does.
STAGE_PATTERNS = [
    (re.compile(r"semi", re.I), "SF"),
    (re.compile(r"quarter", re.I), "QF"),
    (re.compile(r"round of 16|last 16|1/8", re.I), "R16"),
    (re.compile(r"play-?off", re.I), "PO"),
    (re.compile(r"league phase|league stage|matchday|group", re.I), "LEAGUE"),
    (re.compile(r"\bfinals?\b", re.I), "FINAL"),
]
LEG_RE = re.compile(r"leg\s*([12])\b|\b([12])(?:st|nd)\s*leg", re.I)
MATCHDAY_RE = re.compile(r"matchday\s*(\d+)", re.I)
PLACEHOLDER_RE = re.compile(r"winner|runner|loser|\btbd\b|to be determined", re.I)


def dig(obj, *keys):
    """Nested lookup that tolerates ESPN handing back a scalar where a previous
    season handed back an object. `event.season.type` is an int on the current
    payload, and `(1).get("name")` took down every event in the feed."""
    for key in keys:
        if not isinstance(obj, dict):
            return None
        obj = obj.get(key)
    return obj


def fetch(params=""):
    """One scoreboard call. Returns (payload, error_string)."""
    url = f"{BASE}?limit=400{params}"
    req = urllib.request.Request(url, headers={"User-Agent": UA,
                                               "Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=45) as resp:
            return json.loads(resp.read().decode("utf-8")), None
    except Exception as exc:  # noqa: BLE001
        return None, f"{type(exc).__name__}: {exc}"


def calendar_days(payload):
    """Match dates ESPN itself advertises for the season.

    ESPN stopped accepting the `dates=YYYYMMDD-YYYYMMDD` range form on this
    endpoint — it answers 400 Bad Request — so the season can't be pulled in a
    few wide calls any more. The bare scoreboard response carries the league's
    own calendar of matchday dates; fetch those one day at a time instead of
    guessing at a format ESPN may change again.
    """
    days = set()

    def walk(node):
        if isinstance(node, str):
            if re.match(r"^\d{4}-\d{2}-\d{2}", node):
                days.add(node[:10].replace("-", ""))
        elif isinstance(node, dict):
            for key in ("startDate", "endDate", "date"):
                if isinstance(node.get(key), str):
                    walk(node[key])
            walk(node.get("entries"))
        elif isinstance(node, list):
            for item in node:
                walk(item)

    for league in payload.get("leagues") or []:
        walk(league.get("calendar"))
    return sorted(days)


def parse_date(raw):
    if not raw:
        return None
    raw = raw.replace("Z", "+00:00")
    try:
        dt = datetime.fromisoformat(raw)
    except ValueError:
        return None
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def stage_from_event(notes_text, iso_date):
    for pattern, stage in STAGE_PATTERNS:
        if pattern.search(notes_text):
            return stage
    # Calendar fallback for a season running September -> late May.
    try:
        month = datetime.strptime(iso_date, "%Y-%m-%dT%H:%M:%SZ").month
        day = datetime.strptime(iso_date, "%Y-%m-%dT%H:%M:%SZ").day
    except (TypeError, ValueError):
        return "LEAGUE"
    if month >= 9 or month == 1:
        return "LEAGUE"
    if month == 2:
        return "PO"
    if month == 3:
        return "R16"
    if month == 4:
        return "QF" if day <= 20 else "SF"
    if month == 5:
        return "SF" if day <= 15 else "FINAL"
    if month == 6:
        return "FINAL"
    return "LEAGUE"


def to_int(value):
    """ESPN has returned score as a string, a number and an object
    ({value, displayValue}) depending on endpoint and season."""
    if isinstance(value, dict):
        value = value.get("value", value.get("displayValue"))
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def parse_team(competitor):
    team = competitor.get("team")
    if not isinstance(team, dict):
        team = {}
    logo = team.get("logo")
    if not logo:
        logos = team.get("logos") or []
        first = logos[0] if logos else None
        logo = first.get("href") if isinstance(first, dict) else None
    name = (team.get("shortDisplayName") or team.get("displayName")
            or team.get("name") or "TBD")
    out = {
        "id": str(team.get("id") or ""),
        "name": name,
        "full": team.get("displayName") or team.get("name") or "",
        "abbr": team.get("abbreviation") or "",
        "logo": logo or "",
    }
    if name == "TBD" or PLACEHOLDER_RE.search(name):
        out["tbd"] = True
    return out


def parse_scorers(comp):
    out = []
    for d in comp.get("details") or []:
        try:
            if not d.get("scoringPlay") or d.get("ownGoal"):
                continue
            athletes = d.get("athletesInvolved") or []
            name = (athletes[0] or {}).get("displayName") if athletes else None
            if name:
                out.append({"n": name})
        except Exception:  # noqa: BLE001
            continue
    return out or None


def parse_event(event):
    comp = (event.get("competitions") or [{}])[0]
    iso_date = parse_date(event.get("date") or comp.get("date"))
    if not iso_date or not event.get("id"):
        return None

    notes = (comp.get("notes") or []) + (event.get("notes") or [])
    notes_text = " ".join(
        f"{n.get('headline', '')} {n.get('text', '')}"
        for n in notes if isinstance(n, dict))
    label = " ".join([notes_text,
                      dig(event, "season", "type", "name") or "",
                      event.get("name") or "", event.get("shortName") or ""])

    home, away = {}, {}
    for c in comp.get("competitors") or []:
        side = c.get("homeAway")
        parsed = parse_team(c)
        parsed["_score"] = to_int(c.get("score"))
        parsed["_shootout"] = to_int(c.get("shootoutScore"))
        parsed["_winner"] = bool(c.get("winner"))
        if side == "home":
            home = parsed
        elif side == "away":
            away = parsed

    status = comp.get("status") or event.get("status") or {}
    if not isinstance(status, dict):
        status = {}
    stype = status.get("type")
    if not isinstance(stype, dict):
        stype = {}
    state = stype.get("state") or "pre"
    # `completed` is absent on some payloads where the state already says post.
    completed = bool(stype.get("completed")) or str(state).lower() == "post"

    venue = comp.get("venue")
    if not isinstance(venue, dict):
        venue = {}
    stage = stage_from_event(label, iso_date)

    leg_match = LEG_RE.search(label)
    leg = int(leg_match.group(1) or leg_match.group(2)) if leg_match else None
    md_match = MATCHDAY_RE.search(label)
    matchday = int(md_match.group(1)) if md_match else None
    if matchday is not None and not 1 <= matchday <= 8:
        matchday = None

    hs = home.pop("_score", None)
    as_ = away.pop("_score", None)
    so_h = home.pop("_shootout", None)
    so_a = away.pop("_shootout", None)
    home_won = home.pop("_winner", False)
    away_won = away.pop("_winner", False)

    winner = advances = None
    if completed and hs is not None and as_ is not None:
        winner = "home" if hs > as_ else "away" if as_ > hs else "draw"
        if home_won:
            advances = "home"
        elif away_won:
            advances = "away"
        elif winner != "draw":
            advances = winner

    decided_by = None
    if completed and stage != "LEAGUE":
        so_present = so_h is not None or so_a is not None
        name = (stype.get("name") or "").upper()
        text = " ".join(str(stype.get(k) or "")
                        for k in ("detail", "shortDetail", "description")).upper()
        period = status.get("period")
        if so_present or "PEN" in name or "SHOOTOUT" in name or "PEN" in text:
            decided_by = "PENS"
        elif ("AET" in name or "AET" in text or "EXTRA" in name or "EXTRA" in text
              or (isinstance(period, int) and period >= 3)):
            decided_by = "EXTRA"
        else:
            decided_by = "REGULAR"

    return {
        "id": str(event["id"]),
        "date": iso_date,
        "stage": stage,
        "leg": leg,
        "matchday": matchday,
        "venue": venue.get("fullName") or "",
        "city": dig(venue, "address", "city") or "",
        "home": home or {"id": "", "name": "TBD", "abbr": "", "logo": "", "tbd": True},
        "away": away or {"id": "", "name": "TBD", "abbr": "", "logo": "", "tbd": True},
        "state": state,
        "completed": completed,
        "detail": stype.get("shortDetail") or stype.get("detail") or "",
        "clock": status.get("displayClock") or "",
        "hs": hs,
        "as": as_,
        "so": {"h": so_h, "a": so_a} if (so_h is not None or so_a is not None) else None,
        "winner": winner,
        "advances": advances,
        "decidedBy": decided_by,
        "scorers": parse_scorers(comp),
    }


def load_existing():
    try:
        with open(JSON_PATH, encoding="utf-8") as fh:
            return {m["id"]: m for m in json.load(fh).get("matches", [])}
    except (OSError, ValueError, KeyError):
        return {}


def parse_all(payload):
    out = []
    for event in (payload or {}).get("events") or []:
        try:
            match = parse_event(event)
        except Exception as exc:  # noqa: BLE001
            print(f"WARN: skipping unparseable event {event.get('id')}: {exc}")
            continue
        if match:
            out.append(match)
    return out


def main():
    parsed, failures = [], []

    # 1. Bare scoreboard: whatever is on now, plus the league's own calendar.
    payload, err = fetch()
    if err:
        print(f"WARN: bare scoreboard failed: {err}")
        failures.append(f"bare: {err}")
    if payload:
        got = parse_all(payload)
        print(f"bare scoreboard: {len(payload.get('events') or [])} events, {len(got)} parsed")
        parsed.extend(got)

    existing = load_existing()
    now = datetime.now(timezone.utc)
    days = set()

    # The calendar turned out to list phase boundaries rather than matchdays,
    # so it's a hint, not the plan.
    if payload:
        days |= set(calendar_days(payload))

    # Always re-check the days around now: live matches and ones that have just
    # finished are the whole point of running every half hour.
    days |= {f"{now + timedelta(days=d):%Y%m%d}" for d in range(-7, 8)}

    # Keep every fixture we already know about refreshed — that set is exactly
    # the days this competition plays on, learned rather than guessed.
    days |= {m["date"][:10].replace("-", "") for m in existing.values() if m.get("date")}

    # Cold start: no file yet, so sweep the season to date. ~90 calls once,
    # then the line above keeps subsequent runs down to the days that matter.
    if not existing:
        season_start = datetime(now.year if now.month >= 7 else now.year - 1,
                                8, 1, tzinfo=timezone.utc)
        cursor = season_start
        while cursor <= now + timedelta(days=14):
            days.add(f"{cursor:%Y%m%d}")
            cursor += timedelta(days=1)
        print(f"cold start: sweeping {len(days)} days from {season_start:%Y-%m-%d}")

    # 2. One call per day. Single days are the only `dates` form ESPN still
    #    honours here; ranges answer 400 Bad Request.
    for day in sorted(days):
        p2, e2 = fetch(f"&dates={day}")
        if e2:
            failures.append(f"{day}: {e2}")
            continue
        got = parse_all(p2)
        if got:
            print(f"{day}: {len(got)} events")
        parsed.extend(got)
        time.sleep(0.15)   # be a polite guest

    if failures:
        print(f"WARN: {len(failures)} call(s) failed: {'; '.join(failures[:3])}")
    if not parsed:
        print("WARN: ESPN returned no parseable events, keeping existing data")
        return 0

    merged = load_existing()
    for m in parsed:
        old = merged.get(m["id"])
        if old and not m.get("scorers") and old.get("scorers"):
            m["scorers"] = old["scorers"]
        merged[m["id"]] = m

    matches = sorted(merged.values(), key=lambda m: (m["date"], m["id"]))
    played = sum(1 for m in matches if m["completed"])
    data = {
        "fetchedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "matches": matches,
    }
    JSON_PATH.write_text(json.dumps(data, ensure_ascii=False, indent=1) + "\n",
                         encoding="utf-8")
    JS_PATH.write_text("window.UCL_DATA = "
                       + json.dumps(data, ensure_ascii=False, separators=(",", ":"))
                       + ";\n", encoding="utf-8")
    print(f"wrote {len(matches)} matches ({played} completed)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
