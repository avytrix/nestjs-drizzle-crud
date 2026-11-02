#!/usr/bin/env python3
"""SEO/AEO gates over the docs static export.

Ported from avytrix.dev (my-avytrix/scripts/seo_check.py), which implements section 8 of the
SEO and AEO engineering standard. Adapted for this site: trailing-slash routes
(`docs/<page>/index.html`), the "| Nestjs Drizzle" title suffix, external links in llms.txt,
and extra gates: no em or en dashes in rendered text; llms-full.txt and security.txt present;
and one URL form everywhere: every sitemap <loc> equals its page's canonical, and no sitemap
entry, canonical, JSON-LD URL, internal link or llms link would be answered with a redirect.

Usage: python3 apps/docs/scripts/seo_check.py [out_dir]   (exits 1 on any failure)
The origin comes from NEXT_PUBLIC_SITE_URL and defaults to https://crud.avytrix.dev.
"""
import json
import os
import re
import sys
from collections import defaultdict
from html.parser import HTMLParser
from pathlib import Path

ORIGIN = (os.environ.get("NEXT_PUBLIC_SITE_URL") or "https://crud.avytrix.dev").rstrip("/")
SUFFIX = " | Nestjs Drizzle"  # siteConfig.displayName in apps/docs/lib/seo.ts
GENERIC_ANCHORS = {"click here", "here", "read more", "link", "more", "learn more"}
ROBOTS_INDEX = "index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1"
DASHES = re.compile("[–—]")  # en dash, em dash


class Page(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.title = ""
        self.meta = {}
        self.canonical = None
        self.lang = None
        self.ld = []
        self.headings = []
        self.imgs = []
        self.anchors = []
        self.hrefs = []
        self.text = []
        self._stack = []  # tags whose text we're collecting
        self._buf = defaultdict(str)

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "html":
            self.lang = a.get("lang")
        elif tag == "meta":
            key = a.get("name") or a.get("property")
            if key:
                self.meta[key] = a.get("content", "")
        elif tag == "link" and a.get("rel") == "canonical":
            self.canonical = a.get("href")
        elif tag == "img":
            self.imgs.append(a)
        elif tag == "script" and a.get("type") == "application/ld+json":
            self._stack.append("ld")
        elif tag in ("script", "style", "title", "template") or re.fullmatch(r"h[1-6]|a", tag):
            self._stack.append(tag)
            if tag == "a":
                self._buf["a_label"] = a.get("aria-label", "")
                self.hrefs.append(a.get("href") or "")

    def handle_endtag(self, tag):
        if not self._stack:
            return
        top = self._stack[-1]
        if top == "ld" and tag == "script":
            self.ld.append(self._buf.pop("ld", ""))
        elif top != tag:
            return
        elif tag == "title":
            self.title = self._buf.pop("title", "").strip()
        elif tag == "a":
            self.anchors.append((self._buf.pop("a", "").strip() or self._buf.get("a_label", "")).strip())
        elif tag.startswith("h"):
            self.headings.append(int(tag[1]))
        self._buf.pop(tag, None)
        self._stack.pop()

    def handle_data(self, data):
        top = self._stack[-1] if self._stack else None
        if top in ("script", "style", "template"):
            return
        if top:
            self._buf[top] += data
        if top != "ld" and top != "title":
            self.text.append(data)


# Arial 14px advance widths: how Google and SEO tools truncate snippets (~1000px). Unknown chars count as 'M'.
ARIAL14 = {' ': 3.89, '!': 3.89, '"': 4.97, '#': 7.78, '$': 7.78, '%': 12.45, '&': 9.34, "'": 2.67, '(': 4.66, ')': 4.66, '*': 5.45, '+': 8.17, ',': 3.89, '-': 4.66, '.': 3.89, '/': 3.89, '0': 7.78, '1': 7.78, '2': 7.78, '3': 7.78, '4': 7.78, '5': 7.78, '6': 7.78, '7': 7.78, '8': 7.78, '9': 7.78, ':': 3.89, ';': 3.89, '<': 8.17, '=': 8.17, '>': 8.17, '?': 7.78, '@': 14.22, 'A': 9.34, 'B': 9.34, 'C': 10.11, 'D': 10.11, 'E': 9.34, 'F': 8.55, 'G': 10.89, 'H': 10.11, 'I': 3.89, 'J': 7.0, 'K': 9.34, 'L': 7.78, 'M': 11.66, 'N': 10.11, 'O': 10.89, 'P': 9.34, 'Q': 10.89, 'R': 10.11, 'S': 9.34, 'T': 8.55, 'U': 10.11, 'V': 9.34, 'W': 13.22, 'X': 9.34, 'Y': 9.34, 'Z': 8.55, '[': 3.89, '\\': 3.89, ']': 3.89, '^': 6.56, '_': 7.78, '`': 4.66, 'a': 7.78, 'b': 7.78, 'c': 7.0, 'd': 7.78, 'e': 7.78, 'f': 3.89, 'g': 7.78, 'h': 7.78, 'i': 3.11, 'j': 3.11, 'k': 7.0, 'l': 3.11, 'm': 11.66, 'n': 7.78, 'o': 7.78, 'p': 7.78, 'q': 7.78, 'r': 4.66, 's': 7.0, 't': 3.89, 'u': 7.78, 'v': 7.0, 'w': 10.11, 'x': 7.0, 'y': 7.0, 'z': 7.0, '{': 4.67, '|': 3.64, '}': 4.67, '~': 8.17}


def desc_px(text):
    return sum(ARIAL14.get(c, ARIAL14['M']) for c in text)


def norm(s):
    return re.sub(r"\s+", " ", s).strip()


def squash(s):
    """Text with all whitespace removed: inline code and links split rendered text into
    separate nodes, so "`findAll`." arrives as "findAll ." and only a squashed compare is fair."""
    return re.sub(r"\s+", "", s)


def redirects(url):
    """Whether GitHub Pages would answer this same-site URL with a 301: with trailingSlash, a
    page lives at <route>/index.html, so only the slash form is served directly."""
    path = url.removeprefix(ORIGIN).split("#")[0].split("?")[0]
    if not path.startswith("/") or path.startswith("//"):
        return False  # another site
    last = path.rsplit("/", 1)[-1]
    return last != "" and "." not in last


def url_for(out, path):
    rel = path.relative_to(out).as_posix()
    rel = re.sub(r"(^|/)index\.html$", "", rel).removesuffix(".html")
    return f"{ORIGIN}/{rel}".rstrip("/")


def check(out):
    errors = []
    pages = {}
    for f in sorted(out.rglob("*.html")):
        rel = f.relative_to(out).parts
        if f.name in ("404.html", "_not-found.html") or rel[0] in ("_next", "404", "_not-found"):
            continue
        p = Page()
        p.feed(f.read_text(encoding="utf-8"))
        pages[url_for(out, f)] = p

    seen = defaultdict(lambda: defaultdict(list))
    for url, p in pages.items():
        e = lambda msg: errors.append(f"{url}: {msg}")
        robots = p.meta.get("robots", "")
        indexable = "noindex" not in robots

        # Title / description
        if not p.title or len(p.title) > 60:
            e(f"title length {len(p.title)} (max 60): {p.title!r}")
        if not p.title.endswith(SUFFIX):
            e(f"title does not end with {SUFFIX.strip()!r}: {p.title!r}")
        desc = p.meta.get("description", "")
        if not 120 <= len(desc) <= 160:
            e(f"description length {len(desc)} (120-160): {desc!r}")
        if (px := desc_px(desc)) > 990:
            e(f"description too wide for search results: {px:.0f}px (max 990, Arial 14px)")
        # Canonical
        c = p.canonical or ""
        if not c.startswith(ORIGIN):
            e(f"canonical {c!r} not on {ORIGIN}")
        elif c.rstrip("/") != url:
            e(f"canonical {c!r} is not self-referential")
        if p.meta.get("og:url") and p.meta["og:url"].rstrip("/") != c.rstrip("/"):
            e(f"og:url {p.meta['og:url']!r} != canonical")
        if indexable and set(robots.replace(' ', '').split(',')) != set(ROBOTS_INDEX.replace(' ', '').split(',')):
            e(f"robots {robots!r}")
        for key, val in (("title", p.title), ("description", desc), ("canonical", c)):
            if indexable and val:
                seen[key][val].append(url)
        # Locale
        if p.lang != "en" or p.meta.get("og:locale") != "en_US":
            e(f"locale: html lang={p.lang!r} og:locale={p.meta.get('og:locale')!r}")
        # OG image
        for k in ("og:image", "og:image:width", "og:image:height", "twitter:image"):
            if not p.meta.get(k):
                e(f"missing {k}")
        # Headings
        if p.headings.count(1) != 1:
            e(f"{p.headings.count(1)} <h1>")
        for prev, cur in zip(p.headings, p.headings[1:]):
            if cur > prev + 1:
                e(f"heading skips h{prev} -> h{cur}")
                break
        # Images
        for img in p.imgs:
            if not img.get("alt", "").strip() and img.get("aria-hidden") != "true":
                e(f"img without alt: {img.get('src', '')[:80]}")
            if not (img.get("width") and img.get("height")):
                e(f"img without width/height: {img.get('src', '')[:80]}")
        # Anchors
        for label in p.anchors:
            if norm(label).lower() in GENERIC_ANCHORS:
                e(f"generic anchor text {label!r}")
        # One URL form: no same-site link that GitHub Pages would redirect
        for href in p.hrefs:
            if (href.startswith("/") or href.startswith(ORIGIN)) and redirects(href):
                e(f"internal link {href!r} would redirect (add the trailing slash)")
                break
        if c and redirects(c):
            e(f"canonical {c!r} would redirect")
        # Rendered text and metadata: no em or en dashes (repo AGENTS.md, humanize rule)
        visible = norm(" ".join(p.text))
        for where, txt in (("text", visible), ("title", p.title), ("description", desc)):
            if m := DASHES.search(txt):
                e(f"dash in {where}: {txt[max(0, m.start() - 40):m.end() + 40]!r}")
        # JSON-LD
        if len(p.ld) != 1:
            e(f"{len(p.ld)} ld+json blocks (expected 1)")
        flat = squash(visible)
        for raw in p.ld:
            try:
                data = json.loads(raw)
            except json.JSONDecodeError as err:
                e(f"invalid JSON-LD: {err}")
                continue
            if "@graph" not in data:
                e("JSON-LD has no @graph")
            for u in re.findall(r'"(?:url|item|@id)":\s*"([^"]+)"', raw):
                if u.startswith(ORIGIN) and redirects(u):
                    e(f"JSON-LD URL {u!r} would redirect")
            nodes = data.get("@graph", [data])
            ids = [n["@id"] for n in nodes if "@id" in n]
            if len(ids) != len(set(ids)):
                e(f"duplicate @id in graph: {ids}")
            for n in nodes:
                if n.get("@type") == "FAQPage":
                    for q in n.get("mainEntity", []):
                        for txt in (q["name"], q["acceptedAnswer"]["text"]):
                            if squash(txt) not in flat:
                                e(f"FAQ text not visible on page: {txt[:60]!r}")
                if n.get("@type") == "HowTo":
                    for s in n.get("step", []):
                        if squash(s["name"]) not in flat:
                            e(f"HowTo step not visible on page: {s['name'][:60]!r}")
                if n.get("@type") == "BreadcrumbList" and url == ORIGIN:
                    e("home page carries a BreadcrumbList")

    for key, vals in seen.items():
        for val, urls in vals.items():
            if len(urls) > 1:
                errors.append(f"duplicate {key} {val[:60]!r} on {urls}")

    # Crawl files
    for name in ("robots.txt", "sitemap.xml", "llms.txt", "llms-full.txt", ".well-known/security.txt"):
        if not (out / name).exists():
            errors.append(f"missing /{name}")
    sm = out / "sitemap.xml"
    if sm.exists():
        locs = re.findall(r"<loc>(.*?)</loc>", sm.read_text())
        for loc in locs:
            if redirects(loc):
                errors.append(f"sitemap: {loc} would redirect (no trailing slash)")
            p = pages.get(loc.rstrip("/"))
            if not p:
                errors.append(f"sitemap: {loc} has no page")
            elif "noindex" in p.meta.get("robots", ""):
                errors.append(f"sitemap: {loc} is noindex")
            elif p.canonical and p.canonical != loc:
                errors.append(f"sitemap: {loc} differs from its canonical {p.canonical}")
        missing = set(pages) - {l.rstrip("/") for l in locs}
        for url in sorted(missing):
            if "noindex" not in pages[url].meta.get("robots", ""):
                errors.append(f"sitemap: indexable {url} missing")
    robots = out / "robots.txt"
    if robots.exists() and f"Sitemap: {ORIGIN}/sitemap.xml" not in robots.read_text():
        errors.append("robots.txt does not name the absolute sitemap URL")
    llms = out / "llms.txt"
    if llms.exists():
        text = llms.read_text()
        for link in re.findall(r"\]\((.*?)\)", text):
            if link.startswith(ORIGIN) and link.rstrip("/") not in pages:
                errors.append(f"llms.txt links to non-page {link}")
            elif link.startswith(ORIGIN) and redirects(link):
                errors.append(f"llms.txt link {link} would redirect")
        if m := DASHES.search(text):
            errors.append(f"llms.txt has a dash: {text[max(0, m.start() - 40):m.end() + 40]!r}")

    full = out / "llms-full.txt"
    if full.exists():
        for link in sorted(set(re.findall(r"\]\((%s[^)\s]*)\)" % re.escape(ORIGIN), full.read_text()))):
            if redirects(link):
                errors.append(f"llms-full.txt link {link} would redirect")
                break

    return pages, errors


if __name__ == "__main__":
    default = Path(__file__).resolve().parent.parent / "out"
    out = Path(sys.argv[1] if len(sys.argv) > 1 else default)
    pages, errors = check(out)
    for err in errors:
        print("FAIL", err)
    print(f"{len(pages)} pages, {len(errors)} failures")
    sys.exit(1 if errors else 0)
