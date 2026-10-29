# Videos

Records narrated how-to videos of a web app by driving it with Playwright the way a person would:
a visible cursor glides to each control, clicks ripple, typing runs at reading pace. Every line of
narration is shown as a caption **and** spoken by a local voice ([Kokoro](https://huggingface.co/hexgrad/Kokoro-82M),
Apache-2.0, offline). Waits on the server are cut out of the picture.

Each video comes out as:

- `NN-name.mp4`: 1920×1080, 30 fps, H.264 + AAC. The app fills 1920×960; captions sit in a dark
  band **under** it, so they never cover the UI. Audio is loudness-normalised (−16 LUFS).
- `NN-name.srt`: the same captions, for YouTube's own subtitles.

## Commands

```bash
./setup.sh                                          # once: npm deps, Chromium, .venv with Kokoro + Whisper (~2 GB)

./redo.sh --project examples/demo                   # record every video of a project
./redo.sh --project examples/demo --only 2          # one video (earlier steps still run, off camera and fast)
./redo.sh --project examples/demo --only import     # or scene ids, comma-separated
./redo.sh --project examples/demo --lines           # print the narration, scene by scene (no browser, no app)
./redo.sh --project examples/demo --headed          # watch it drive the browser
./redo.sh --project examples/demo --no-voice        # captions only
./redo.sh --project examples/demo --voice bf_emma   # another voice (list below)
./redo.sh --project examples/demo --assemble examples/demo/out/runs/<t> --only 2   # re-join from a run's clips
```

Finished videos land in `<project>/out/latest/`. Every run also keeps `<project>/out/runs/<time>/`
with each scene's clip in `raw/`, and `error-<scene>.png` if a scene failed.

## A project

A folder with three things. Copy [`examples/demo`](examples/demo/) to start.

```
my-app/
  project.mjs        scenes, passes, videos, hooks
  data.json          everything typed, picked or uploaded, the voice, the app's URL
  scenes/*.mjs       one file per part of a video
```

### project.mjs

```js
import signIn from './scenes/01-sign-in.mjs';
import newRequest from './scenes/02-new-request.mjs';
import importCsv from './scenes/02b-import.mjs';

export default {
  data: 'data.json',
  scenes: [signIn, newRequest, importCsv],
  // Each pass starts from a fresh app. A scene is RECORDED in the first pass that
  // lists it and replayed off camera (fast) in later ones.
  passes: [
    { id: 'by-hand', scenes: ['sign-in', 'new-request'] },
    { id: 'from-csv', scenes: ['sign-in', 'import'] },
  ],
  // What gets delivered: scenes joined in order. `parts` also delivers pieces of a video on their own.
  videos: [
    { number: 1, id: 'start', slug: '01-getting-started', scenes: ['sign-in'] },
    { number: 2, id: 'requests', slug: '02-raising-requests', scenes: ['new-request', 'import'] },
  ],
  browser: { locale: 'en-GB', timezoneId: 'Europe/London' },   // and width/height/scale

  // Hooks, all optional:
  load(data, env) {},          // add computed fields the captions use (counts...); runs before the dry run
  prepare(data, env) {},       // build files the scenes upload; runs again per pass if forPass changes the data
  forPass(data, passId) {},    // the data a pass uses (default: data.passes[passId] merged over data)
  stack(data, env) {           // how to put the app back between passes (null: passes run back to back)
    return {
      restore: async () => { /* reset endpoint, DB snapshot, fresh tenant... */ },
      ensureUp: async () => { /* fail early, with a hint, if the app is down */ },
      snapshot: async ({ force }) => {},   // --snapshot: take the baseline restore() returns to
      beforeVoice: async () => {},         // free memory for the voice model (stop a heavy stack)
      afterVoice: async ({ restoring }) => {},
    };
  },
};
```

`passes` and `videos` default to one pass and one video per scene. `env` is
`{ dir, out, dataFile, python, base, opts }`.

**Why passes:** a step a user can do only once per account (sign up, set up a hierarchy, import)
can't be shown twice in one run. Show the second way in a second pass from a rewound app. Without a
way to rewind, give each pass its own account instead: `data.passes.<id>` overrides fields for
that pass (another email, another workspace name).

### A scene

```js
export default {
  id: 'new-request',
  // Off camera, before recording starts: get to where the video begins.
  async prepare({ page, base }) {
    await page.goto(`${base}/`);
  },
  async run({ page, actor, say, rec, data, outroMark, mail, state }) {
    await say('# Raising requests');                                  // "# " = a title card
    await say('Give it a short title.');                              // caption + voice
    await actor.click(page.getByRole('link', { name: 'New request' }));
    await actor.type(page.getByLabel('Title'), data.request.title);
    await actor.select(page.getByLabel('Category'), data.request.category);
    await actor.click(page.getByRole('button', { name: 'Create request' }));
    await rec.cut(() => page.getByRole('heading', { name: data.request.title }).waitFor());
    await say('It gets a number straight away.');
    await say('That’s all there is to it.');
    outroMark();                                                      // the outro starts here
  },
};
```

What a scene gets:

| | |
|---|---|
| `say(text, { spoken })` | Show a caption and speak it. It stays up until it has been read **and** spoken, and the next click waits for that. `# ` makes a title. `spoken` reads something else aloud (`"G.R.O."` for `"GRO"`). |
| `actor.click(loc, { at, settle })` | Glide to the element, wait for the caption, click. |
| `actor.type(loc, text, { delay })` | Click a field, clear it, type at reading pace. |
| `actor.hover(loc, { at })` | Point at something while the caption talks about it. |
| `actor.select(loc, label)` | A native `<select>`. `actor.choose(trigger, option)` for Radix/shadcn selects. |
| `actor.check(loc)`, `actor.scroll(dy)`, `actor.scrollTop()`, `actor.reveal(loc)`, `actor.pause(ms)` | The rest. |
| `rec.cut(fn)` | Run `fn` with the recording paused: server waits vanish from the video. |
| `settle()` | Wait until the current caption has been fully read and spoken. |
| `outroMark()` | Where this scene's closing line begins. A video joined from several scenes keeps only the last one's. |
| `mail.waitForLink(email, { since, match })` | The link from an email in Mailpit (`data.mailpitUrl`): sign-up and invite flows. |
| `data`, `base`, `page`, `context`, `state`, `dir`, `runDir` | The pass's data, the app URL, Playwright's page and context, a per-pass scratch object, the project folder, the run folder. |

**Captions come from the data, never from the page.** Before recording, every scene is run once
against a stand-in browser to collect what it will say, so all the narration is voiced up front.
A caption built from something read off the screen would be empty in that dry run. Work out
counts and names in the `load` hook instead, and check against the page while recording
(`console.warn` when they disagree).

### Writing good narration

- Say what the viewer is about to see, in plain words. Explain terms the app uses
  ("jurisdiction: the areas they can act in").
- One idea per caption; under ~25 words.
- When a step can be done more than one way (by hand, or a spreadsheet), name the ways first, then
  show each.
- Say what can be changed later and what can't. That is usually the viewer's real question.
- Run `--lines` and read the script top to bottom before recording.

## How a run works

1. **Plan**: which scenes to record, in which passes. `--only` trims each pass after the last
   scene it records.
2. **Voice**: the dry run collects every line. New lines are voiced by Kokoro, then heard back by
   Whisper. Lines whose transcript doesn't match are listed (fix a name with `voice.lexicon`).
   Clips are cached in `~/.cache/walkthrough-kit/voice`, shared by all projects, so a re-record
   only voices lines that changed.
3. **Passes**: per pass, `stack().restore()` rewinds the app, a fresh browser starts, and the
   scenes run: recorded ones at presentation pace, the others instantly.
4. **Recording**: Chrome's own screencast frames at 1920×960 (a 1536×768 window at 1.25×), re-timed
   to a constant 30 fps. Not Playwright's `recordVideo`: that is VP8 at ~1 Mbit/s and smears text.
5. **Encode**: caption band added, captions burnt in, narration mixed at each caption's start.
   Videos made of several scenes are joined with one continuous audio track, so nothing drifts.

## The voice

`data.voice`: `{ "id": "af_heart", "speed": 1, "lexicon": { "Wekesa": "wɛkˈɛsə" } }`.
Voices starting `a` are American English, `b` British: `af_heart`, `af_bella`, `am_michael`,
`bf_emma`, `bm_george`... ([all voices](https://huggingface.co/hexgrad/Kokoro-82M/blob/main/VOICES.md)).
The lexicon gives phonemes for names it gets wrong; only lines using an entry are re-voiced.

To compare voices on a finished video without re-recording:
`.venv/bin/python lib/voice_sample.py <project>/out/latest/01-x.mp4 --voices af_heart,bf_emma --out /tmp/voices`.
To hear-check a finished video against its captions: `.venv/bin/python lib/check_voice.py <video>.mp4`.

## Memory

The voice model needs about 2 GB. New lines are voiced before recording starts. A project with a
heavy local stack can stop it meanwhile (`beforeVoice` / `afterVoice`; the CCRS example does this).
During a recording a missing line is voiced only if 5 GB is free, and on Linux inside a systemd scope
capped at 3 GB. The recorder stops itself if free memory drops under 1.5 GB.

## Checking a video

- `out/voice-check.tsv`: every new line, what Whisper heard, and a match score.
- Frames at caption times: `ffmpeg -ss 44 -i out/latest/02-x.mp4 -frames:v 1 frame.png`. Read the
  `.srt` for the times. Look at the start, every title, and every place the caption names
  something on screen.
- A failed scene leaves `out/runs/<time>/error-<scene>.png` and the run's other clips. Fix it, then
  `--only` that video.

## Examples

- [`examples/demo`](examples/demo/): Brightdesk (start it with `node demo-app/server.mjs`). Three
  videos in two passes, rewound through the app's reset endpoint. The import scene uploads a CSV the
  `prepare` hook builds from `data.json`.
- [`examples/ccrs-configurator`](examples/ccrs-configurator/): the five CCRS onboarding videos.
  Magic-link sign-up through Mailpit, three passes (by hand, from spreadsheets, fetched boundaries),
  a local DIGIT stack rewound from Postgres template databases and restarted in dependency waves.
