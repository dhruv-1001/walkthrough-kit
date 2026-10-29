#!/usr/bin/env python3
"""Screenshot walkthroughs of a web app, from a YAML plan.

  ./shots check    <plan.yaml>                 # validate the plan (no browser)
  ./shots discover <plan.yaml> [--depth 2]     # sign in, follow links, print a starter `pages:` list
  ./shots capture  <plan.yaml> [--flow ID ...] [--headed]
  ./shots build    <plan.yaml>                 # index.html (sitemap) + gallery.html + walkthrough.md
  ./shots run      <plan.yaml> [...]           # capture, then build

Output goes to the plan's `out` folder (default: out/ next to the plan).
"""
from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from shotkit import discover as disc  # noqa: E402
from shotkit import plan as planmod  # noqa: E402
from shotkit import site  # noqa: E402
from shotkit.runner import Capture  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("command", choices=["check", "discover", "capture", "build", "run"])
    ap.add_argument("plan")
    ap.add_argument("--flow", action="append", help="capture only this flow (repeatable)")
    ap.add_argument("--headed", action="store_true", help="show the browser")
    ap.add_argument("--depth", type=int, default=2, help="discover: links to follow from the start pages")
    ap.add_argument("--limit", type=int, default=60, help="discover: stop after this many pages")
    args = ap.parse_args()

    # A plan path that isn't there from here is tried against this folder (examples/demo/plan.yaml).
    path = Path(args.plan)
    if not path.exists() and (Path(__file__).resolve().parent / path).exists():
        path = Path(__file__).resolve().parent / path
    try:
        plan = planmod.load(path)
    except planmod.PlanError as e:
        print(f"plan error: {e}")
        return 2

    if args.command == "check":
        shots = sum(1 for f in plan.flows for s in f.steps if isinstance(s, dict) and "shot" in s)
        print(f"{plan.name}: {len(plan.flows)} flows, {shots} screenshots planned, base {plan.base_url}, out {plan.out}")
        print("  read-only guard: " + (f"on (blocks {', '.join(plan.readonly['methods'])}"
              + (f" and URLs with {', '.join(plan.readonly['paths'])}" if plan.readonly["paths"] else "") + ")" if plan.readonly else "off"))
        for f in plan.flows:
            n = sum(1 for s in f.steps if isinstance(s, dict) and "shot" in s)
            print(f"  {f.id:<28} {n:>3} shots{'  (signed out)' if f.fresh else ''}  {f.title}")
        return 0
    if args.command == "discover":
        found = asyncio.run(disc.discover(plan, depth=args.depth, limit=args.limit))
        print(f"\n{len(found)} pages (also in {plan.out / '_discover.json'}). Paste and trim:\n")
        print(disc.as_yaml(found))
        return 0
    if args.command == "build":
        site.build(plan)
        return 0
    try:
        code = asyncio.run(Capture(plan, headed=args.headed).run(args.flow))
    except planmod.PlanError as e:
        print(f"plan error: {e}")
        return 2
    if args.command == "run":
        site.build(plan)
    return code


if __name__ == "__main__":
    sys.exit(main())
