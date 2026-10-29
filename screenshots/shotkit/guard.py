"""The read-only guard: aborts every request that could change the app, so a
capture can safely run against a live, shared deployment as an admin.

Plan `readonly:` settings
  methods  requests with these methods are blocked (default POST, PUT, PATCH, DELETE)
  paths    also block any request whose URL contains one of these (for apps whose
           writes hide behind POST paths, e.g. `_create`, `_update`)
  allow    let a request through when its URL contains one of these (sign-in, search)
GET, HEAD and OPTIONS are never blocked. An app whose reads are POSTs (search
endpoints) sets `methods: [PUT, PATCH, DELETE]` and lists its write paths instead.
"""
from __future__ import annotations

SAFE = {"GET", "HEAD", "OPTIONS"}


class Guard:
    def __init__(self, cfg: dict | None):
        self.cfg = cfg
        self.blocked: list[str] = []

    def verdict(self, method: str, url: str) -> bool:
        """True = block."""
        if not self.cfg or method in SAFE:
            return False
        low = url.lower()
        if any(a.lower() in low for a in self.cfg["allow"]):
            return False
        return method in self.cfg["methods"] or any(p.lower() in low for p in self.cfg["paths"])

    async def install(self, context) -> None:
        if not self.cfg:
            return

        async def handler(route):
            req = route.request
            if self.verdict(req.method, req.url):
                entry = f"{req.method} {req.url}"
                self.blocked.append(entry)
                print(f"  [read-only guard] blocked {entry}")
                await route.abort()
            else:
                await route.continue_()

        await context.route("**/*", handler)
