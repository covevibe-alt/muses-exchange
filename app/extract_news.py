#!/usr/bin/env python3
"""
extract_news.py — ONE-TIME migration. Reads the existing hand-written
news/<slug>.html articles and emits news/_posts/<slug>.md (front-matter +
raw-HTML body) so they become part of the Markdown-driven build pipeline.

The body is kept as raw HTML (which the build's md_to_html passes through
verbatim), so there is zero content/SEO loss. After running this once and
verifying `python3 app/build_news.py` reproduces the articles, the .md files
in news/_posts/ become the source of truth.

    python3 app/extract_news.py        # writes news/_posts/*.md

Idempotent-ish: it overwrites existing _posts/*.md, so don't run it after you
start editing the Markdown by hand.
"""

import glob
import html as _html
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NEWS_DIR = os.path.join(ROOT, "news")
POSTS_DIR = os.path.join(NEWS_DIR, "_posts")
NEWS_INDEX = os.path.join(ROOT, "news.html")

SKIP = {"_TEMPLATE"}


def meta_content(html, prop, attr="property"):
    m = re.search(r'<meta\s+%s=["\']%s["\']\s+content=["\'](.*?)["\']\s*/?>'
                  % (attr, re.escape(prop)), html, re.IGNORECASE | re.DOTALL)
    return _html.unescape(m.group(1).strip()) if m else ""


def meta_all(html, prop):
    return [_html.unescape(x.strip()) for x in re.findall(
        r'<meta\s+property=["\']%s["\']\s+content=["\'](.*?)["\']\s*/?>'
        % re.escape(prop), html, re.IGNORECASE | re.DOTALL)]


def grid_maps():
    """slug -> (grid_title, data_search) parsed from news.html."""
    with open(NEWS_INDEX, encoding="utf-8") as f:
        html = f.read()
    out = {}
    for m in re.finditer(
            r'<a class="news-grid-card"[^>]*data-search="(.*?)"[^>]*href="/news/(.*?)"[^>]*>(.*?)</a>',
            html, re.DOTALL):
        search, slug, inner = m.group(1), m.group(2), m.group(3)
        tm = re.search(r"<h3>(.*?)</h3>", inner, re.DOTALL)
        title = _html.unescape(re.sub(r"\s+", " ", tm.group(1)).strip()) if tm else ""
        out[slug] = (title, _html.unescape(search.strip()))
    return out


def extract(path, gmaps):
    slug = os.path.splitext(os.path.basename(path))[0]
    with open(path, encoding="utf-8") as f:
        html = f.read()

    title = re.search(r"<title>(.*?)</title>", html, re.DOTALL).group(1)
    title = _html.unescape(re.sub(r"\s*\|\s*Muses.*$", "", title).strip())
    description = meta_content(html, "description", attr="name")
    og_title = meta_content(html, "og:title")
    og_description = meta_content(html, "og:description")
    published = meta_content(html, "article:published_time")[:10]
    modified = (meta_content(html, "article:modified_time")[:10] or published)
    category = meta_content(html, "article:section") or "News"
    tags = meta_all(html, "article:tag")

    # hero image
    hero_src = hero_alt = hero_credit = ""
    hm = re.search(r'<div class="news-hero-image">\s*<img\s+src="(.*?)"\s+alt="(.*?)"', html, re.DOTALL)
    if hm:
        hero_src, hero_alt = hm.group(1), _html.unescape(hm.group(2))
    cm = re.search(r'<span class="news-img-credit">(.*?)</span>', html, re.DOTALL)
    if cm:
        hero_credit = _html.unescape(cm.group(1).strip())

    # H1 display (keeps <em>)
    h1 = re.search(r'<h1 class="news-article-title">(.*?)</h1>', html, re.DOTALL)
    title_display = re.sub(r"\s+", " ", h1.group(1).strip()) if h1 else _html.escape(title)

    # prose body (inner of .news-prose, minus trailing inline CTA)
    pstart = html.index('<div class="news-prose">') + len('<div class="news-prose">')
    pend = html.index("</article>", pstart)
    prose = html[pstart:pend].rstrip()
    # drop the final </div> that closes .news-prose
    prose = re.sub(r"</div>\s*$", "", prose).strip()

    cta_title = cta_body = cta_href = cta_label = ""
    cidx = prose.find('<div class="news-inline-cta">')
    if cidx != -1:
        cta = prose[cidx:]
        prose = prose[:cidx].rstrip()
        ct = re.search(r"<h3>(.*?)</h3>", cta, re.DOTALL)
        cb = re.search(r"<p>(.*?)</p>", cta, re.DOTALL)
        ca = re.search(r'<a class="btn-primary" href="(.*?)">(.*?)</a>', cta, re.DOTALL)
        cta_title = _html.unescape(ct.group(1).strip()) if ct else ""
        cta_body = _html.unescape(cb.group(1).strip()) if cb else ""
        if ca:
            cta_href = ca.group(1)
            cta_label = _html.unescape(re.sub(r"<svg.*?</svg>", "", ca.group(2), flags=re.DOTALL).strip())

    # de-indent the prose body
    prose = "\n".join(re.sub(r"^        ", "", l) for l in prose.split("\n")).strip()

    grid_title, search_kw = gmaps.get(slug, (title, ""))

    return {
        "slug": slug, "title": title, "title_display": title_display,
        "description": description, "category": category,
        "og_title": og_title, "og_description": og_description,
        "date": published, "updated": modified, "tags": tags,
        "hero_image": hero_src, "hero_alt": hero_alt, "hero_credit": hero_credit,
        "grid_title": grid_title or title, "search_keywords": search_kw,
        "cta_title": cta_title, "cta_body": cta_body,
        "cta_href": cta_href, "cta_label": cta_label,
        "body": prose,
    }


def yq(s):
    """Quote a YAML scalar safely (double-quote, escape internal quotes)."""
    s = str(s).replace("\\", "\\\\").replace('"', '\\"')
    return '"%s"' % s


def write_md(d):
    fm = ["---"]
    fm.append("title: %s" % yq(d["title"]))
    if d["title_display"] and d["title_display"] != _html.escape(d["title"]):
        fm.append("title_display: %s" % yq(d["title_display"]))
    fm.append("description: %s" % yq(d["description"]))
    if d["og_title"] and d["og_title"] != d["title"]:
        fm.append("og_title: %s" % yq(d["og_title"]))
    if d["og_description"] and d["og_description"] != d["description"]:
        fm.append("og_description: %s" % yq(d["og_description"]))
    fm.append("category: %s" % yq(d["category"]))
    fm.append("date: %s" % d["date"])
    if d["updated"] and d["updated"] != d["date"]:
        fm.append("updated: %s" % d["updated"])
    if d["grid_title"] and d["grid_title"] != d["title"]:
        fm.append("grid_title: %s" % yq(d["grid_title"]))
    if d["hero_image"]:
        fm.append("hero_image: %s" % yq(d["hero_image"]))
        fm.append("hero_alt: %s" % yq(d["hero_alt"]))
    if d["hero_credit"]:
        fm.append("hero_credit: %s" % yq(d["hero_credit"]))
    fm.append("featured: true")
    if d["tags"]:
        fm.append("tags: [%s]" % ", ".join(yq(t) for t in d["tags"]))
    if d["search_keywords"]:
        fm.append("search_keywords: %s" % yq(d["search_keywords"]))
    if d["cta_title"]:
        fm.append("cta_title: %s" % yq(d["cta_title"]))
        fm.append("cta_body: %s" % yq(d["cta_body"]))
        fm.append("cta_href: %s" % yq(d["cta_href"]))
        fm.append("cta_label: %s" % yq(d["cta_label"]))
    fm.append("---")
    content = "\n".join(fm) + "\n\n" + d["body"] + "\n"
    os.makedirs(POSTS_DIR, exist_ok=True)
    out = os.path.join(POSTS_DIR, d["slug"] + ".md")
    with open(out, "w", encoding="utf-8") as f:
        f.write(content)
    print("  wrote news/_posts/%s.md  (body %d chars)" % (d["slug"], len(d["body"])))


def main():
    gmaps = grid_maps()
    for path in sorted(glob.glob(os.path.join(NEWS_DIR, "*.html"))):
        slug = os.path.splitext(os.path.basename(path))[0]
        if slug in SKIP:
            continue
        try:
            write_md(extract(path, gmaps))
        except Exception as e:  # noqa
            print("  !! FAILED %s: %s" % (slug, e))
    print("Done. Review news/_posts/*.md, then run: python3 app/build_news.py")


if __name__ == "__main__":
    main()
