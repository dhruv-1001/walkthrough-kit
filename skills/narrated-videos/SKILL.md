---
name: narrated-videos
description: Record narrated, captioned how-to videos of a web app (1080p MP4 with burnt-in captions, a local AI voice-over and .srt files) using walkthrough-kit's video tool, which drives the real app in a browser with a visible cursor. Use when asked to make onboarding, tutorial, training, demo or how-to videos of a web app's flows, to add a flow to an existing set, or to re-record videos after the UI changed.
---

# Narrated videos

The tool lives in the kit at `${CLAUDE_SKILL_DIR}/../../videos` (call it `$VIDEOS`). Read
`${CLAUDE_SKILL_DIR}/../../videos/README.md` for the full scene API before writing scenes. Copy
`$VIDEOS/examples/demo` as the starting point of a new project, or `$VIDEOS/examples/saucedemo`
for a public site you can't rewind (no stack). Look at
`$VIDEOS/examples/ccrs-configurator` for a large real one (sign-up by emailed link, three
passes, a database rewind).

## 1. Set up (once)

```bash
VIDEOS=${CLAUDE_SKILL_DIR}/../../videos
[ -x $VIDEOS/.venv/bin/python ] || $VIDEOS/setup.sh     # needs ffmpeg; ~2 GB for the voice
```

## 2. Agree the videos before any code

Work out with the user, and from the app:

- **Audience and videos**: one video per task a new user must do ("Setting up your account",
  "Inviting your team"). Two to five minutes each.
- **Every way to do each step**: by hand and in bulk (a spreadsheet), from scratch and from a
  template. Viewers ask "can I upload this instead?". Show each way, naming them all first.
- **What can be changed later and what can't**: say it in the video. Find out from the code or
  the app (is the field editable after saving?), not by guessing.
- **The app**: URL, how to get a clean starting state, how sign-up or sign-in works (an emailed
  link needs Mailpit: `data.mailpitUrl`).

Then write the **script first**: every caption, in order, in plain words. One idea per caption,
under ~25 words, no internal jargon (or explain it in passing). Show it to the user if wording
matters to them.

## 3. Decide passes and the rewind

Anything a user can do only once per account (sign up with this email, create the hierarchy, run
the import) can't be shown twice in one run. Put the second way in a later **pass**, which starts
from a fresh app. Then `stack().restore()` needs a way to rewind:

- an app reset endpoint or seed script (the demo: `POST /api/reset`);
- database snapshots (the CCRS example: Postgres template databases + container restarts);
- no rewind possible (a shared server): give each pass its own account with `data.passes.<id>`
  overrides, and leave `stack` out.

## 4. Build the project

```
my-videos/
  project.mjs      scenes, passes, videos, hooks (load / prepare / forPass / stack)
  data.json        baseUrl, what is typed and uploaded, voice
  scenes/*.mjs     { id, prepare({page, base}), run({page, actor, say, rec, data, outroMark, mail}) }
```

Rules that keep scenes working:

- **Captions come from `data`, never from the page.** Narration is collected in a dry run against
  a stand-in browser. Compute counts and names in `load(data)`. While recording, compare with
  the page and `console.warn` on a mismatch.
- Use `actor.click/type/hover/select/check`, not raw `page.click`, so the cursor moves like a
  person's and clicks wait for the caption.
- Point at what the caption is talking about (`actor.hover`) while it is spoken.
- Wrap server waits in `rec.cut(() => ...)` so they vanish from the video.
- End every video on the same closing line, and call `outroMark()` right after it, so joined videos
  keep only the last outro.
- Selectors: `getByRole`, `getByLabel`, `getByText`. Read the app's source for the exact labels.

## 5. Iterate on one video

```bash
$VIDEOS/redo.sh --project my-videos --lines             # read the script back: fix wording now
$VIDEOS/redo.sh --project my-videos --only 1 --headed   # record one video, watching
```

A failed scene prints the error and leaves `out/runs/<time>/error-<scene>.png`. Look at it with
Read before changing the scene.

## 6. Check the video before calling it done

- **Frames**: take the caption times from `out/latest/<video>.srt` and pull frames at the middle
  of several cues, at least each title, each form filled in, and each result:
  `ffmpeg -v error -ss <seconds> -i <video>.mp4 -frames:v 1 -vf scale=1280:-1 /tmp/f.png`, then Read
  them. Does the screen show what the caption says, with the cursor on it?
- **Voice**: `out/voice-check.tsv` and the run's "to listen to" list. A mangled name gets a
  `voice.lexicon` entry with phonemes. A transcription quirk (an apostrophe, "Market is" for
  "Mark it as") is fine.
- **Length and joins**: `ffprobe` each MP4. A joined video should switch parts cleanly.

Then record everything: `$VIDEOS/redo.sh --project my-videos`. Deliver
`out/latest/*.mp4` + `.srt` with each video's length and a one-line summary.

## Don't

- Don't start the voice model beside a memory-heavy stack. New lines are voiced before
  recording. If the app is heavy, implement `beforeVoice`/`afterVoice` to stop and start it.
- Don't record against a shared or production deployment without the user's say-so: scenes make
  real changes (sign-ups, records, emails).
- Don't put real people's names or real customer data in `data.json`. Use made-up but plausible
  data.
