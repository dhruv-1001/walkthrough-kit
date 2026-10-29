"""A capture plan: one YAML file that says where the app is, how to sign in,
and which screens to shoot (README.md has the full reference).

Values may use ${VAR} or ${VAR:-default} from the environment. They are
expanded when a step runs, so `check` and `build` never need the secrets.
"""
from __future__ import annotations

import os
import re
from dataclasses import dataclass, field
from pathlib import Path

import yaml

ENV = re.compile(r"\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}")

ACTIONS = {
    "goto", "click", "fill", "select", "check", "uncheck", "press", "hover", "upload", "wait",
    "scroll", "smart_fill", "eval", "shot", "open_first", "dismiss", "call",
}
MODIFIERS = {"optional", "timeout", "note"}


class PlanError(Exception):
    pass


def expand(value, *, strict: bool = True):
    """${VAR} / ${VAR:-default} from the environment, recursively through lists and dicts."""
    if isinstance(value, str):
        def sub(m):
            name, default = m.group(1), m.group(2)
            if name in os.environ:
                return os.environ[name]
            if default is not None:
                return default
            if strict:
                raise PlanError(f"${{{name}}} is not set (export {name}=...)")
            return m.group(0)
        return ENV.sub(sub, value)
    if isinstance(value, list):
        return [expand(v, strict=strict) for v in value]
    if isinstance(value, dict):
        return {expand(k, strict=strict): expand(v, strict=strict) for k, v in value.items()}
    return value


def slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", str(text).lower()).strip("_")[:60] or "screen"


@dataclass
class Flow:
    id: str
    title: str
    steps: list
    fresh: bool = False
    description: str = ""


@dataclass
class Plan:
    path: Path
    name: str
    base_url: str
    out: Path
    viewport: dict
    full_page: bool
    settle_ms: int
    locale: str | None
    readonly: dict | None
    hide: list
    mask: list
    login: dict | None
    hooks: Path | None
    flows: list[Flow]
    edges: list
    discover: dict
    ignore_api: list
    raw: dict = field(repr=False, default_factory=dict)

    def url(self, path_or_url: str) -> str:
        if re.match(r"^[a-z]+://", path_or_url):
            return path_or_url
        return self.base_url.rstrip("/") + "/" + path_or_url.lstrip("/")

    def flow(self, fid: str) -> Flow:
        for f in self.flows:
            if f.id == fid:
                return f
        raise PlanError(f"no flow {fid!r} (flows: {', '.join(f.id for f in self.flows)})")


def _steps_from_pages(pages) -> list:
    """`pages:` shorthand: each entry is a path, or {path, name, caption, wait, full_page}."""
    steps = []
    for p in pages:
        p = {"path": p} if isinstance(p, str) else dict(p)
        if "path" not in p:
            raise PlanError(f"pages entry without a path: {p}")
        steps.append({"goto": p["path"]})
        if p.get("wait"):
            steps.append({"wait": p["wait"]})
        shot = {"name": p.get("name") or slug(p["path"].strip("/") or "home")}
        for k in ("caption", "full_page", "node"):
            if k in p:
                shot[k] = p[k]
        steps.append({"shot": shot})
    return steps


def _check_steps(where: str, steps) -> None:
    if not isinstance(steps, list):
        raise PlanError(f"{where}: steps must be a list")
    for i, s in enumerate(steps, 1):
        if isinstance(s, str):
            s = {s: True}
        if not isinstance(s, dict):
            raise PlanError(f"{where} step {i}: expected a mapping like `click: ...`, got {s!r}")
        acts = [k for k in s if k not in MODIFIERS]
        if len(acts) != 1 or acts[0] not in ACTIONS:
            raise PlanError(f"{where} step {i}: one action per step, one of {', '.join(sorted(ACTIONS))} (got {', '.join(acts) or 'none'})")


def load(path: str | Path) -> Plan:
    path = Path(path).resolve()
    if not path.exists():
        raise PlanError(f"no plan at {path}")
    raw = yaml.safe_load(path.read_text()) or {}
    here = path.parent

    name = raw.get("name") or here.name
    base_url = expand(raw.get("base_url") or "", strict=False)
    if not base_url:
        raise PlanError("base_url is required")
    out = here / expand(raw.get("out", "out"), strict=False)

    readonly = raw.get("readonly")
    if readonly is True:
        readonly = {}
    if isinstance(readonly, dict):
        readonly = {
            "methods": [m.upper() for m in readonly.get("methods", ["POST", "PUT", "PATCH", "DELETE"])],
            "paths": list(readonly.get("paths", [])),
            "allow": list(readonly.get("allow", [])),
        }

    flows = []
    seen = set()
    for i, f in enumerate(raw.get("flows") or [], 1):
        fid = str(f.get("id") or f"{i:02d}_{slug(f.get('title', 'flow'))}")
        if fid in seen:
            raise PlanError(f"two flows with id {fid!r}")
        seen.add(fid)
        steps = list(f.get("steps") or []) + _steps_from_pages(f.get("pages") or [])
        _check_steps(f"flow {fid}", steps)
        flows.append(Flow(id=fid, title=f.get("title") or fid.replace("_", " "), steps=steps,
                          fresh=bool(f.get("fresh")), description=f.get("description", "")))
    if not flows:
        raise PlanError("the plan has no flows")

    login = raw.get("login")
    if login:
        _check_steps("login", login.get("steps") or [])

    hooks = raw.get("hooks")
    return Plan(
        path=path, name=name, base_url=base_url, out=out,
        viewport=raw.get("viewport") or {"width": 1440, "height": 900},
        full_page=raw.get("full_page", True),
        settle_ms=int(raw.get("settle_ms", 1200)),
        locale=raw.get("locale"),
        readonly=readonly or None,
        hide=list(raw.get("hide") or []),
        mask=list(raw.get("mask") or []),
        login=login,
        hooks=(here / hooks) if hooks else None,
        flows=flows,
        edges=list(raw.get("edges") or []),
        ignore_api=list(raw.get("ignore_api") or []),
        discover=raw.get("discover") or {},
        raw=raw,
    )
