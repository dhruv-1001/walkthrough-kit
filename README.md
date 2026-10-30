# walkthrough-kit

Two tools that turn a running web app into documentation, by driving it in a real browser with
[Playwright](https://playwright.dev):

| | What you get | Folder |
|---|---|---|
| **Screenshots** | Every screen of an app, captured in order: an interactive sitemap graph, a captioned gallery and a markdown walkthrough that ends with a list of the screens whose API calls failed. Safe on live deployments: a read-only guard stops every write. | [`screenshots/`](screenshots/) |
| **Videos** | Narrated how-to videos: 1080p MP4 with burnt-in captions, a natural voice-over made locally (no cloud TTS) and an `.srt` file for YouTube. A visible cursor glides, clicks and types at reading pace, and server waits are cut out. | [`videos/`](videos/) |

Both run against **any** web app: you describe your app in a plan (screenshots) or a small project
folder (videos). Each comes with three examples: **Brightdesk**, a small helpdesk app bundled in
[`demo-app/`](demo-app/) so everything works offline in a few minutes; **Swag Labs**
([saucedemo.com](https://www.saucedemo.com)), a public practice shop, to see it on a live site with
nothing to start; and the **CCRS / DIGIT configurator**, the real project these tools were built for.

Both also come as **Claude Code skills** (see [`skills/`](skills/)), so Claude can write the plan
or the scenes for a new app, run them, look at the result and fix what's off.

---

## Try it in five minutes

You need Node 20+, Python 3.10+ and `ffmpeg` (`sudo apt install ffmpeg` / `brew install ffmpeg`).

```bash
git clone https://github.com/dhruv-1001/walkthrough-kit && cd walkthrough-kit

screenshots/setup.sh          # Python env, Playwright, Chromium          (~1 min)
videos/setup.sh               # Node deps, Chromium, the voice: Kokoro + Whisper   (~5 min, ~2 GB)

./demo.sh                     # starts Brightdesk, runs both tools, stops it
```

Then open:

- `screenshots/examples/demo/out/index.html`: the sitemap graph (and `gallery.html`, `walkthrough.md`)
- `videos/examples/demo/out/latest/*.mp4`: three narrated videos with their `.srt` captions

Or run each step yourself:

```bash
node demo-app/server.mjs &                                  # http://127.0.0.1:4173
screenshots/shots run examples/demo/plan.yaml               # 12 screens, ~30 s
videos/redo.sh --project examples/demo                      # 3 videos, ~3 min
```

(`shots` and `redo.sh` resolve `examples/...` against their own folder, so they work from anywhere.)

### On a public site

Nothing to start: both tools point at [saucedemo.com](https://www.saucedemo.com), a shop Sauce Labs
runs for practising browser automation (public test accounts, no real orders).

```bash
screenshots/shots run examples/saucedemo/plan.yaml          # 15 screens, ~1 min
videos/redo.sh --project examples/saucedemo                 # 2 videos, ~2 min
```

The screenshots include one flow signed in as `error_user`, an account with bugs planted in it: the
screens look almost normal, and `walkthrough.md` ends with the three page errors behind them. The
read-only guard blocks the site's error reports to backtrace.io, its only writes.

---

## Point it at your own app

**Screenshots**: write a plan. A plan is one YAML file: where the app is, how to sign in, and the
screens to shoot. `discover` signs in and lists the pages it can reach, so you start from a real list.

```yaml
name: My App
base_url: https://staging.example.com
readonly:                              # abort every POST/PUT/PATCH/DELETE...
  allow: [/api/login]                  # ...except signing in
login:
  steps:
    - goto: /login
    - fill: {label=Email: "${APP_USER}", label=Password: "${APP_PASS}"}
    - click: role=button[name="Sign in"]
flows:
  - id: settings
    title: Settings
    pages:
      - {path: /settings/profile, caption: "Your profile."}
      - {path: /settings/billing, caption: "Plan and invoices."}
```

```bash
screenshots/shots discover my-app/plan.yaml     # pages it can reach, as a ready-to-paste list
screenshots/shots run my-app/plan.yaml          # capture + build the site
```

Full reference: [`screenshots/README.md`](screenshots/README.md).

**Videos**: make a project folder: the data to type, and one scene per part of a video. A scene
is plain Playwright with a narrator:

```js
export default {
  id: 'invite',
  async run({ page, actor, say, data }) {
    await say('# Inviting your team');                        // a title card
    await say('Open Members and choose Invite.');             // shown as a caption AND spoken
    await actor.click(page.getByRole('link', { name: 'Members' }));
    await actor.click(page.getByRole('button', { name: 'Invite' }));
    await actor.type(page.getByLabel('Email'), data.invitee.email);
  },
};
```

```bash
videos/redo.sh --project my-app --lines         # the script, scene by scene, no browser
videos/redo.sh --project my-app --only 1        # record one video
```

Full guide: [`videos/README.md`](videos/README.md). Start a new project by copying
[`videos/examples/demo`](videos/examples/demo/).

---

## With Claude Code

The two skills teach Claude how to use the tools end to end: explore the app, write the plan or the
scenes, run them, check the screenshots and video frames, and fix what's wrong.

| Skill | Ask for things like |
|---|---|
| [`screenshot-walkthrough`](skills/screenshot-walkthrough/SKILL.md) | "Screenshot every screen of staging.example.com's admin console" · "Make a visual inventory of the settings pages" |
| [`narrated-videos`](skills/narrated-videos/SKILL.md) | "Make onboarding videos for sign-up and inviting a team" · "The billing page changed: re-record video 3" |

**Inside this repo** they load automatically (`.claude/skills/` links to them). **In any other
project**, install the kit as a plugin:

```
/plugin marketplace add dhruv-1001/walkthrough-kit
/plugin install walkthrough-kit@walkthrough-kit
```

(The repo is private: the plugin install uses your own git credentials, so `gh auth login` and
`gh auth setup-git` first.)

---

## What's where

```
demo-app/                 Brightdesk: a tiny helpdesk app (no dependencies) both tools are tried on
screenshots/
  shots, shots.py         the CLI: check · discover · capture · build · run
  shotkit/                plan loader, read-only guard, capture runner, site builder
  examples/demo/          plan for Brightdesk
  examples/saucedemo/     plan for a public site, saucedemo.com (one flow catches planted bugs)
  examples/ccrs-configurator/   plan + hooks for the DIGIT configurator (Keycloak sign-in, 40 screens)
videos/
  record.mjs, redo.sh     the recorder
  lib/                    screen recorder, cursor + human-paced actions, captions, voice (Kokoro), Whisper check
  examples/demo/          3 videos of Brightdesk, 2 passes
  examples/saucedemo/     2 videos of a public site: no stack, defaults for everything else
  examples/ccrs-configurator/   the 5 CCRS onboarding videos, 3 passes, Postgres-snapshot rewind
skills/                   the Claude Code skills
.claude-plugin/           plugin + marketplace manifest
```

Outputs land in `out/` next to each plan or project and are not committed.
