"""Finds an app's pages to start a plan from: signs in like the plan does, then
follows same-site links breadth-first and prints a ready-to-paste `pages:` list.

Single-page apps often move between screens with buttons, not links, so this
finds the menus' pages but not every dialog or wizard step: read the app's
route table (or click around) for those.
"""
from __future__ import annotations

import json
import re
from urllib.parse import urlsplit, urlunsplit

from playwright.async_api import async_playwright

from .plan import Plan, slug
from .runner import Capture

LINKS = """() => [...document.querySelectorAll('a[href]')].map(a => ({ href: a.href, text: (a.innerText || a.getAttribute('aria-label') || '').trim().slice(0, 60) }))"""
ID_SEGMENT = re.compile(r"/(\d+|[0-9a-f]{8}-[0-9a-f-]{27,}|[0-9a-f]{24,})(?=/|$)", re.I)
SKIP = ("logout", "log-out", "signout", "sign-out", "/api/", ".pdf", ".csv", ".xlsx", ".zip", "mailto:", "tel:")


def _norm(url: str, keep_query: bool) -> str:
    s = urlsplit(url)
    return urlunsplit((s.scheme, s.netloc, s.path.rstrip("/") or "/", s.query if keep_query else "", ""))


async def discover(plan: Plan, *, depth: int = 2, limit: int = 60) -> list[dict]:
    cfg = plan.discover
    origin = urlsplit(plan.base_url).netloc
    skip = SKIP + tuple(cfg.get("exclude", []))
    keep_query = bool(cfg.get("keep_query"))
    run = Capture(plan)
    found, queue, seen = [], [(plan.url(p), 0) for p in cfg.get("start", ["/"])], set()
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        ctx = await run.new_context(browser, signed_in=True)
        page = await ctx.new_page()
        while queue and len(found) < limit:
            url, d = queue.pop(0)
            key = _norm(url, keep_query)
            if key in seen:
                continue
            seen.add(key)
            try:
                await run.goto(page, url)
            except Exception as e:
                print(f"  ! {url}: {str(e).splitlines()[0][:80]}")
                continue
            landed = _norm(page.url, keep_query)
            heading = await page.locator("h1").first.inner_text(timeout=1500) if await page.locator("h1").count() else ""
            row = {"path": urlsplit(landed).path + (f"?{urlsplit(landed).query}" if keep_query and urlsplit(landed).query else ""),
                   "title": await page.title(), "h1": heading.strip(), "redirected": landed != key}
            if landed != key and any(r["path"] == row["path"] for r in found):
                continue  # a redirect to a page we already have (e.g. back to the dashboard)
            # /requests/101, /requests/102 ...: one example of each page shape is enough
            shape = ID_SEGMENT.sub("/:id", row["path"])
            twin = next((r for r in found if r.get("shape") == shape), None) if shape != row["path"] else None
            if twin:
                twin["alike"] = twin.get("alike", 1) + 1
                continue
            row["shape"] = shape
            found.append(row)
            print(f"  {row['path']:<40} {row['h1'] or row['title']}")
            if d >= depth:
                continue
            for link in await page.evaluate(LINKS):
                href = link["href"]
                if urlsplit(href).netloc == origin and not any(s in href.lower() for s in skip):
                    queue.append((href, d + 1))
        await browser.close()
    plan.out.mkdir(parents=True, exist_ok=True)
    (plan.out / "_discover.json").write_text(json.dumps(found, indent=2) + "\n")
    return found


def as_yaml(found: list[dict]) -> str:
    rows = []
    for r in found:
        name = slug(r["path"].strip("/") or "home")
        caption = (r["h1"] or r["title"]).replace('"', "'")
        if r.get("alike"):
            caption += f" (one of {r['alike']} like {r['shape']})"
        rows.append(f'      - {{path: "{r["path"]}", name: {name}, caption: "{caption}"}}')
    return "\n".join(["flows:", "  - id: pages", "    title: Every page", "    pages:", *rows])
