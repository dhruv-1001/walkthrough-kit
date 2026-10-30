---
name: screenshot-walkthrough
description: Capture a screen-by-screen screenshot walkthrough of a web app (sitemap graph, captioned gallery and a markdown doc listing screens with failed API calls) using walkthrough-kit's screenshot tool. Use when asked to screenshot every screen or page of an app, build a visual inventory, UI gallery or click-through of an app, document what an app looks like, or compare its screens before and after a change. Works read-only on live deployments.
---

# Screenshot walkthrough

The tool lives in the kit at `${CLAUDE_SKILL_DIR}/../../screenshots` (call it `$SHOTS`). Its
README is the full reference; read it before writing an unusual plan:
`${CLAUDE_SKILL_DIR}/../../screenshots/README.md`. Example plans to copy from, in
`$SHOTS/examples/`: `demo` (a local app), `saucedemo` (a public site, test accounts) and
`ccrs-configurator` (Keycloak sign-in, Python hooks).

## 1. Set up (once)

```bash
SHOTS=${CLAUDE_SKILL_DIR}/../../screenshots
[ -x $SHOTS/.venv/bin/python ] || $SHOTS/setup.sh
```

## 2. Pin down the target

Get from the user, or from the code and config in front of you:

- **URL** of the app, and whether it is **shared or live**. If it is anything but a local,
  throwaway instance, the plan gets a `readonly:` guard. That is not optional.
- **Sign-in**: which account, and how (form, SSO, magic link). Credentials go in environment
  variables (`${APP_USER}`, `${APP_PASS}`), never in the plan or in files you write. If the
  account has no password (magic link, SSO), ask the user for a saved session file and use
  `login.storage_state`.
- **Scope**: every screen, or one area (admin console, settings, a wizard)?

## 3. Find the screens

1. Write a minimal plan (`base_url`, `readonly`, `login`, one flow with `pages: [/]`) in a working
   folder: the user's repo if they want it kept (e.g. `docs/walkthrough/plan.yaml`), else a scratch
   folder. Not inside the kit.
2. `$SHOTS/shots discover plan.yaml`: it signs in and lists the pages reachable by links, as a
   ready-to-paste `pages:` list.
3. If the app's source is available, read its route table (React Router, Next.js `app/`, Vue
   router, a nav config) for screens that buttons open: wizards, dialogs, tabs, detail pages.
   Discovery misses those.

## 4. Write the plan

Group screens into flows the way a user meets them (signing in, the dashboard, each area). For
each screen write a **caption that says what the screen is for**, not what it is called. Patterns:

```yaml
readonly:                          # live app: abort every write; let sign-in through
  methods: [POST, PUT, PATCH, DELETE]
  allow: [/login, /oauth/token]
# App whose reads are POSTs (GraphQL, /_search)? Then: methods: [PUT, PATCH, DELETE]
# and paths: [mutation, _create, _update, ...]. Check the app's network calls first.

flows:
  - id: 01_sign_in
    title: Signing in
    fresh: true                    # signed-out browser
    steps:
      - goto: /
      - shot: {name: sign_in, caption: "..."}
  - id: 02_new_project
    title: Creating a project
    steps:
      - goto: /projects/new
      - shot: {name: blank, caption: "..."}
      - fill: {label=Name: Demo project}
      - shot: {name: filled, caption: "..."}       # stop before Save on a live app
  - id: 03_admin
    title: Admin
    pages:
      - {path: /admin/users, caption: "..."}
```

Prefer `label=`, `role=button[name="..."]` and `text=` selectors over CSS classes. Use
`wait: {text: ...}` after anything that loads data, `hide:` for toasts and cookie banners,
`mask:` for personal data, `ignore_api:` for failures that are expected (a 401 while signed out).

## 5. Run one flow, look, fix

```bash
$SHOTS/shots check plan.yaml
$SHOTS/shots capture plan.yaml --flow 02_new_project
```

Then **look at the result**. Open two or three PNGs with the Read tool, and grep the `.txt` page
dumps beside them for the text you expect. Typical fixes: a screen shot before its data loaded (add
a `wait`), a spinner or toast in the picture (`wait: {gone: ...}`, `hide:`), the wrong match
(tighter selector). A failed flow leaves `out/_errors/<flow>.png`. Look at it before changing
anything.

## 6. Full run and report

```bash
$SHOTS/shots run plan.yaml
```

Check before reporting:

- The last lines: screenshot count, failed flows, and the guard summary. On a live app it must say
  `no mutating requests were attempted`, unless a blocked write was deliberate. If the guard
  blocked something you didn't expect, say so.
- `out/walkthrough.md` → **What looked broken**: screens whose API calls failed or that threw
  errors. These are findings: report them to the user with the screen and the status code.

Deliver: `out/index.html` (sitemap), `out/gallery.html` and `out/walkthrough.md`, with a
two-line summary of what was captured and what looked broken. To publish, copy `out/` to any web
server; it is static.

## Don't

- Don't put passwords or tokens in the plan, the hooks or any file. Use environment variables or
  a session file, and don't commit `out/.signed-in.json` (it holds cookies).
- Don't capture a shared or production app without `readonly:`, and don't add a Save/Submit
  click to a live-app plan unless the guard demonstrably blocks it.
- Don't report screens you haven't looked at as fine.
