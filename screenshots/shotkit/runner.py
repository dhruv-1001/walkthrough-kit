"""Runs a plan's flows in a real browser and writes, per flow:

    out/<flow>/NN_<name>.png   the screenshot
    out/<flow>/NN_<name>.txt   the page's visible text (searchable, diffable)
    out/manifest.json          every shot: caption, URL, the action that led to it,
                               API calls that failed and page errors while it was on screen
    out/_guard.log             what the read-only guard blocked (or that nothing was attempted)
"""
from __future__ import annotations

import importlib.util
import json
import re
import shutil
import time
from pathlib import Path

from playwright.async_api import async_playwright

from .guard import Guard
from .plan import Plan, PlanError, expand, slug

BROKEN_IMAGES = "() => [...document.images].filter(i => i.complete && i.naturalWidth === 0 && i.src).map(i => i.src)"
NETWORK_ERRORS = ("ERR_NETWORK_CHANGED", "ERR_CONNECTION", "ERR_INTERNET_DISCONNECTED", "Timeout")


class StepError(Exception):
    pass


def describe(selector: str) -> str:
    """A selector as a person would say it: role=button[name="Sign in"] -> "Sign in"."""
    m = re.search(r"""\[name=["'](.+?)["']""", selector) or re.match(r"(?:text|label|placeholder)=(.+)", selector)
    return f'"{m.group(1).strip(chr(34))}"' if m else selector


def resolve(page, selector: str):
    """Plan selectors: anything Playwright takes (CSS, text=, role=button[name="Save"]),
    plus label=, placeholder= and testid= shortcuts. Always the first match."""
    for prefix, fn in (("label=", page.get_by_label), ("placeholder=", page.get_by_placeholder),
                       ("testid=", page.get_by_test_id)):
        if selector.startswith(prefix):
            return fn(selector[len(prefix):]).first
    return page.locator(selector).first


class Kit:
    """What a hook function receives besides the page: `async def my_step(page, kit, **args)`."""

    def __init__(self, run: "Capture", flow_state: dict):
        self._run, self._state = run, flow_state
        self.plan = run.plan
        self.base_url = run.plan.base_url

    def url(self, path: str) -> str:
        return self.plan.url(expand(path))

    async def goto(self, page, path: str) -> None:
        await self._run.goto(page, path)

    async def shot(self, page, name: str, caption: str | None = None, **kw) -> None:
        await self._run.shot(page, self._state, {"name": name, "caption": caption, **kw})

    def log(self, msg: str) -> None:
        print(f"    {msg}")


class Capture:
    def __init__(self, plan: Plan, *, headed: bool = False):
        self.plan = plan
        self.headed = headed
        self.guard = Guard(plan.readonly)
        self.hooks = self._load_hooks()
        self.manifest = self._old_manifest()

    # ------------------------------------------------------------ setup

    def _load_hooks(self):
        if not self.plan.hooks:
            return None
        spec = importlib.util.spec_from_file_location("plan_hooks", self.plan.hooks)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        return mod

    def _old_manifest(self) -> dict:
        f = self.plan.out / "manifest.json"
        return json.loads(f.read_text()) if f.exists() else {}

    async def new_context(self, browser, *, signed_in: bool):
        state = None
        if signed_in and self.plan.login:
            saved = self.plan.login.get("storage_state")
            saved = expand(saved, strict=False) if saved else None
            if saved and Path(saved).exists():
                state = saved
        ctx = await browser.new_context(viewport=self.plan.viewport, ignore_https_errors=True,
                                        locale=self.plan.locale, storage_state=state)
        await self.guard.install(ctx)
        if signed_in and self.plan.login and not state:
            page = await ctx.new_page()
            print("  signing in")
            flow_state = {"flow": "_login", "n": 0, "via": None, "shots": []}
            for i, step in enumerate(self.plan.login.get("steps") or [], 1):
                await self.step(page, flow_state, step, f"login step {i}")
            await page.close()
            await ctx.storage_state(path=str(self.plan.out / ".signed-in.json"))  # for discover/debugging; holds cookies
        return ctx

    # ------------------------------------------------------------ primitives

    async def settle(self, page, ms: int | None = None) -> None:
        """Wait for the page to calm down. `networkidle` never comes on pages that poll,
        so it is only a best effort on top of a fixed settle."""
        try:
            await page.wait_for_load_state("networkidle", timeout=4000)
        except Exception:
            pass
        await page.wait_for_timeout(self.plan.settle_ms if ms is None else ms)

    async def goto(self, page, target: str, retries: int = 3) -> None:
        url = self.plan.url(expand(target))
        last = None
        for attempt in range(retries):
            try:
                await page.goto(url, wait_until="domcontentloaded", timeout=60000)
                await self.settle(page)
                return
            except Exception as e:  # a long run over a flaky network WILL hit one of these
                last = e
                if any(n in str(e) for n in NETWORK_ERRORS) and attempt < retries - 1:
                    print(f"    [retry {attempt + 1}] {url}: {str(e)[:60]}")
                    await page.wait_for_timeout(4000)
                    continue
                raise
        raise last

    async def images_ready(self, page) -> None:
        """Every <img> loaded; reload once if one is broken (a logo served late)."""
        for _ in range(2):
            try:
                await page.wait_for_function("() => [...document.images].every(i => i.complete)", timeout=10000)
            except Exception:
                pass
            if not await page.evaluate(BROKEN_IMAGES):
                return
            await page.reload(wait_until="domcontentloaded")
            await self.settle(page)

    async def shot(self, page, st: dict, arg) -> None:
        arg = {"name": arg} if isinstance(arg, str) else dict(arg)
        name = slug(expand(arg["name"]))
        st["n"] += 1
        rel = f"{st['flow']}/{st['n']:02d}_{name}.png"
        path = self.plan.out / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        await self.images_ready(page)
        if self.plan.hide:
            await page.add_style_tag(content=",".join(self.plan.hide) + "{visibility:hidden!important}")
        masks = [resolve(page, s) for s in self.plan.mask]
        full = arg.get("full_page", self.plan.full_page)
        if arg.get("selector"):
            await resolve(page, arg["selector"]).screenshot(path=str(path), animations="disabled", mask=masks)
        else:
            await page.screenshot(path=str(path), full_page=full, animations="disabled", caret="hide", mask=masks)
        try:
            path.with_suffix(".txt").write_text(await page.evaluate("() => document.body.innerText"))
        except Exception:
            pass
        api, errors = st["api"], st["errors"]
        entry = {
            "file": rel, "name": name, "caption": expand(arg.get("caption") or "", strict=False),
            "url": page.url, "title": await page.title(), "via": st["via"], "node": arg.get("node"),
            "api": {"calls": len(api), "failed": [a for a in api if a["status"] >= 400]},
            "errors": list(errors),
        }
        st["shots"].append(entry)
        st["via"] = None
        api.clear()
        errors.clear()
        bad = len(entry["api"]["failed"])
        print(f"  [shot] {rel}" + (f"  !! {bad} failed API call(s)" if bad else "") + (f"  !! {len(entry['errors'])} page error(s)" if entry["errors"] else ""))

    # ------------------------------------------------------------ steps

    async def step(self, page, st: dict, step, where: str) -> None:
        step = {step: True} if isinstance(step, str) else dict(step)
        optional = step.pop("optional", False)
        timeout = step.pop("timeout", 15000)
        step.pop("note", None)
        (kind, arg), = step.items()
        try:
            await self._do(page, st, kind, arg, timeout)
        except Exception as e:
            if optional:
                print(f"    (skipped optional {kind}: {str(e).splitlines()[0][:100]})")
                return
            raise StepError(f"{where} ({kind}: {arg!r}): {str(e).splitlines()[0]}") from e

    async def _do(self, page, st: dict, kind: str, arg, timeout: int) -> None:
        if kind == "goto":
            await self.goto(page, arg)
            st["via"] = f"go to {arg}"
        elif kind == "click":
            sel = expand(arg)
            await resolve(page, sel).click(timeout=timeout)
            await self.settle(page)
            st["via"] = f"click {describe(sel)}"
        elif kind == "fill":
            for sel, value in arg.items():
                await resolve(page, expand(sel)).fill(str(expand(value)), timeout=timeout)
        elif kind == "select":
            for sel, label in arg.items():
                await resolve(page, expand(sel)).select_option(label=str(expand(label)), timeout=timeout)
        elif kind in ("check", "uncheck"):
            loc = resolve(page, expand(arg))
            await (loc.check if kind == "check" else loc.uncheck)(timeout=timeout)
        elif kind == "press":
            if isinstance(arg, dict):
                for sel, key in arg.items():
                    await resolve(page, expand(sel)).press(key, timeout=timeout)
            else:
                await page.keyboard.press(arg)
            await self.settle(page, 400)
        elif kind == "hover":
            await resolve(page, expand(arg)).hover(timeout=timeout)
            await page.wait_for_timeout(300)
        elif kind == "upload":
            for sel, file in arg.items():
                f = Path(expand(file))
                f = f if f.is_absolute() else self.plan.path.parent / f
                await resolve(page, expand(sel)).set_input_files(str(f), timeout=timeout)
            await self.settle(page)
            st["via"] = "upload a file"
        elif kind == "wait":
            await self._wait(page, arg, timeout)
        elif kind == "scroll":
            if isinstance(arg, int):
                await page.mouse.wheel(0, arg)
            else:
                await resolve(page, expand(arg)).scroll_into_view_if_needed(timeout=timeout)
            await page.wait_for_timeout(400)
        elif kind == "smart_fill":
            from playwright_scraper.fillers import SMART_FILL_JS
            overrides = arg if isinstance(arg, dict) else {}
            await page.evaluate("ov => { window.__playwrightScraperOverrides = ov; }", expand(overrides))
            await page.evaluate(SMART_FILL_JS)
            await page.wait_for_timeout(500)
        elif kind == "eval":
            await page.evaluate(arg)
        elif kind == "shot":
            await self.shot(page, st, arg)
        elif kind == "open_first":
            before = page.url
            await resolve(page, expand(arg)).click(timeout=timeout)
            await self.settle(page)
            if page.url == before:
                raise StepError(f"clicking the first {arg} didn't open anything")
            st["via"] = "open the first row"
        elif kind == "dismiss":
            for sel in ([arg] if isinstance(arg, str) else arg):
                for el in await page.locator(sel).all():
                    if await el.is_visible():
                        await el.click()
                        await page.wait_for_timeout(200)
        elif kind == "call":
            spec = {"fn": arg} if isinstance(arg, str) else dict(arg)
            fn = getattr(self.hooks, spec["fn"], None) if self.hooks else None
            if fn is None:
                raise PlanError(f"no hook {spec['fn']!r} in {self.plan.hooks or '(no hooks file)'}")
            await fn(page, Kit(self, st), **expand(spec.get("args") or {}))
        else:
            raise PlanError(f"unknown step {kind}")

    async def _wait(self, page, arg, timeout: int) -> None:
        if isinstance(arg, (int, float)):
            await page.wait_for_timeout(arg)
        elif "text" in arg:
            await page.get_by_text(expand(arg["text"])).first.wait_for(timeout=arg.get("timeout", timeout))
        elif "selector" in arg:
            await resolve(page, expand(arg["selector"])).wait_for(state=arg.get("state", "visible"), timeout=arg.get("timeout", timeout))
        elif "gone" in arg:
            await resolve(page, expand(arg["gone"])).wait_for(state="hidden", timeout=arg.get("timeout", timeout))
        elif "url" in arg:
            await page.wait_for_url(expand(arg["url"]), timeout=arg.get("timeout", timeout))
        else:
            raise PlanError(f"wait: give ms, text, selector, gone or url (got {arg})")
        await page.wait_for_timeout(300)

    # ------------------------------------------------------------ flows

    async def run_flow(self, browser, flow, signed) -> tuple[list, str | None]:
        ctx = await self.new_context(browser, signed_in=False) if flow.fresh else signed
        page = await ctx.new_page()
        st = {"flow": flow.id, "n": 0, "via": None, "shots": [], "api": [], "errors": []}

        ignore = self.plan.ignore_api

        def on_response(r):
            if r.request.resource_type in ("xhr", "fetch") and not any(i in r.url for i in ignore):
                st["api"].append({"method": r.request.method, "url": r.url, "status": r.status})
        page.on("response", on_response)
        page.on("pageerror", lambda e: st["errors"].append(str(e)[:300]))
        error = None
        try:
            for i, step in enumerate(flow.steps, 1):
                await self.step(page, st, step, f"flow {flow.id} step {i}")
        except Exception as e:
            error = str(e)
            print(f"  !! {error}")
            err = self.plan.out / "_errors" / f"{flow.id}.png"  # outside the flow folder: not a screen
            err.parent.mkdir(parents=True, exist_ok=True)
            await _safe_shot(page, err)
        await page.close()
        if flow.fresh:
            await ctx.close()
        return st["shots"], error

    async def run(self, flow_ids: list[str] | None = None) -> int:
        plan = self.plan
        flows = [plan.flow(f) for f in flow_ids] if flow_ids else plan.flows
        plan.out.mkdir(parents=True, exist_ok=True)
        for f in flows:  # a re-captured flow starts from an empty folder
            shutil.rmtree(plan.out / f.id, ignore_errors=True)
        results = {f["id"]: f for f in self.manifest.get("flows", [])}
        failed = 0
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=not self.headed)
            signed = None
            for flow in flows:
                print(f"\n== {flow.id}: {flow.title}")
                if not flow.fresh and signed is None:
                    signed = await self.new_context(browser, signed_in=True)
                shots, error = await self.run_flow(browser, flow, signed)
                failed += bool(error)
                results[flow.id] = {"id": flow.id, "title": flow.title, "description": flow.description,
                                    "fresh": flow.fresh, "shots": shots, "error": error}
            await browser.close()
        order = [f.id for f in plan.flows]
        self.manifest = {
            "name": plan.name, "base_url": plan.base_url,
            "captured_at": time.strftime("%Y-%m-%d %H:%M %Z"),
            "readonly": plan.readonly, "blocked": self.guard.blocked if plan.readonly else None,
            "flows": [results[i] for i in order if i in results],
        }
        (plan.out / "manifest.json").write_text(json.dumps(self.manifest, indent=2) + "\n")
        log = plan.out / "_guard.log"
        if plan.readonly:
            log.write_text("\n".join(self.guard.blocked) + "\n" if self.guard.blocked else "no mutating requests were attempted\n")
            print(f"\nread-only guard: {len(self.guard.blocked)} request(s) blocked" if self.guard.blocked
                  else "\nread-only guard: no mutating requests were attempted")
        total = sum(len(results[f.id]["shots"]) for f in flows)
        print(f"{total} screenshots in {len(flows)} flow(s) -> {plan.out}" + (f"; {failed} flow(s) failed" if failed else ""))
        return 1 if failed else 0


async def _safe_shot(page, path: Path) -> None:
    try:
        await page.screenshot(path=str(path))
    except Exception:
        pass
