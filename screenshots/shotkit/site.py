"""Turns a capture (out/manifest.json + the PNGs) into things to share:

    index.html       sitemap graph: one thumbnail per screen, arrows = how you got there
    gallery.html     every flow as a grid, click to zoom
    walkthrough.md   the same, flat, readable on GitHub; ends with what looked broken

All three are static: open them from disk, or copy out/ under any web server.
"""
from __future__ import annotations

import html
import json
import re
from pathlib import Path

from playwright_scraper import build_flow_gallery, build_sitemap

from .plan import Plan

PALETTE = ["#2f6fdb", "#8b5cf6", "#3fae6b", "#d8973c", "#2bb3a3", "#c2477f", "#e0672b", "#5fa8d3", "#7c8b2f", "#a0522d"]
ROW = 6  # vis-network lays a level out on one row; wider rows shrink every thumbnail
THUMB_W, THUMB_RATIO = 400, 10 / 16


def _label(shot: dict) -> str:
    return shot["name"].replace("_", " ").capitalize()


def _graph(manifest: dict, plan: Plan):
    """One node per screen (or per `node:` id shared by several shots), one row per flow
    (wrapped at ROW), arrows between consecutive screens labelled with the action."""
    nodes, edges, assets, colors, legend = [], [], {}, {}, []
    level = 0
    for i, flow in enumerate(manifest["flows"]):
        color = PALETTE[i % len(PALETTE)]
        colors[flow["id"]] = color
        legend.append((html.escape(flow["title"]), color))
        prev = None
        in_row = 0
        for shot in flow["shots"]:
            nid = shot.get("node") or f"{flow['id']}/{shot['name']}"
            if nid not in assets:
                if in_row == ROW:
                    level, in_row = level + 1, 0
                nodes.append((nid, _label(shot), level, flow["id"]))
                assets[nid] = {"en": [], "caption": shot.get("caption") or _label(shot)}
                in_row += 1
            assets[nid]["en"].append(shot["file"])
            if prev and prev != nid:
                edges.append((prev, nid, (shot.get("via") or "")[:32]))
            prev = nid
        level += 1
    for e in plan.edges:  # extra arrows from the plan: [from, to, label], ids as "<flow>/<shot name>"
        edges.append((e[0], e[1], e[2] if len(e) > 2 else ""))
    return nodes, edges, assets, colors, legend


def _thumbs(out: Path, files) -> None:
    """Top-cropped thumbnails for the graph: a full-page shot of a long screen would
    otherwise be drawn as a sliver. The lightbox still opens the full image."""
    from PIL import Image
    for rel in files:
        src, dst = out / rel, out / "_thumbs" / rel
        if not src.exists() or (dst.exists() and dst.stat().st_mtime >= src.stat().st_mtime):
            continue
        dst.parent.mkdir(parents=True, exist_ok=True)
        im = Image.open(src).convert("RGB")
        im = im.crop((0, 0, im.width, min(im.height, int(im.width * THUMB_RATIO))))
        im.thumbnail((THUMB_W, THUMB_W), Image.LANCZOS)
        im.save(dst, "PNG", optimize=True)


def _use_thumbs(page: Path) -> None:
    old = "function imgFor(n){ return n.imgs[lang] || GRAY; }"
    new = 'function imgFor(n){ const p=n.imgs[lang]; return p ? "_thumbs/"+p : GRAY; }'
    text = page.read_text()
    if old in text:
        page.write_text(text.replace(old, new))
    else:
        print(f"  ! {page.name}: thumbnail hook not found (playwright-scraper changed?); graph uses full images")


def _real_captions(page: Path, manifest: dict) -> None:
    """The gallery captions each shot from its file name; use the plan's captions instead."""
    text = page.read_text()
    for flow in manifest["flows"]:
        for shot in flow["shots"]:
            if shot.get("caption"):
                pattern = re.escape(json.dumps({"src": shot["file"]})[:-1]) + r', "cap": "(?:[^"\\]|\\.)*"\}'
                text = re.sub(pattern, lambda _: json.dumps({"src": shot["file"], "cap": shot["caption"]}), text)
    page.write_text(text)


def _problems(shot: dict) -> list[str]:
    out = [f"`{a['status']}` {a['method']} {a['url']}" for a in shot["api"]["failed"]]
    out += [f"page error: {e}" for e in shot.get("errors", [])]
    return out


def _markdown(manifest: dict, plan: Plan) -> str:
    total = sum(len(f["shots"]) for f in manifest["flows"])
    lines = [f"# {manifest['name']}: walkthrough", "",
             f"{total} screens in {len(manifest['flows'])} flows, captured from {manifest['base_url']} on {manifest['captured_at']}."]
    if manifest.get("readonly"):
        blocked = manifest.get("blocked") or []
        lines += ["", "Captured read-only: " + (f"the guard blocked {len(blocked)} request(s) (listed at the end)." if blocked else "no request that could change the app was attempted.")]
    lines += ["", "## Contents", ""]
    lines += [f"{i}. [{f['title']}](#{re.sub(r'[^a-z0-9 -]', '', f['title'].lower()).replace(' ', '-')}) ({len(f['shots'])})"
              for i, f in enumerate(manifest["flows"], 1)]
    issues = []
    for flow in manifest["flows"]:
        lines += ["", f"## {flow['title']}", ""]
        if flow.get("description"):
            lines += [flow["description"], ""]
        if flow.get("error"):
            lines += [f"> **This flow stopped early:** {flow['error']}", ""]
            issues.append(f"- **{flow['title']}** stopped early: {flow['error']}")
        for n, shot in enumerate(flow["shots"], 1):
            path = shot["url"].replace(manifest["base_url"].rstrip("/"), "") or "/"
            lines += [f"### {n}. {shot.get('caption') or _label(shot)}", "",
                      f"`{path}`" + (f" · after: {shot['via']}" if shot.get("via") else ""), "",
                      f"![{_label(shot)}]({shot['file']})", ""]
            for p in _problems(shot):
                issues.append(f"- **{flow['title']} › {_label(shot)}**: {p}")
    lines += ["", "## What looked broken", ""]
    lines += issues or ["Nothing: no failed API call or page error on any captured screen."]
    if manifest.get("blocked"):
        lines += ["", "## Blocked by the read-only guard", ""] + [f"- `{b}`" for b in manifest["blocked"]]
    return "\n".join(lines) + "\n"


def build(plan: Plan) -> None:
    out = plan.out
    mf = out / "manifest.json"
    if not mf.exists():
        raise SystemExit(f"no capture yet in {out}: run `capture` first")
    manifest = json.loads(mf.read_text())
    nodes, edges, assets, colors, legend = _graph(manifest, plan)
    title = f"{manifest['name']} walkthrough"
    links = [("gallery.html", "Grid gallery &rarr;"), ("walkthrough.md", "Markdown")]
    build_sitemap(out, nodes, edges, assets=assets, group_colors=colors, legend=legend, title=f"Sitemap · {title}",
                  heading=f'{html.escape(manifest["name"])} <span style="color:var(--mut)">· {html.escape(manifest["base_url"])}</span>',
                  links=links, accent="#2f6fdb")
    _thumbs(out, {a["en"][0] for a in assets.values() if a["en"]})
    for page in ("index.html", "sitemap.html"):
        _use_thumbs(out / page)
    total = sum(len(f["shots"]) for f in manifest["flows"])
    gallery = build_flow_gallery(
        out, [(f["id"], f["title"]) for f in manifest["flows"]], title=title,
        intro=f"{total} screens captured from {html.escape(manifest['base_url'])} on {manifest['captured_at']}.",
        links=[("index.html", "&#9783; Sitemap graph &rarr;")],
        footer="Click any screenshot to zoom." + (" Captured read-only: nothing was created, changed or deleted." if manifest.get("readonly") else ""),
        accent="#2f6fdb")
    _real_captions(gallery, manifest)
    (out / "walkthrough.md").write_text(_markdown(manifest, plan))
    print(f"Site: {out / 'index.html'}  ·  {gallery}  ·  {out / 'walkthrough.md'}")
