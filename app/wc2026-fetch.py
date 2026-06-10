#!/usr/bin/env python3
"""Fetch FIFA World Cup 2026 fixtures + results from ESPN's public API.

Writes app/wc2026-data.json and app/wc2026-data.js (a window.WC2026_DATA
wrapper, same pattern as prices.js) for the /wc2026 predictions pool page.

Run by .github/workflows/wc2026-results.yml on a schedule during June/July
2026. No API key required. Safe-by-design:

  * New fetches are MERGED into the existing file by event id, so a partial
    or flaky ESPN response can never clobber previously fetched matches.
  * If the fetch fails outright, the script exits 0 without touching the
    files — the last good data keeps being served.
"""

import json
import re
import sys
import unicodedata
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
JSON_PATH = HERE / "wc2026-data.json"
JS_PATH = HERE / "wc2026-data.js"

# Whole tournament window (Jun 11 – Jul 19) plus buffer days for timezone
# spill on ESPN's side.
URL = ("https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/"
       "scoreboard?dates=20260608-20260722&limit=400")

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0 Safari/537.36")

STAGE_PATTERNS = [
    (re.compile(r"round of 32", re.I), "R32"),
    (re.compile(r"round of 16", re.I), "R16"),
    (re.compile(r"quarter", re.I), "QF"),
    (re.compile(r"semi", re.I), "SF"),
    (re.compile(r"third", re.I), "THIRD"),
    (re.compile(r"\bfinal\b", re.I), "FINAL"),
    (re.compile(r"group", re.I), "GROUP"),
]
GROUP_RE = re.compile(r"group\s+([A-L])\b", re.I)

# ESPN's scoreboard doesn't expose group letters, so map them from the final
# draw (Washington D.C., Dec 5 2025). Names are ESPN displayNames verbatim.
TEAM_GROUPS = {}
for _letter, _teams in {
    "A": ["Mexico", "South Africa", "South Korea", "Czechia"],
    "B": ["Canada", "Bosnia-Herzegovina", "Qatar", "Switzerland"],
    "C": ["Brazil", "Morocco", "Haiti", "Scotland"],
    "D": ["United States", "Paraguay", "Australia", "Türkiye"],
    "E": ["Germany", "Curaçao", "Ivory Coast", "Ecuador"],
    "F": ["Netherlands", "Japan", "Sweden", "Tunisia"],
    "G": ["Belgium", "Egypt", "Iran", "New Zealand"],
    "H": ["Spain", "Cape Verde", "Saudi Arabia", "Uruguay"],
    "I": ["France", "Senegal", "Iraq", "Norway"],
    "J": ["Argentina", "Algeria", "Austria", "Jordan"],
    "K": ["Portugal", "Congo DR", "Uzbekistan", "Colombia"],
    "L": ["England", "Croatia", "Ghana", "Panama"],
}.items():
    for _t in _teams:
        TEAM_GROUPS[_t] = _letter

# Knockout slots are published with placeholder "teams" until decided.
PLACEHOLDER_RE = re.compile(
    r"(1st|2nd|3rd)\s+place|winner|runner|loser|\btbd\b|to be determined", re.I)


def fetch_scoreboard():
    req = urllib.request.Request(URL, headers={"User-Agent": UA,
                                               "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=45) as resp:
        return json.loads(resp.read().decode("utf-8"))


def parse_date(raw):
    """ESPN dates look like 2026-06-11T19:00Z — normalize to full ISO UTC."""
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
            # "Final" also matches semi-final/quarterfinal headlines, but those
            # patterns are checked first, so reaching FINAL here is safe.
            return stage
    # Fallback: derive from the fixed tournament calendar. Boundaries are
    # local (US Eastern) days — late kickoffs spill past midnight UTC, so
    # shift by -4h before comparing (e.g. 02:00Z Jun 28 = 22:00 EDT Jun 27,
    # still a group-stage day).
    try:
        dt = datetime.strptime(iso_date, "%Y-%m-%dT%H:%M:%SZ")
        day = (dt - timedelta(hours=4)).strftime("%Y-%m-%d")
    except (TypeError, ValueError):
        day = iso_date[:10] if iso_date else ""
    if day <= "2026-06-27":
        return "GROUP"
    if day <= "2026-07-03":
        return "R32"
    if day <= "2026-07-07":
        return "R16"
    if day <= "2026-07-12":
        return "QF"
    if day <= "2026-07-16":
        return "SF"
    if day <= "2026-07-18":
        return "THIRD"
    return "FINAL"


def to_int(value):
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def parse_team(competitor):
    team = competitor.get("team") or {}
    logo = team.get("logo")
    if not logo:
        logos = team.get("logos") or [{}]
        logo = logos[0].get("href")
    name = team.get("displayName") or team.get("name") or "TBD"
    out = {
        "id": str(team.get("id") or ""),
        "name": name,
        "abbr": team.get("abbreviation") or "",
        "logo": logo or "",
    }
    # Undecided knockout slots ("Group A 2nd Place", "Winner Match 74", …):
    # keep the name for display, flag so the UI doesn't open predictions yet.
    if name == "TBD" or PLACEHOLDER_RE.search(name):
        out["tbd"] = True
    return out


def parse_scorers(comp):
    """Goalscorers from ESPN match details (feeds the golden-boot race).
    Own goals don't count toward the award; shootout kicks aren't in details."""
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


def norm_name(name):
    decomposed = unicodedata.normalize("NFD", name or "")
    stripped = "".join(c for c in decomposed if not unicodedata.combining(c))
    return " ".join(stripped.lower().split())


def parse_event(event):
    comp = (event.get("competitions") or [{}])[0]
    iso_date = parse_date(event.get("date") or comp.get("date"))
    if not iso_date or not event.get("id"):
        return None

    notes = comp.get("notes") or event.get("notes") or []
    notes_text = " ".join(n.get("headline", "") for n in notes if isinstance(n, dict))

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
    stype = status.get("type") or {}
    state = stype.get("state") or "pre"          # pre | in | post
    completed = bool(stype.get("completed"))

    venue = comp.get("venue") or {}
    stage = stage_from_event(notes_text, iso_date)
    group_match = GROUP_RE.search(notes_text)
    group = group_match.group(1).upper() if group_match else None
    if group is None and stage == "GROUP":
        gh = TEAM_GROUPS.get(home.get("name", ""))
        ga = TEAM_GROUPS.get(away.get("name", ""))
        if gh and gh == ga:
            group = gh

    hs = home.pop("_score", None)
    as_ = away.pop("_score", None)
    so_h = home.pop("_shootout", None)
    so_a = away.pop("_shootout", None)
    home_won_flag = home.pop("_winner", False)
    away_won_flag = away.pop("_winner", False)

    winner = None        # 90'+ET scoreline outcome (what predictions score on)
    advances = None      # who actually goes through (incl. shootout)
    if completed and hs is not None and as_ is not None:
        winner = "home" if hs > as_ else "away" if as_ > hs else "draw"
        if home_won_flag:
            advances = "home"
        elif away_won_flag:
            advances = "away"
        elif winner != "draw":
            advances = winner

    return {
        "id": str(event["id"]),
        "date": iso_date,
        "stage": stage,
        "group": group,
        "venue": venue.get("fullName") or "",
        "city": ((venue.get("address") or {}).get("city")) or "",
        "home": home or {"id": "", "name": "TBD", "abbr": "", "logo": ""},
        "away": away or {"id": "", "name": "TBD", "abbr": "", "logo": ""},
        "state": state,
        "completed": completed,
        "detail": stype.get("shortDetail") or stype.get("detail") or "",
        "clock": status.get("displayClock") or "",
        "hs": hs,
        "as": as_,
        "so": {"h": so_h, "a": so_a} if (so_h is not None or so_a is not None) else None,
        "winner": winner,
        "advances": advances,
        "scorers": parse_scorers(comp),
    }


def load_existing():
    try:
        with open(JSON_PATH, encoding="utf-8") as fh:
            return {m["id"]: m for m in json.load(fh).get("matches", [])}
    except (OSError, ValueError, KeyError):
        return {}


def main():
    try:
        payload = fetch_scoreboard()
    except Exception as exc:  # noqa: BLE001 — keep last good data on any failure
        print(f"WARN: ESPN fetch failed, keeping existing data: {exc}")
        return 0

    events = payload.get("events") or []
    parsed = []
    for event in events:
        try:
            match = parse_event(event)
        except Exception as exc:  # noqa: BLE001
            print(f"WARN: skipping unparseable event {event.get('id')}: {exc}")
            continue
        if match:
            parsed.append(match)

    if not parsed:
        print("WARN: ESPN returned no parseable events, keeping existing data")
        return 0

    merged = load_existing()
    for m in parsed:
        old = merged.get(m["id"])
        if old and not m.get("scorers") and old.get("scorers"):
            m["scorers"] = old["scorers"]  # don't lose scorers to a thin payload
        merged[m["id"]] = m
    matches = sorted(merged.values(), key=lambda m: (m["date"], m["id"]))

    # Golden-boot tally across the whole tournament.
    tally, display = {}, {}
    for m in matches:
        for s in m.get("scorers") or []:
            key = norm_name(s.get("n"))
            if not key:
                continue
            tally[key] = tally.get(key, 0) + 1
            display.setdefault(key, s["n"])
    top_scorers = [{"name": display[k], "goals": v}
                   for k, v in sorted(tally.items(), key=lambda kv: (-kv[1], kv[0]))[:20]]

    data = {
        "fetchedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": "espn",
        "matchCount": len(matches),
        "topScorers": top_scorers,
        "matches": matches,
    }

    blob = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    JSON_PATH.write_text(blob + "\n", encoding="utf-8")
    JS_PATH.write_text("window.WC2026_DATA = " + blob + ";\n", encoding="utf-8")

    by_stage = {}
    for m in matches:
        by_stage[m["stage"]] = by_stage.get(m["stage"], 0) + 1
    print(f"OK: wrote {len(matches)} matches {by_stage}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
