# Muses — Mobile Audit (428×831, iPhone 14 Plus)

**Method:** Live audit at true 428px viewport via user's Mobile simulator Chrome extension, driving the iframe via `setView()` and programmatic scroll. Covered: landing, Markets, Artists genres, Artist detail, Portfolio, Orders, Swap, Tournaments, Tournament detail, Leaderboard, Profile, Settings, Help, Hamburger drawer. Signup/signin pages inspected via source (no media queries present).

Severity key: **CRIT** = broken or misleading, **HIGH** = visibly wrong/awkward, **MED** = polish, **LOW** = nit.

---

## CRITICAL — data/logic bugs exposed during the audit (not strictly mobile)

1. **Orders view crashes on mount.** `renderOrdersView` at exchange.html:13593 calls `document.getElementById('orders-count-recurring').textContent = …`, but the `orders-count-recurring` span no longer exists in the HTML (only `open`, `filled`, `cancelled` remain at lines 8813–8815). Any user tapping the Orders icon gets a blank screen + a thrown TypeError. Pre-existing, not mobile-specific.
2. **Landing "€100K Virtual Starting Balance" stat is stale.** Actual starting balance was changed to €10K (task #8). Landing copy was not updated.
3. **Profile "-99.00% all-time" on a flat €10,000 balance.** New account shows "-99.00% all-time" in the portfolio card and a downward red 30-day performance chart — even though the user has never traded. The chart is also seeded fake data.
4. **Artist-detail header breaks at mobile.** "Sabrina Carpenter" overlaps the €116.22 price; the "66.2M mon listeners" line tangles with the Pop badge + favorite button. Header needs a stacked flex-column layout below ~500px.
5. **"Popularity" appears twice** in the Artist-detail stats grid (both cards show 91).

## Global / chrome

6. **Top-bar search steals the title.** Every view's top bar truncates: "Portf…", "Tourna…", "Leade…", "Settin…", "Help & …", "Sabrin…", "Muses Mark…". Cause: the inline "Search artists…" pill is rendered inside the top bar and doesn't collapse at mobile. Suggested fix: at ≤640px collapse the search to a single search icon that expands the bar on tap.
7. **Bottom nav has 9 icons at 428px.** Icons are spaced ~41px apart — below the 44px Apple HIG target and visually cramped. Since the hamburger drawer already holds every nav item, the bottom bar can drop to 4–5 primary icons + hamburger (Markets, Portfolio, Swap, Tournaments, Menu).
8. **Bottom nav overlaps content.** On Markets, the "Listed Artists 104" card is half-hidden under the bottom nav. Need `padding-bottom` on the main scroll container equal to nav height + safe-area inset.
9. **No Sign-out in the hamburger drawer.** Sign-out exists in the desktop sidebar and in Settings→Account (which itself is off-screen, see #16), but there is no way to sign out from the drawer — standard mobile pattern gap.

## Landing (index.html)

10. **"Launch app" CTA button wraps to 2 lines** on the top bar.
11. **Sticky "Join the waitlist" CTA overlaps the footer disclaimer text** when scrolled to the bottom.
12. **Scroll-triggered fade-in animations leave sections at low opacity** — some sections never reach full opacity at mobile (IntersectionObserver thresholds tuned for desktop).
13. **"Humans of Muses" section** uses mixed full-width and 2-col layouts that feel dense at 428px. Consider all-stacked at mobile.

## Markets

14. **"Muses Markets" title truncates** to "Muses Mark…" (rolls into #6 above).
15. **Quick-filter chip "Favorites" truncates** to "Fav"; sort tab "Losers" truncates to "Loser".
16. **"Hip-Hop" genre pill wraps to 2 lines.**
17. **Two search bars on screen** — one in the top bar and one inside the main Markets card. Redundant at mobile.

## Artist detail (SABR)

18. **Header collapse bug** (see CRIT #4).
19. **Similar Artists renders as single-column stacked full-width cards** — 4 artists take ~4 screens of scroll. 2-col grid at mobile would be tighter.
20. **Inline Trade panel** (Buy/Sell, amount, Buy shares) renders well at mobile. ✅
21. **About section** renders well at mobile. ✅
22. **Price-breakdown card ("How is this price calculated?")** — values on the right of each row (BASE / +€19.63 / +25.83% etc.) crowd against the explanatory text; small numbers wrap.

## Portfolio

23. **Stats grid uneven** — Today/All-time render side-by-side in row 1, Allocated sits alone in row 2. Either 3-across or 2×2 with cash in the 4th slot.
24. **"Start your first position" card** recommends "Bruno Mars is the most-streamed artist on Muses." Verify this is still dynamically computed — if it's hardcoded copy, it will go stale.

## Orders

25. **Crashes on mount** (see CRIT #1).

## Swap

26. Renders cleanly at mobile. ✅

## Tournaments (list)

27. **Filter tabs overflow horizontally**; last tab "Endorsed" is cut off and not obviously scrollable. "Signed up" tab text wraps to 2 lines inside the tab pill.
28. **Tournament card stats row uses 4 columns** — "Up to €1,275" wraps to 3 lines. Drop to 2×2 at mobile.
29. **Launching-soon countdown card** looks great. ✅

## Tournament detail

30. Hero card (Quick · 24 hours / Launch Day Sprint / Up to €1,275 / Reserve spot) looks great. ✅
31. **`setView('tournament-detail')` without a selected tournament** mounts an empty black screen — no empty state. (Unreachable by a normal user, but a defensive empty state would be nice.)

## Leaderboard

32. Pre-launch empty state is clean. ✅

## Profile

33. **Meta line awkward wrap** — "@covevibealt · Amsterdam · Member since April 2026" wraps with "2026" alone on line 2.
34. **Three action buttons don't fit** — "Edit profile" and "Replay tour" each wrap to 2 lines. Either shorten labels or stack as 2+1.
35. **"-99.00% all-time" and fake perf chart** (see CRIT #3).
36. **Achievements row** scrolls horizontally; discoverability issue (no "more →" affordance).

## Settings

37. **Tabs row cuts off** the 4th tab (Account) off-screen to the right. Since Account is where Sign-out lives, this hides the most commonly-needed setting.
38. **Theme picker: one theme per vertical stacked card** is very long. 2-col grid would cut scroll in half.

## Help

39. Hero ("How can we help?") + search + topic cards render well. ✅

## Hamburger drawer

40. Section-grouped nav (TRADE / YOU / COMPETE / MORE) is excellent. ✅ — with the caveat of no Sign-out entry (#9) and no user menu shortcut (Edit profile, notifications).

## Signup / Signin (source inspection)

41. **signup.html and signin.html have zero `@media` queries and no `max-width` breakpoints.** Has viewport meta. Whether this renders OK at 428px depends entirely on fluid defaults — needs live visual check with a signed-out session. Flag: no responsive rules means any fixed-width card or grid will blow out at mobile.

---

## Suggested fix batching (if you want to fix before next round)

**Batch A — Crashers & stale data (must-ship):**
- Remove the `orders-count-recurring` line (or put the span back + add the tab) — fixes Orders crash.
- Fix landing "€100K" → "€10K".
- Fix Profile all-time % math: when holdings=0 and cash=startingCash, show "0.00%" or "—".
- Replace the seeded 30-day perf chart with a flat line / empty-state until there's real data.

**Batch B — Top-bar & nav (high visible impact):**
- Collapse search to icon at ≤640px (fixes 7 view-title truncations in one change).
- Cut bottom nav to 4–5 items + hamburger at ≤500px.
- Add Sign-out entry to the drawer footer.
- Fix bottom-nav content overlap (padding on main).

**Batch C — Artist detail header:**
- Stacked flex-column header at ≤500px (name/ticker block → price block → meta chips block).
- De-duplicate Popularity stat.
- 2-col Similar Artists grid at mobile.

**Batch D — Polish:**
- Portfolio stats grid rework (3-across or 2×2).
- Tournament card 2×2 stats at mobile.
- Settings tabs — scroll-indicator or wrap; Theme picker 2-col.
- Landing "Launch app" button — don't wrap.
- Landing sticky CTA — don't overlap footer disclaimer.
- Profile: shorten button labels or 2+1 stack.
- Profile meta line: non-breaking space between "Member since" words, or drop city at mobile.

**Batch E — Defer / verify separately:**
- Live visual check of signup.html and signin.html at 428px (add media queries if needed).
- "Bruno Mars" recommender: verify dynamic vs. hardcoded.
