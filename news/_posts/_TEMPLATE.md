---
# ===========================================================================
# NEWS ARTICLE — Markdown source. Copy this file to news/_posts/<slug>.md
# (the slug becomes the URL: /news/<slug>). Files starting with _ are ignored.
# After editing, the build (app/build_news.py, run by CI on push) regenerates
# news/<slug>.html, the news index, sitemap, and RSS. You never touch HTML.
# ===========================================================================
title: "Primary keyword first — full headline, 50-60 chars"
# Optional: H1 with a gradient-emphasised phrase. Wrap the second part in <em>.
title_display: "Primary keyword first. <em>The hook.</em>"
description: "150-160 char meta description with the primary keyword and a hook."
# Optional curated social snippets (default to title/description):
# og_title: "Shorter social title"
# og_description: "Punchier social description"
category: "News"          # News | Liner Notes | Methodology | Markets | Artists
date: 2026-06-16          # YYYY-MM-DD (published)
# updated: 2026-06-16     # optional (modified date; defaults to published)
hero_image: "https://i.scdn.co/image/..."   # an artist's Spotify image (see app/prices.js)
hero_alt: "Descriptive alt text for the hero image"
hero_credit: "Featured: Artist Name · Image via Spotify"
featured: true            # show in the featured row on /news
tags: ["keyword one", "keyword two", "keyword three"]
# search_keywords: "extra terms for the /news filter search"
# grid_title: "Shorter title for the index cards (defaults to title)"
# Inline call-to-action at the end of the article (all optional — sensible defaults):
cta_title: "Start trading on Muses"
cta_body: "Free account, $10,000 in virtual credits, live prices on every listed artist."
cta_href: "/signup"
cta_label: "Sign up — it's free"
---

Opening paragraph — answer the article's central question in 2-3 sentences.
This is what readers (and Google) see first. The first letter becomes a drop
cap automatically.

## First section heading

Body paragraph. Write in Markdown: **bold**, *italic*, [internal links](/how-it-works),
and [links to other articles](/news/five-signals-that-move-an-artists-price).

Drop in a live data widget anywhere — it hydrates automatically from prices.js:

<div data-top-movers></div>

## Second section heading

- Bullet lists work
- So do [links](/artists) inside them

Embed a single artist's live price card with its 4-letter ticker:

<div data-artist-card="BNNY"></div>

Closing paragraph — restate the takeaway in one line. Internal-link liberally;
it boosts crawl depth and keeps readers on-site.
