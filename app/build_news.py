#!/usr/bin/env python3
"""
build_news.py — render Markdown news posts into static HTML and rebuild the
news index (featured row + filterable grid), sitemap entries, and RSS feed.

STDLIB ONLY — no `pip install` required (matches app/fetch-prices.py). Runs
identically on a laptop and on a GitHub Actions runner.

Source of truth
    news/_posts/<slug>.md     front-matter + Markdown (or raw HTML) body

Generates
    news/<slug>.html          full SEO article page
    news.html                 featured row + grid  (between NEWS:* markers)
    sitemap.xml               <url> blocks          (between NEWS:SITEMAP markers)
    news/feed.xml             RSS 2.0 feed

Usage
    python3 app/build_news.py            # build everything
    python3 app/build_news.py --check    # build to temp + report, don't write

The CMS (admin/) writes Markdown into news/_posts/; a GitHub Action runs this
script on push and commits the generated HTML. Authors never touch HTML.
"""

import datetime as _dt
import glob
import html as _html
import os
import re
import sys
import unicodedata

# ----------------------------------------------------------------------------
# Paths — resolved relative to the repo root (this file lives in app/)
# ----------------------------------------------------------------------------
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
POSTS_DIR = os.path.join(ROOT, "news", "_posts")
NEWS_OUT_DIR = os.path.join(ROOT, "news")
NEWS_INDEX = os.path.join(ROOT, "news.html")
SITEMAP = os.path.join(ROOT, "sitemap.xml")
RSS_OUT = os.path.join(ROOT, "news", "feed.xml")

SITE = "https://muses.exchange"
CSS_VER = "20260515a"          # keep in step with the rest of the site
SHARED_JS_VER = "20260515a"

# Category display label  ->  slug used in data-category / filter pills
CATEGORY_SLUGS = {
    "News": "news",
    "Liner Notes": "liner-notes",
    "Methodology": "methodology",
    "Markets": "markets",
    "Artists": "artists",
    "Foundations": "liner-notes",   # legacy alias
    "Market": "markets",            # legacy alias
}

# ============================================================================
# Front-matter parser (tiny YAML subset — strings, quoted strings, booleans,
# inline [a, b] lists, and block "- item" lists). Stdlib only.
# ============================================================================

def parse_front_matter(text):
    """Return (meta: dict, body: str). Front-matter is the leading
    --- ... --- block. Missing block -> ({}, text)."""
    if not text.startswith("---"):
        return {}, text
    # Split on the closing fence
    m = re.match(r"^---\s*\n(.*?)\n---\s*\n?(.*)$", text, re.DOTALL)
    if not m:
        return {}, text
    raw, body = m.group(1), m.group(2)
    meta = {}
    lines = raw.split("\n")
    i = 0
    while i < len(lines):
        line = lines[i]
        if not line.strip() or line.lstrip().startswith("#"):
            i += 1
            continue
        km = re.match(r"^([A-Za-z0-9_]+):\s*(.*)$", line)
        if not km:
            i += 1
            continue
        key, val = km.group(1), km.group(2).strip()
        if val == "":
            # Could be a block list ("- item" on following indented lines)
            items = []
            j = i + 1
            while j < len(lines) and re.match(r"^\s*-\s+", lines[j]):
                items.append(_scalar(re.sub(r"^\s*-\s+", "", lines[j]).strip()))
                j += 1
            if items:
                meta[key] = items
                i = j
                continue
            meta[key] = ""
            i += 1
            continue
        meta[key] = _scalar(val)
        i += 1
    return meta, body


def _scalar(v):
    """Coerce a front-matter scalar: quoted string, inline list, bool, or str."""
    v = v.strip()
    if len(v) >= 2 and v[0] == v[-1] and v[0] in "\"'":
        return v[1:-1]
    if v.startswith("[") and v.endswith("]"):
        inner = v[1:-1].strip()
        if not inner:
            return []
        return [_scalar(x.strip()) for x in _split_top_level(inner)]
    low = v.lower()
    if low in ("true", "yes"):
        return True
    if low in ("false", "no"):
        return False
    return v


def _split_top_level(s):
    """Split a, b, "c, d" on commas not inside quotes."""
    out, cur, q = [], "", None
    for ch in s:
        if q:
            if ch == q:
                q = None
            cur += ch
        elif ch in "\"'":
            q = ch
            cur += ch
        elif ch == ",":
            out.append(cur)
            cur = ""
        else:
            cur += ch
    if cur.strip():
        out.append(cur)
    return out


# ============================================================================
# Minimal Markdown -> HTML (block + inline). Raw HTML blocks pass through
# untouched, so the widget divs and any embedded HTML just work, and the
# migrated legacy articles (whose bodies are already HTML) render verbatim.
# ============================================================================

_BLOCK_HTML_RE = re.compile(r"^\s*<(div|figure|table|section|aside|p|ul|ol|"
                            r"blockquote|h[1-6]|img|iframe|pre|details|hr)\b",
                            re.IGNORECASE)


def md_to_html(text):
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    blocks = re.split(r"\n{2,}", text.strip())
    out = []
    for block in blocks:
        b = block.strip("\n")
        if not b.strip():
            continue
        # Raw HTML block -> passthrough verbatim
        if _BLOCK_HTML_RE.match(b):
            out.append(b)
            continue
        # Horizontal rule
        if re.match(r"^\s*([-*_])(\s*\1){2,}\s*$", b):
            out.append("<hr>")
            continue
        # Heading
        hm = re.match(r"^(#{1,6})\s+(.*)$", b)
        if hm and "\n" not in b:
            level = len(hm.group(1))
            out.append("<h%d>%s</h%d>" % (level, _inline(hm.group(2).strip()), level))
            continue
        # Blockquote
        if all(l.lstrip().startswith(">") for l in b.split("\n")):
            inner = "\n".join(re.sub(r"^\s*>\s?", "", l) for l in b.split("\n"))
            out.append("<blockquote>%s</blockquote>" % _inline(inner.strip()))
            continue
        # Unordered list
        if all(re.match(r"^\s*[-*+]\s+", l) for l in b.split("\n")):
            items = "".join("<li>%s</li>" % _inline(re.sub(r"^\s*[-*+]\s+", "", l).strip())
                            for l in b.split("\n"))
            out.append("<ul>%s</ul>" % items)
            continue
        # Ordered list
        if all(re.match(r"^\s*\d+\.\s+", l) for l in b.split("\n")):
            items = "".join("<li>%s</li>" % _inline(re.sub(r"^\s*\d+\.\s+", "", l).strip())
                            for l in b.split("\n"))
            out.append("<ol>%s</ol>" % items)
            continue
        # Paragraph (single newlines -> spaces; trust author for <br>)
        para = " ".join(l.strip() for l in b.split("\n"))
        out.append("<p>%s</p>" % _inline(para))
    return "\n\n".join(out)


def _inline(s):
    """Inline Markdown: code, images, links, bold, italic. Code + link URLs are
    protected with placeholders so emphasis markers inside them are untouched."""
    placeholders = []

    def stash(htmlfrag):
        placeholders.append(htmlfrag)
        return "\x00%d\x00" % (len(placeholders) - 1)

    # Inline code first
    s = re.sub(r"`([^`]+)`", lambda m: stash("<code>%s</code>" % _esc(m.group(1))), s)
    # Images  ![alt](src)
    s = re.sub(r"!\[([^\]]*)\]\(([^)\s]+)(?:\s+\"([^\"]*)\")?\)",
               lambda m: stash('<img src="%s" alt="%s"%s loading="lazy">' % (
                   m.group(2), _esc(m.group(1)),
                   (' title="%s"' % _esc(m.group(3))) if m.group(3) else "")), s)
    # Links  [text](url "title")
    def _link(m):
        text, url, title = m.group(1), m.group(2), m.group(3)
        rel = ' target="_blank" rel="noopener"' if url.startswith("http") and SITE not in url else ""
        t = ' title="%s"' % _esc(title) if title else ""
        return stash('<a href="%s"%s%s>%s</a>' % (url, t, rel, _inline_basic(text)))
    s = re.sub(r"\[([^\]]+)\]\(([^)\s]+)(?:\s+\"([^\"]*)\")?\)", _link, s)
    # Now basic emphasis on the remaining text
    s = _inline_basic(s)
    # Restore placeholders
    for idx, frag in enumerate(placeholders):
        s = s.replace("\x00%d\x00" % idx, frag)
    return s


def _inline_basic(s):
    s = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", s)
    s = re.sub(r"__([^_]+)__", r"<strong>\1</strong>", s)
    s = re.sub(r"(?<!\*)\*([^*\n]+)\*(?!\*)", r"<em>\1</em>", s)
    s = re.sub(r"(?<!_)_([^_\n]+)_(?!_)", r"<em>\1</em>", s)
    return s


def _esc(s):
    # Minimal HTML escaping for text + double-quoted attributes. We deliberately
    # leave apostrophes alone (they don't need escaping inside double quotes) so
    # the generated source stays clean and matches the hand-written originals.
    return (str(s).replace("&", "&amp;").replace("<", "&lt;")
            .replace(">", "&gt;").replace('"', "&quot;"))


def _strip_tags(s):
    return re.sub(r"<[^>]+>", "", s)


def slugify(value):
    """Produce a clean, ASCII, hyphen-separated URL slug.

    Critically, this normalises non-ASCII punctuation — em-dashes (—),
    en-dashes (–), curly quotes, accents — down to plain ASCII and collapses
    everything else to single hyphens. The CMS slugifies article titles for
    the Markdown filename, and every Muses headline uses ' — ', so without
    this the URLs would carry %E2%80%94. Run on the filename stem (and on any
    explicit front-matter `slug`) so the public URL is always clean regardless
    of how messy the source filename is.
    """
    value = unicodedata.normalize("NFKD", str(value))
    value = value.encode("ascii", "ignore").decode("ascii")
    value = value.lower()
    value = re.sub(r"[^a-z0-9]+", "-", value)
    value = re.sub(r"-{2,}", "-", value).strip("-")
    return value or "post"


# ============================================================================
# Post model
# ============================================================================

class Post:
    def __init__(self, slug, meta, body_md):
        self.slug = slug
        self.meta = meta
        self.body_md = body_md
        self.body_html = md_to_html(body_md)
        # Resolved fields
        self.title = (meta.get("title") or slug).strip()
        self.title_display = meta.get("title_display") or _esc(self.title)
        self.description = (meta.get("description") or "").strip()
        self.og_title = (meta.get("og_title") or self.title).strip()
        self.og_description = (meta.get("og_description") or self.description).strip()
        self.category = (meta.get("category") or "News").strip()
        self.cat_slug = CATEGORY_SLUGS.get(self.category, "news")
        self.date = _parse_date(meta.get("date"))
        self.updated = _parse_date(meta.get("updated")) or self.date
        self.hero_image = (meta.get("hero_image") or "").strip()
        self.hero_alt = (meta.get("hero_alt") or self.title).strip()
        self.hero_credit = (meta.get("hero_credit") or "").strip()
        self.featured = bool(meta.get("featured", False))
        self.tags = meta.get("tags") or []
        if isinstance(self.tags, str):
            self.tags = [t.strip() for t in self.tags.split(",") if t.strip()]
        self.keywords = meta.get("keywords") or ", ".join(self.tags)
        self.grid_title = meta.get("grid_title") or self.title
        self.lede = meta.get("lede") or self.description
        # CTA
        self.cta_title = meta.get("cta_title") or "Start trading on Muses"
        self.cta_body = meta.get("cta_body") or (
            "Free account, $10,000 in virtual credits, and live prices on every "
            "listed artist. No deposit, no KYC.")
        self.cta_href = meta.get("cta_href") or "/signup"
        self.cta_label = meta.get("cta_label") or "Sign up — it's free"
        # Read time
        words = len(_strip_tags(self.body_html).split())
        self.read_time = int(meta.get("read_time") or max(1, round(words / 220)))
        # Search keywords for the grid filter
        extra = meta.get("search_keywords") or ""
        self.search = " ".join(filter(None, [
            self.title.lower(),
            " ".join(t.lower() for t in self.tags),
            self.cat_slug,
            str(extra).lower(),
        ]))

    @property
    def url(self):
        return "%s/news/%s" % (SITE, self.slug)

    @property
    def date_human(self):
        return self.date.strftime("%-d %b %Y") if self.date else ""

    @property
    def published_iso(self):
        return (self.date or _dt.date.today()).strftime("%Y-%m-%dT12:00:00Z")

    @property
    def modified_iso(self):
        return (self.updated or self.date or _dt.date.today()).strftime("%Y-%m-%dT12:00:00Z")


def _parse_date(v):
    if not v:
        return None
    s = str(v).strip()
    for fmt in ("%Y-%m-%d", "%Y-%m-%dT%H:%M:%SZ", "%Y-%m-%dT%H:%M:%S"):
        try:
            return _dt.datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    return None


def load_posts():
    posts = []
    for path in sorted(glob.glob(os.path.join(POSTS_DIR, "*.md"))):
        fname = os.path.splitext(os.path.basename(path))[0]
        if fname.startswith("_"):
            continue
        with open(path, encoding="utf-8") as f:
            meta, body = parse_front_matter(f.read())
        # URL slug: explicit front-matter `slug` wins (lets an author pin a
        # permalink independent of the title); otherwise derive from the
        # filename. Always normalised to clean ASCII.
        slug = slugify(meta.get("slug") or fname)
        posts.append(Post(slug, meta, body))
    # Newest first
    posts.sort(key=lambda p: (p.date or _dt.date.min), reverse=True)
    return posts


# ============================================================================
# Article page template
# ============================================================================

ARTICLE_TMPL = """<!doctype html>
<!-- GENERATED by app/build_news.py from news/_posts/{slug}.md — do not edit by hand -->
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>{title} | Muses Exchange</title>
<meta name="description" content="{description}">
<meta name="robots" content="index,follow,max-image-preview:large">
<meta property="og:title" content="{og_title}">
<meta property="og:description" content="{og_description}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="Muses">
<meta property="og:url" content="{url}">
<meta property="og:image" content="{SITE}/og-image.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:type" content="image/png">
<meta property="og:image:alt" content="Muses — a stock market for music, priced by streams.">
<meta property="article:published_time" content="{published_iso}">
<meta property="article:modified_time" content="{modified_iso}">
<meta property="article:section" content="{category}">
{article_tags}
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{og_title}">
<meta name="twitter:description" content="{og_description}">
<meta name="twitter:image" content="{SITE}/og-image.png">
<meta name="twitter:image:alt" content="Muses — a stock market for music, priced by streams.">
<meta name="theme-color" content="#0b0910">
<link rel="canonical" href="{url}">
<link rel="alternate" type="application/rss+xml" title="Muses Exchange News" href="{SITE}/news/feed.xml">
<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23b98fff' stroke-width='2.4' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='2,22 7.6,4 12,15 16.4,2 22,22'/%3E%3C/svg%3E">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,300;9..144,400;9..144,500;9..144,600;9..144,700;9..144,800;9..144,900&family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/muse-shared.css?v={CSS_VER}">
<link rel="stylesheet" href="/app/blog-embeds.css">
<link rel="stylesheet" href="/app/news-styles.css">
<script type="application/ld+json">
{jsonld}
</script>
<style>
  body[data-page="news-post"] .news-prose ul {{ list-style: disc; padding-left: 24px; }}
  body[data-page="news-post"] .news-prose ol {{ list-style: decimal; padding-left: 24px; }}
</style>
</head>
<body data-page="news-post">

<div class="ambient"></div>
<div class="grain"></div>

<svg width="0" height="0" style="position:absolute" aria-hidden="true">
  <defs>
    <symbol id="i-logo" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="2,22 7.6,4 12,15 16.4,2 22,22"/></symbol>
    <symbol id="i-arrow-up-right" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="7" y1="17" x2="17" y2="7"/><polyline points="7 7 17 7 17 17"/></symbol>
    <symbol id="i-menu" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></symbol>
    <symbol id="i-share" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></symbol>
    <symbol id="i-info" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></symbol>
  </defs>
</svg>

<div id="nav-mount"></div>

<div class="news-article-wrap">

  <nav class="news-breadcrumb">
    <span>
      <a href="/">Home</a>
      <span class="sep">/</span>
      <a href="/news">News</a>
      <span class="sep">/</span>
      <span style="color:var(--ink);">{category}</span>
    </span>
    <a class="news-disclaimer-link" href="/risk">
      <svg><use href="#i-info"/></svg> Disclaimer
    </a>
  </nav>

  <h1 class="news-article-title">{title_display}</h1>

  <div class="news-article-grid">

    <article class="news-article-main">

      {hero_block}

      <div class="news-meta">
        <span class="news-meta-author">Muses Editorial</span>
        <span class="news-meta-dot"></span>
        <time datetime="{date_iso}">{date_human}</time>
        <span class="news-meta-dot"></span>
        <span>{read_time} min read</span>
        <span class="news-meta-share" onclick="if(navigator.share){{navigator.share({{title:document.title,url:location.href}}).catch(()=>{{}});}} else {{navigator.clipboard.writeText(location.href);this.querySelector('span').textContent='Copied'}}">
          <svg><use href="#i-share"/></svg>
          <span>Share</span>
        </span>
      </div>

      <div class="news-prose">
{body_html}

        <div class="news-inline-cta">
          <h3>{cta_title}</h3>
          <p>{cta_body}</p>
          <a class="btn-primary" href="{cta_href}">{cta_label} <svg><use href="#i-arrow-up-right"/></svg></a>
        </div>

      </div>

    </article>

    <aside class="news-sidebar">

      <div class="news-trust-card">
        <div class="news-trust-head">
          <h4>Why you can trust Muses</h4>
          <span class="news-trust-logo"><svg><use href="#i-logo"/></svg></span>
        </div>
        <p class="news-trust-body">
          We maintain a strict editorial policy focused on factual accuracy, relevance, and transparency. Every piece is anchored to public streaming data anyone can verify — no anonymous tips, no insider claims, no paid placements.
        </p>
        <div class="news-trust-stats">
          <div class="news-trust-stat"><span class="news-trust-stat-num" data-listed-count>105</span><span class="news-trust-stat-lbl">Listed artists</span></div>
          <div class="news-trust-stat"><span class="news-trust-stat-num">30 min</span><span class="news-trust-stat-lbl">Price refresh</span></div>
          <div class="news-trust-stat"><span class="news-trust-stat-num">10 yr</span><span class="news-trust-stat-lbl">Project horizon</span></div>
          <div class="news-trust-stat"><span class="news-trust-stat-num">$10K</span><span class="news-trust-stat-lbl">Free credits</span></div>
        </div>
      </div>

      <div class="news-side-section">
        <h4>Latest</h4>
{related_items}
      </div>

      <div class="news-side-section">
        <h4>Live data</h4>
        <div data-market-index></div>
        <p style="font-family:var(--sans); font-size:13px; color:var(--ink-dim); margin: 14px 0 0; line-height:1.5;">
          The Muses Exchange index aggregates every listed artist's price, weighted by monthly listeners. Updated every 30 minutes from Spotify and YouTube data.
        </p>
      </div>

    </aside>

  </div>

</div>

<div id="footer-mount"></div>

<script src="/muse-shared.js?v={SHARED_JS_VER}"></script>
<script src="/app/prices.js" defer onerror="console.warn('app/prices.js not found')"></script>
<script src="/app/blog-embeds.js" defer></script>
</body>
</html>
"""


def render_article(post, all_posts):
    # article:tag lines
    tag_lines = "\n".join('<meta property="article:tag" content="%s">' % _esc(t)
                          for t in post.tags)
    # hero
    if post.hero_image:
        credit = ('\n        <span class="news-img-credit">%s</span>' % _esc(post.hero_credit)) if post.hero_credit else ""
        hero_block = (
            '<div class="news-hero-image">\n'
            '        <img src="%s" alt="%s" loading="eager">%s\n'
            '      </div>' % (_esc(post.hero_image), _esc(post.hero_alt), credit))
    else:
        hero_block = ""
    # related (3 most recent OTHER posts, same-category first)
    related = related_posts(post, all_posts, n=3)
    related_items = "\n".join(_related_item(r) for r in related) or \
        '<p style="font-family:var(--sans);font-size:13px;color:var(--ink-dim);">More articles soon.</p>'
    # JSON-LD: BlogPosting + BreadcrumbList
    jsonld = build_jsonld(post)
    return ARTICLE_TMPL.format(
        slug=post.slug,
        title=_esc(post.title),
        og_title=_esc(post.og_title),
        og_description=_esc(post.og_description),
        description=_esc(post.description),
        url=post.url,
        SITE=SITE,
        CSS_VER=CSS_VER,
        SHARED_JS_VER=SHARED_JS_VER,
        published_iso=post.published_iso,
        modified_iso=post.modified_iso,
        category=_esc(post.category),
        article_tags=tag_lines,
        jsonld=jsonld,
        title_display=post.title_display,
        hero_block=hero_block,
        date_iso=(post.date or _dt.date.today()).strftime("%Y-%m-%d"),
        date_human=post.date_human,
        read_time=post.read_time,
        body_html=_indent(post.body_html, 8),
        cta_title=_esc(post.cta_title),
        cta_body=_esc(post.cta_body),
        cta_href=_esc(post.cta_href),
        cta_label=_esc(post.cta_label),
        related_items=related_items,
    )


def _indent(s, n):
    pad = " " * n
    return "\n".join((pad + line if line.strip() else line) for line in s.split("\n"))


def related_posts(post, all_posts, n=3):
    others = [p for p in all_posts if p.slug != post.slug]
    same = [p for p in others if p.cat_slug == post.cat_slug]
    rest = [p for p in others if p.cat_slug != post.cat_slug]
    return (same + rest)[:n]


def _related_item(p):
    img = ('<div class="news-side-item-img"><img src="%s" alt="%s" loading="lazy"></div>'
           % (_esc(p.hero_image), _esc(p.hero_alt))) if p.hero_image else ""
    return (
        '        <a class="news-side-item" href="/news/%s">\n'
        '          %s\n'
        '          <div class="news-side-item-meta"><h5>%s</h5>'
        '<span class="news-side-item-byline">Muses Editorial · %s</span></div>\n'
        '        </a>' % (p.slug, img, _esc(p.grid_title), p.date_human))


def build_jsonld(post):
    import json
    blog = {
        "@context": "https://schema.org",
        "@type": "BlogPosting",
        "mainEntityOfPage": {"@type": "WebPage", "@id": post.url},
        "headline": post.title,
        "description": post.description,
        "image": post.hero_image or (SITE + "/og-image.png"),
        "datePublished": post.published_iso,
        "dateModified": post.modified_iso,
        "author": {"@type": "Organization", "name": "Muses Exchange", "url": SITE},
        "publisher": {
            "@type": "Organization", "name": "Muses Exchange", "url": SITE,
            "logo": {"@type": "ImageObject", "url": SITE + "/icon-512.png"},
        },
        "articleSection": post.category,
        "keywords": post.keywords,
        "wordCount": len(_strip_tags(post.body_html).split()),
        "isAccessibleForFree": True,
    }
    crumbs = {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        "itemListElement": [
            {"@type": "ListItem", "position": 1, "name": "Home", "item": SITE + "/"},
            {"@type": "ListItem", "position": 2, "name": "News", "item": SITE + "/news"},
            {"@type": "ListItem", "position": 3, "name": post.title, "item": post.url},
        ],
    }
    return json.dumps([blog, crumbs], indent=2, ensure_ascii=False)


# ============================================================================
# news.html — featured row + grid (between markers)
# ============================================================================

def _replace_region(text, name, new_inner):
    start = "<!-- NEWS:%s:START -->" % name
    end = "<!-- NEWS:%s:END -->" % name
    pat = re.compile(re.escape(start) + r".*?" + re.escape(end), re.DOTALL)
    block = "%s\n%s\n%s" % (start, new_inner, end)
    if not pat.search(text):
        raise SystemExit("Marker %s not found in target file" % name)
    return pat.sub(lambda _m: block, text)


def build_featured(posts):
    if not posts:
        return ""
    hero = posts[0]
    sides = posts[1:3]
    listed = posts[3:7]
    parts = ['<section class="news-featured-row">']
    # left side column (2 cards)
    parts.append('  <aside class="news-side-col">')
    for p in sides:
        parts.append(_side_card(p))
    parts.append('  </aside>')
    # hero
    parts.append('  <a class="news-hero-card" href="/news/%s">' % hero.slug)
    parts.append('    <div class="news-img">')
    if hero.hero_image:
        parts.append('      <img src="%s" alt="%s" loading="lazy">' % (_esc(hero.hero_image), _esc(hero.hero_alt)))
    parts.append('      <span class="news-cat-badge">%s</span>' % _esc(hero.category))
    parts.append('    </div>')
    parts.append('    <h2>%s</h2>' % _esc(hero.grid_title))
    if hero.lede:
        parts.append('    <p class="news-lede">%s</p>' % _esc(hero.lede))
    parts.append('    <div class="news-byline"><span>Muses Editorial</span>'
                 '<span class="news-byline-sep">/</span><span>%s</span></div>' % hero.date_human)
    parts.append('  </a>')
    # right list
    parts.append('  <aside class="news-list-side">')
    for p in listed:
        parts.append('    <a class="news-list-item" href="/news/%s">' % p.slug)
        parts.append('      <h4>%s</h4>' % _esc(p.grid_title))
        parts.append('      <div class="news-byline"><span>%s</span>'
                     '<span class="news-byline-sep">/</span><span>%s</span></div>'
                     % (_esc(p.category), p.date_human))
        parts.append('    </a>')
    parts.append('  </aside>')
    parts.append('</section>')
    return "\n".join(parts)


def _side_card(p):
    img = ('      <div class="news-img">\n'
           '        <img src="%s" alt="%s" loading="lazy">\n'
           '        <span class="news-cat-badge">%s</span>\n'
           '      </div>\n' % (_esc(p.hero_image), _esc(p.hero_alt), _esc(p.category))) if p.hero_image else ""
    return (
        '    <a class="news-side-card" href="/news/%s">\n'
        '%s'
        '      <h3>%s</h3>\n'
        '      <div class="news-byline"><span>Muses Editorial</span>'
        '<span class="news-byline-sep">/</span><span>%s</span></div>\n'
        '    </a>' % (p.slug, img, _esc(p.grid_title), p.date_human))


def build_grid(posts):
    cards = []
    for p in posts:
        img = ('    <div class="news-img">\n'
               '      <img src="%s" alt="%s" loading="lazy">\n'
               '      <span class="news-cat-badge">%s</span>\n'
               '    </div>\n' % (_esc(p.hero_image), _esc(p.hero_alt), _esc(p.category))) if p.hero_image else ""
        cards.append(
            '  <a class="news-grid-card" data-category="%s" data-search="%s" href="/news/%s">\n'
            '%s'
            '    <h3>%s</h3>\n'
            '    <div class="news-byline"><span>Muses Editorial</span>'
            '<span class="news-byline-sep">/</span><span>%s</span></div>\n'
            '  </a>' % (p.cat_slug, _esc(p.search), p.slug, img, _esc(p.grid_title), p.date_human))
    cards.append(
        '  <div class="news-no-results" id="news-no-results">\n'
        '    <p>No articles match <strong id="news-no-results-query">that</strong>. '
        'Try a different search or reset the filter.</p>\n'
        '  </div>')
    return "\n\n".join(cards)


def rebuild_index(posts, write=True):
    with open(NEWS_INDEX, encoding="utf-8") as f:
        text = f.read()
    text = _replace_region(text, "FEATURED", build_featured(posts))
    text = _replace_region(text, "GRID", build_grid(posts))
    if write:
        with open(NEWS_INDEX, "w", encoding="utf-8") as f:
            f.write(text)
    return text


# ============================================================================
# sitemap.xml — news <url> blocks (between markers)
# ============================================================================

def build_sitemap_entries(posts):
    rows = []
    for p in posts:
        rows.append(
            "  <url>\n"
            "    <loc>%s</loc>\n"
            "    <lastmod>%s</lastmod>\n"
            "    <changefreq>monthly</changefreq>\n"
            "    <priority>0.6</priority>\n"
            "  </url>" % (p.url, (p.updated or p.date or _dt.date.today()).strftime("%Y-%m-%d")))
    return "\n".join(rows)


def rebuild_sitemap(posts, write=True):
    with open(SITEMAP, encoding="utf-8") as f:
        text = f.read()
    text = _replace_region(text, "SITEMAP", build_sitemap_entries(posts))
    if write:
        with open(SITEMAP, "w", encoding="utf-8") as f:
            f.write(text)
    return text


# ============================================================================
# RSS 2.0 feed
# ============================================================================

def build_rss(posts):
    now = _dt.datetime.utcnow().strftime("%a, %d %b %Y %H:%M:%S GMT")
    items = []
    for p in posts[:20]:
        pub = (p.date or _dt.date.today())
        pub_rfc = _dt.datetime(pub.year, pub.month, pub.day, 12).strftime("%a, %d %b %Y %H:%M:%S GMT")
        items.append(
            "    <item>\n"
            "      <title>%s</title>\n"
            "      <link>%s</link>\n"
            "      <guid isPermaLink=\"true\">%s</guid>\n"
            "      <description>%s</description>\n"
            "      <category>%s</category>\n"
            "      <pubDate>%s</pubDate>\n"
            "    </item>" % (
                _esc(p.title), p.url, p.url, _esc(p.description), _esc(p.category), pub_rfc))
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">\n'
        '  <channel>\n'
        '    <title>Muses Exchange — News</title>\n'
        '    <link>%s/news</link>\n'
        '    <atom:link href="%s/news/feed.xml" rel="self" type="application/rss+xml"/>\n'
        '    <description>Market commentary, data deep-dives, and field notes from the exchange for culture.</description>\n'
        '    <language>en-us</language>\n'
        '    <lastBuildDate>%s</lastBuildDate>\n'
        '%s\n'
        '  </channel>\n'
        '</rss>\n' % (SITE, SITE, now, "\n".join(items)))


# ============================================================================
# main
# ============================================================================

def main():
    check = "--check" in sys.argv
    posts = load_posts()
    if not posts:
        print("No posts found in news/_posts/*.md")
        return 0
    print("Loaded %d post(s)" % len(posts))

    # 1. Article pages
    current = set()
    for p in posts:
        out = os.path.join(NEWS_OUT_DIR, p.slug + ".html")
        current.add(os.path.basename(out))
        html_str = render_article(p, posts)
        if check:
            print("  would write %-52s (%d min, %d words)"
                  % (p.slug + ".html", p.read_time,
                     len(_strip_tags(p.body_html).split())))
        else:
            with open(out, "w", encoding="utf-8") as f:
                f.write(html_str)
            print("  wrote news/%s.html" % p.slug)

    # 1b. Prune orphaned article HTML (post deleted or slug changed). Every
    # *.html in news/ is generated by this script, so anything not in the
    # current set is stale and safe to remove.
    for existing in glob.glob(os.path.join(NEWS_OUT_DIR, "*.html")):
        if os.path.basename(existing) not in current:
            if check:
                print("  would prune stale %s" % os.path.basename(existing))
            else:
                os.remove(existing)
                print("  pruned stale news/%s" % os.path.basename(existing))

    # 2. Index (featured + grid)
    rebuild_index(posts, write=not check)
    print("  %s news.html (featured + grid)" % ("checked" if check else "rebuilt"))

    # 3. Sitemap
    rebuild_sitemap(posts, write=not check)
    print("  %s sitemap.xml (news entries)" % ("checked" if check else "rebuilt"))

    # 4. RSS
    if not check:
        with open(RSS_OUT, "w", encoding="utf-8") as f:
            f.write(build_rss(posts))
    print("  %s news/feed.xml (RSS)" % ("checked" if check else "wrote"))

    print("Done.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
