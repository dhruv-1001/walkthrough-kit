# Screenshots

Captures every screen of a web app from a YAML **plan**, then renders three static pages you can
open from disk or put on any web server:

| File | What it is |
|---|---|
| `index.html` | **Sitemap graph**: one thumbnail per screen, one row per flow, arrows labelled with the click that led there. Click a node to zoom. |
| `gallery.html` | **Gallery**: every flow as a grid, with the plan's captions. |
| `walkthrough.md` | **Markdown walkthrough**: the same, readable on GitHub, ending with *What looked broken*: every screen whose API calls failed (4xx/5xx) or that threw a page error. |

Next to each screenshot (`out/<flow>/NN_<name>.png`) is the page's visible text (`.txt`), so a capture
can be searched and diffed. `out/manifest.json` has every shot's caption, URL, the action before it
and its failed API calls.

## Commands

```bash
./setup.sh                                  # once: .venv with Playwright, playwright-scraper, PyYAML + Chromium

./shots check    examples/demo/plan.yaml    # validate the plan, count the shots (no browser)
./shots discover examples/demo/plan.yaml    # sign in, follow links, print a ready-to-paste `pages:` list
./shots capture  examples/demo/plan.yaml [--flow 03_requests] [--headed]
./shots build    examples/demo/plan.yaml    # re-render the three pages from the last capture
./shots run      examples/demo/plan.yaml    # capture, then build
```

`--flow` re-captures one flow and keeps the others from the last run. `--headed` shows the browser.
The exit code is non-zero when a flow failed; its last screen is saved as `out/_errors/<flow>.png`.

## A plan

```yaml
name: Brightdesk                                  # title of the pages
base_url: ${BRIGHTDESK_URL:-http://127.0.0.1:4173}
out: out                                          # relative to the plan (default out/)
viewport: {width: 1440, height: 900}
full_page: true                                   # whole scrollable page (per shot: full_page: false)
settle_ms: 600                                    # wait after every navigation and click
locale: en-GB

readonly:                                         # the read-only guard (below); omit to allow writes
  methods: [POST, PUT, PATCH, DELETE]
  allow: [/api/login]

hide: ["#toasts", ".cookie-banner"]              # hidden before every shot
mask: [".account-number"]                         # painted over in every shot (personal data)
ignore_api: [/api/me, sentry]                     # failures here are expected: not reported

login:                                            # how to sign in; every flow but `fresh` ones reuses it
  storage_state: ${SAVED_SESSION:-}               # a saved signed-in session instead of the steps, if it exists
  steps:
    - goto: /login
    - fill: {label=Email: "${APP_USER}", label=Password: "${APP_PASS}"}
    - click: role=button[name="Sign in"]
    - wait: {text: Dashboard}

hooks: hooks.py                                   # Python functions a step can `call`

flows:
  - id: 01_sign_in                                # folder name; order of the pages
    title: Signing in
    fresh: true                                   # a new, signed-out browser
    steps:
      - goto: /login
      - shot: {name: sign_in, caption: "The sign-in page."}

  - id: 02_settings
    title: Settings
    description: Shown under the heading in walkthrough.md.
    pages:                                        # shorthand: go to each path and shoot it
      - /settings/profile
      - {path: /settings/billing, name: billing, caption: "Plan and invoices.", wait: {text: Invoices}}

edges:                                            # extra arrows in the sitemap: [from, to, label]
  - [01_sign_in/sign_in, 02_settings/billing, "sign in"]
```

`${VAR}` and `${VAR:-default}` come from the environment and are filled in when a step runs, so
`check` and `build` never need passwords. **Keep secrets out of the plan**: export them.

### Steps

One action per step. Any step can add `optional: true` (skip it if it fails), `timeout: 30000` (ms)
or `note: ...` (a comment for whoever reads the plan).

| Step | Example | Does |
|---|---|---|
| `goto` | `goto: /requests` | Open a path (or full URL); waits for the page to settle. Retries network blips. |
| `click` | `click: role=button[name="Save"]` | Click the first match, then settle. |
| `fill` | `fill: {label=Title: Broken projector}` | Type into fields (several at once). |
| `select` | `select: {label=Category: Technical}` | Pick a `<select>` option by its label. |
| `check` / `uncheck` | `check: role=radio[name="High"]` | Tick or untick. |
| `press` | `press: Escape` or `press: {label=Search: Enter}` | A key, on the page or a field. |
| `hover` | `hover: .menu-trigger` | Hover (menus that open on hover). |
| `upload` | `upload: {"#file": sample.csv}` | Hand a file (relative to the plan) to a file input. |
| `wait` | `wait: 2000` · `wait: {text: Saved}` · `wait: {selector: table}` · `wait: {gone: .spinner}` · `wait: {url: "**/done"}` | Wait for time, text, an element, its disappearance, or a URL. |
| `scroll` | `scroll: "#footer"` or `scroll: 800` | Scroll to an element, or by pixels. |
| `smart_fill` | `smart_fill: {name: Demo}` | Fill every empty field with plausible values (email, phone, name...). |
| `open_first` | `open_first: table tbody tr` | Click the first row and require that it opened something. |
| `dismiss` | `dismiss: ["button[aria-label=Close]"]` | Click away whatever is visible (toasts, dialogs). |
| `eval` | `eval: "localStorage.clear()"` | Run JavaScript in the page. |
| `call` | `call: choose_workspace` or `call: {fn: pick, args: {name: X}}` | A function from `hooks:` (below). |
| `shot` | `shot: dashboard` or `shot: {name, caption, full_page, selector, node}` | Take the screenshot. `selector` shoots one element; `node` merges several shots into one sitemap node. |

### Selectors

Anything Playwright accepts: CSS (`#email`, `.recent a`), `text=Save`,
`role=button[name="Sign in"]`, chains (`nav >> text=Settings`), `>> nth=-1` (the last match).
Shortcuts: `label=Email`, `placeholder=Search…`, `testid=save-button`. The first match is used.
Prefer roles and labels: they survive restyling and read like the page.

### Hooks

For what a plan can't say (pick from a list whose markup varies, branch on what the page shows),
`hooks:` points at a Python file. Each `async` function is callable as a step:

```python
async def choose_workspace(page, kit, name):
    if "Choose a workspace" in await page.inner_text("body"):
        await page.get_by_text(name, exact=True).click()
        await kit.shot(page, "after_choosing", caption="Workspace picked.")
```

`kit` has `goto(page, path)`, `shot(page, name, caption=...)`, `url(path)`, `log(msg)`, `plan`
and `base_url`. `page` is Playwright's async page. See `examples/ccrs-configurator/hooks.py`.

## The read-only guard

With `readonly:` set, every request that could change the app is aborted before it leaves the
browser, so a capture can run against a live, shared deployment as an admin. Even an accidental
click on *Save* writes nothing (the demo plan does exactly that, on purpose).

- `methods` are blocked (default `POST, PUT, PATCH, DELETE`). `GET`, `HEAD`, `OPTIONS` never are.
- `allow`: a request whose URL contains one of these goes through (sign-in, search endpoints).
- `paths`: a request whose URL contains one of these is blocked whatever its method. For apps
  whose reads are POSTs (`/_search`), drop `POST` from `methods` and list the write paths instead;
  `examples/ccrs-configurator/plan.yaml` does this for DIGIT.

Every blocked request is printed, listed at the end of `walkthrough.md` and in `out/_guard.log`
(which says `no mutating requests were attempted` when there were none).

## Finding the screens

`./shots discover plan.yaml` signs in like the plan does, follows same-site links breadth-first
(`--depth 2`, `--limit 60`), folds `/requests/101`, `/requests/102`... into one example, and
prints a `pages:` list to paste. Tune it in the plan:

```yaml
discover:
  start: [/, /admin]                 # where to begin
  exclude: [/export, /print]         # never follow these (logout links are skipped already)
  keep_query: false                  # treat ?tab=x as a different page
```

Single-page apps often switch screens with buttons, not links: the menus' pages are found, but
dialogs, wizard steps and tabs are not. Read the app's route table, or click through it once with
`--headed`, and add those as `steps`.

## Publishing

`out/` is plain HTML + PNG with relative paths. Open `index.html` straight from disk, or copy the
folder under any web root (`rsync -a out/ host:/var/www/walkthrough/`). The graph page loads
vis-network from unpkg; the gallery and the markdown need nothing.

## Examples

- [`examples/demo`](examples/demo/plan.yaml): Brightdesk (start it with `node demo-app/server.mjs`).
  Sign-in and a refused password from a signed-out browser, the dashboard, a filled form whose save
  the guard blocks, a CSV import preview, settings.
- [`examples/ccrs-configurator`](examples/ccrs-configurator/): the DIGIT configurator. Keycloak
  username-first sign-in, a workspace chooser (hook), the account pages and all 32 Management
  Studio routes, under a guard tuned for DIGIT's POST-based reads.

Built on [playwright-scraper](https://github.com/ChakshuGautam/playwright-scraper) (MIT), which draws
the graph and the gallery.
