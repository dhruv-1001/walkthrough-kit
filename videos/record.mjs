#!/usr/bin/env node
// Records narrated, captioned how-to videos of a web app by driving it with
// Playwright. What to record lives in a project folder (see README.md):
// project.mjs (scenes, passes, videos, hooks), a data file, scenes/*.mjs.
//
//   node record.mjs --project examples/demo           # record every video of a project
//   node record.mjs --project <dir> --only 2          # one video (earlier steps still run, unrecorded and fast)
//   node record.mjs --project <dir> --only sign-in,import   # scene ids work too
//   node record.mjs --project <dir> --lines           # print every narration line, scene by scene (no browser)
//   node record.mjs --project <dir> --voice-prep      # voice every line now (the model needs ~2 GB)
//   node record.mjs --project <dir> --voice bf_emma   # another Kokoro voice; --no-voice for captions only
//   node record.mjs --project <dir> --assemble <dir>/out/runs/<t> --only 2   # re-join videos from a run
//   node record.mjs --project <dir> --snapshot        # take the baseline the rewind returns to (if the project has one)
//   node record.mjs --project <dir> --no-reset        # don't rewind between passes (debugging a scene)
//   node record.mjs --project <dir> --headed --no-captions --data <dir>/data/other.json --out /tmp/out
//
// A project whose scenes change the app (sign up, create records) runs in
// passes, each from a rewound app, so every take starts from the same state.
// Output: <project>/out/runs/<timestamp>/, finished videos copied to <project>/out/latest/.
import { chromium } from 'playwright';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { ScreenRecorder } from './lib/recorder.mjs';
import { Actor, CURSOR_SCRIPT } from './lib/actions.mjs';
import { Captions, renderFinal, writeCaptionFiles } from './lib/captions.mjs';
import { Narrator, joinWavs, memAvailableMb } from './lib/narration.mjs';
import { stub, stubActor, stubRecorder } from './lib/dryrun.mjs';
import { mailbox } from './lib/mail.mjs';
import { loadProject, PYTHON } from './lib/project.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
// Below this much free memory the run stops itself (browser closed, encoders
// ended) instead of pushing the machine into swap.
const MIN_FREE_MB = 1500;

function parseArgs(argv) {
  const opts = {
    project: process.env.WALKTHROUGH_PROJECT || 'examples/demo', data: null, only: null, reset: true, captions: true,
    headed: false, speed: 1, snapshot: false, resnapshot: false, out: null, voice: undefined, voicePrep: false, lines: false, assemble: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--project' || a === '-p') opts.project = next();
    else if (a === '--data') opts.data = next();
    else if (a === '--only') opts.only = next().split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--no-reset') opts.reset = false;
    else if (a === '--no-captions') opts.captions = false;
    else if (a === '--headed') opts.headed = true;
    else if (a === '--speed') opts.speed = Number(next());
    else if (a === '--snapshot') opts.snapshot = true;
    else if (a === '--resnapshot') opts.resnapshot = true;
    else if (a === '--out') opts.out = next();
    else if (a === '--voice') opts.voice = next();
    else if (a === '--no-voice') opts.voice = null;
    else if (a === '--voice-prep') opts.voicePrep = true;
    else if (a === '--lines') opts.lines = true;
    else if (a === '--assemble') opts.assemble = next();
    else if (a === '--help' || a === '-h') { console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 22).join('\n')); process.exit(0); }
    else throw new Error(`unknown argument ${a}`);
  }
  return opts;
}

/** Which scene ids to record, from --only (scene ids, video ids or video numbers). */
function selectedScenes(project, only) {
  const { scenes, sceneById, videos } = project;
  if (!only) return new Set(scenes.map((s) => s.id));
  const picked = new Set();
  for (const key of only) {
    const video = videos.find((v) => v.id === key || String(v.number) === key || v.slug === key);
    if (video) video.scenes.forEach((s) => picked.add(s));
    else if (sceneById[key]) picked.add(key);
    else throw new Error(`--only ${key}: not a scene (${scenes.map((s) => s.id).join(', ')}) or video (1-${videos.length})`);
  }
  return picked;
}

/** The passes to run: each cut off after the last scene it records. */
function plan(project, record) {
  // A scene is recorded in the first pass that lists it; later passes only replay it.
  const recordedIn = {};
  for (const pass of project.passes) for (const id of pass.scenes) recordedIn[id] ??= pass.id;
  return project.passes.map((pass) => {
    const last = pass.scenes.reduce((at, id, i) => (record.has(id) && recordedIn[id] === pass.id ? i : at), -1);
    return { ...pass, steps: pass.scenes.slice(0, last + 1).map((id) => ({ id, recording: record.has(id) && recordedIn[id] === pass.id })) };
  }).filter((p) => p.steps.length);
}

function ffmpeg(args) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`ffmpeg ${args.join(' ')} failed`);
}

function probeDuration(file, stream = null) {
  const sel = stream ? ['-select_streams', stream, '-show_entries', 'stream=duration'] : ['-show_entries', 'format=duration'];
  const r = spawnSync('ffprobe', ['-v', 'error', ...sel, '-of', 'csv=p=0', file], { encoding: 'utf8' });
  return Number(r.stdout.trim());
}

/** Join finished clips (same encoding) and their captions into one video. */
function joinClips(clips, out) {
  if (clips.length === 1) {
    copyFileSync(clips[0].mp4, `${out}.mp4`);
    copyFileSync(clips[0].srt, `${out}.srt`);
    return;
  }
  // Pictures are joined as they are; the sound is rebuilt as ONE track from
  // each part's narration cut to its picture's exact length (copying the AAC
  // streams drifts ~70 ms per join: AAC frames don't end where the video does).
  // `duration` makes each part start where the previous PICTURE ends.
  const lengths = clips.map((c) => probeDuration(c.mp4, 'v:0'));
  const list = `${out}.txt`;
  writeFileSync(list, clips.map((c, i) => `file '${resolve(c.mp4)}'\nduration ${lengths[i].toFixed(6)}`).join('\n'));
  if (clips.every((c) => c.wav)) {
    const wav = joinWavs(clips.map((c, i) => ({ wav: c.wav, duration: lengths[i] })), `${out}.voice.wav`);
    ffmpeg(['-f', 'concat', '-safe', '0', '-i', list, '-i', wav, '-map', '0:v', '-map', '1:a', '-c:v', 'copy',
      '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000', '-ac', '2', '-c:a', 'aac', '-b:a', '128k', '-shortest',
      '-movflags', '+faststart', `${out}.mp4`]);
    rmSync(wav);
  } else {
    ffmpeg(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', `${out}.mp4`]);
  }
  rmSync(list);
  let offset = 0;
  const cues = [];
  for (const c of clips) {
    if (existsSync(c.srt)) {
      for (const block of readFileSync(c.srt, 'utf8').trim().split(/\n\n+/)) {
        const [, time, ...text] = block.split('\n');
        if (!time) continue;
        const shift = (t) => {
          const [h, m, rest] = t.split(':');
          const [s, ms] = rest.split(',');
          const total = +h * 3600 + +m * 60 + +s + +ms / 1000 + offset;
          const p = (n, w = 2) => String(n).padStart(w, '0');
          const tm = Math.round(total * 1000);
          return `${p(Math.floor(tm / 3600000))}:${p(Math.floor(tm / 60000) % 60)}:${p(Math.floor(tm / 1000) % 60)},${p(tm % 1000, 3)}`;
        };
        const [a, b] = time.split(' --> ');
        cues.push(`${cues.length + 1}\n${shift(a)} --> ${shift(b)}\n${text.join('\n')}\n`);
      }
    }
    offset += lengths[clips.indexOf(c)];
  }
  writeFileSync(`${out}.srt`, cues.join('\n'));
}

/** Encode a recorded clip: caption band, burnt-in captions, narration, .srt. `until` drops its outro. */
async function renderClip(clip, base, { captions, until = null }) {
  let caps = clip.captions;
  let duration = clip.seconds;
  if (until !== null) {
    const cues = caps.cues.filter((c) => c.start < until - 0.05).map((c) => ({ ...c, end: Math.min(c.end, until) }));
    caps = Object.assign(Object.create(Object.getPrototypeOf(caps)), caps, { cues });
    duration = until;
  }
  const files = writeCaptionFiles(caps, base, { duration });
  await renderFinal({ raw: clip.raw, ass: captions ? files.ass : null, out: `${base}.final.mp4`, narration: files.narration, until });
  return { mp4: `${base}.final.mp4`, srt: files.srt, wav: files.narration };
}

/** Run each scene with a stand-in browser and collect the lines it will say. */
async function collectLines(project, steps, shared) {
  const lines = [];
  for (const { id } of steps) {
    const captions = new Captions(null, { collect: lines });
    await project.sceneById[id].run({
      ...shared, page: stub(), context: stub('context'), actor: stubActor(), rec: stubRecorder, mail: stub('mail'),
      say: (t, o) => captions.say(t, o), settle: async () => {}, outroMark: () => {},
    });
  }
  return lines;
}

/**
 * Join each video (and its parts) from rendered scene clips and copy them to
 * out/latest. `pick(ids)` returns the clips to join, the outro cut from all but
 * the last.
 */
async function deliverVideos({ project, runDir, out, finals, pick }) {
  const latest = join(out, 'latest');
  mkdirSync(latest, { recursive: true });
  const delivered = [];
  const deliver = async (ids, name) => {
    if (!ids.every((s) => finals[s])) return;
    const file = join(runDir, name);
    joinClips(await Promise.all(pick(ids)), file);
    for (const ext of ['mp4', 'srt']) copyFileSync(`${file}.${ext}`, join(latest, `${name}.${ext}`));
    delivered.push(`${name}.mp4 (${probeDuration(`${file}.mp4`).toFixed(0)}s)`);
  };
  for (const video of project.videos) {
    await deliver(video.scenes, video.slug);
    for (const [part, ids] of Object.entries(video.parts ?? {})) await deliver(ids, `${video.slug}.part-${part}`);
  }
  return delivered;
}

/** --assemble: the rendered clips of an earlier run (raw/<id>.final.mp4, its .srt and .voice.wav). */
async function reassemble(project, runDir, record, out) {
  const raw = (id) => ({ mp4: join(runDir, 'raw', `${id}.final.mp4`), srt: join(runDir, 'raw', `${id}.srt`), wav: join(runDir, 'raw', `${id}.voice.wav`) });
  const finals = Object.fromEntries([...record].filter((id) => existsSync(raw(id).mp4)).map((id) => [id, raw(id)]));
  const pick = (ids) => ids.map((id, i) => {
    const cut = raw(`${id}.no-outro`);
    return i < ids.length - 1 && existsSync(cut.mp4) ? cut : finals[id];
  });
  const delivered = await deliverVideos({ project, runDir, out, finals, pick });
  console.log(delivered.length ? `Videos (also in ${out}/latest/):\n  ${delivered.join('\n  ')}` : 'No complete video in that run for --only.');
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  // Paths on the command line are the caller's; everything else is relative to this folder.
  // A project path that isn't there from here is tried against this folder (examples/demo).
  const projectDir = existsSync(resolve(opts.project)) ? resolve(opts.project) : resolve(HERE, opts.project);
  const project = await loadProject(projectDir);
  opts.out = resolve(opts.out ?? join(project.dir, 'out'));
  const dataFile = resolve(opts.data ?? join(project.dir, project.data));
  if (opts.assemble) opts.assemble = resolve(opts.assemble);
  process.chdir(HERE);
  mkdirSync(opts.out, { recursive: true });
  const data = JSON.parse(readFileSync(dataFile, 'utf8'));
  data.dir = dirname(dataFile);
  const base = data.baseUrl.replace(/\/$/, '');
  // What a hook gets besides the data: where things are, and the Python with the kit's packages.
  const env = { dir: project.dir, out: opts.out, dataFile, python: PYTHON, base, opts };
  await project.load?.(data, env);

  // The project's way to rewind the app between passes (and to free memory
  // while the voice model runs). None = passes run back to back on one app.
  const stack = project.stack ? await project.stack(data, env) : null;
  if (opts.snapshot || opts.resnapshot) {
    if (!stack?.snapshot) throw new Error(`${project.name} has no snapshot to take (project.stack().snapshot)`);
    console.log('Taking the baseline snapshot');
    await stack.snapshot({ force: opts.resnapshot });
    console.log('Done. Every pass now starts from this state.');
    return;
  }
  if (!stack?.restore) opts.reset = false;

  const record = selectedScenes(project, opts.only);
  if (opts.assemble) return reassemble(project, opts.assemble, record, opts.out);
  const passes = plan(project, record);
  const voice = opts.voice === undefined ? (data.voice?.id ?? 'af_heart') : opts.voice;
  const narrator = voice ? new Narrator({ voice, speed: data.voice?.speed ?? 1, lexicon: data.voice?.lexicon ?? {} }) : null;
  const dry = { data, base, state: {}, dir: project.dir };

  if (opts.lines) {
    for (const p of passes) for (const s of p.steps.filter((x) => x.recording)) {
      console.log(`\n[${s.id}]`);
      for (const l of await collectLines(project, [s], dry)) console.log(`  ${l}`);
    }
    return;
  }

  // Every line the recorded scenes will say, found without a browser, and
  // voiced before anything is recorded (with the app's stack stopped, if the
  // project says how: the voice model needs ~2 GB).
  if (narrator) {
    const steps = passes.flatMap((p) => p.steps.filter((s) => s.recording));
    const lines = await collectLines(project, steps, dry);
    const missing = [...new Set(lines)].filter((l) => !narrator.has(l));
    if (opts.voicePrep || missing.length) console.log(`Narration (${voice}): ${new Set(lines).size} lines, ${missing.length} to voice`);
    if (missing.length) {
      await stack?.beforeVoice?.();
      try {
        await narrator.synthesise(missing); // refuses (with a hint) if memory is short
        await narrator.close();
        // Hear every new clip back and flag lines the voice got wrong.
        console.log(`  checking the new clips with Whisper (report: ${join(opts.out, 'voice-check.tsv')})`);
        console.log(await narrator.check(missing, { report: join(opts.out, 'voice-check.tsv') }));
      } finally {
        await narrator.close();
        await stack?.afterVoice?.({ restoring: !opts.voicePrep && opts.reset });
      }
    }
    if (opts.voicePrep) return;
  }
  await stack?.ensureUp?.({ restoring: opts.reset });
  await project.prepare?.(data, env);

  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
  const runDir = join(opts.out, 'runs', stamp);
  mkdirSync(join(runDir, 'raw'), { recursive: true });
  console.log(`Run ${stamp}: recording ${[...record].join(', ')}${narrator ? ` (voice ${voice})` : ''}`);

  let browser = null;
  let lowest = memAvailableMb();
  let aborted = null;
  const guard = setInterval(() => {
    const free = memAvailableMb();
    lowest = Math.min(lowest, free);
    if (free < MIN_FREE_MB && !aborted) {
      aborted = `only ${free} MB of memory left`;
      console.error(`\n✗ Stopping: ${aborted}. Close something and run again.`);
      browser?.close().catch(() => {});
    }
  }, 2000);

  const settings = { width: 1536, height: 768, scale: 1.25, locale: 'en-GB', timezoneId: 'UTC', ...project.browser, ...data.video };
  const clips = {};
  let failed = null;
  for (const pass of passes) {
    if (failed || aborted) break;
    console.log(`Pass "${pass.id}"`);
    if (opts.reset) {
      console.log('  rewinding the app to its baseline');
      await stack.restore({ pass });
    }
    browser = await chromium.launch({ headless: !opts.headed, args: ['--hide-scrollbars', '--disable-features=Translate'] });
    const context = await browser.newContext({
      viewport: { width: settings.width, height: settings.height },
      deviceScaleFactor: settings.scale,
      locale: settings.locale,
      timezoneId: settings.timezoneId,
      colorScheme: 'light',
      acceptDownloads: true,
    });
    await context.addInitScript(CURSOR_SCRIPT);
    // Hide scrollbars the page itself draws.
    await context.addInitScript(() => {
      const style = document.createElement('style');
      style.textContent = '*::-webkit-scrollbar{width:0!important;height:0!important}';
      document.addEventListener('DOMContentLoaded', () => document.head.appendChild(style));
    });
    const page = await context.newPage();
    page.setDefaultTimeout(45000);
    const passData = project.forPass(data, pass.id);
    // Files the project builds from its data (uploads, say) follow the pass's data.
    if (passData !== data) await project.prepare?.(passData, { ...env, pass });
    const shared = { data: passData, base, page, context, state: {}, runDir, dir: project.dir, mail: mailbox(passData.mailpitUrl) };

    for (const { id, recording } of pass.steps) {
      const scene = project.sceneById[id];
      const actor = new Actor(page, { speed: recording ? opts.speed : 0 });
      let rec = null;
      let captions = new Captions(null);
      const clip = { raw: join(runDir, 'raw', `${id}.mp4`), outroAt: null };
      console.log(`  ${recording ? '● recording' : '○ running  '} ${id}`);
      try {
        if (scene.prepare) await scene.prepare({ ...shared, actor });
        if (recording) {
          rec = new ScreenRecorder(page, { out: clip.raw, width: Math.round(settings.width * settings.scale), height: Math.round(settings.height * settings.scale) });
          await rec.start();
          captions = new Captions(rec, { enabled: opts.captions, narrator });
        }
        actor.settle = () => captions.settle();
        await scene.run({
          ...shared, actor,
          rec: rec ?? { cut: (fn) => fn(), pause() {}, resume() {}, now: () => 0 },
          say: (t, o) => captions.say(t, o),
          settle: () => captions.settle(),
          outroMark: () => { if (rec) clip.outroAt = captions.current?.start ?? rec.now(); },
        });
        await captions.close();
        if (rec) {
          clip.seconds = await rec.stop();
          clip.captions = captions;
          clips[id] = clip;
          console.log(`    ${clip.seconds.toFixed(1)}s`);
        }
      } catch (err) {
        failed = aborted ? new Error(aborted) : err;
        const shot = join(runDir, `error-${id}.png`);
        await page.screenshot({ path: shot }).catch(() => {});
        if (rec) await rec.stop().catch(() => {});
        console.error(`✗ ${id} failed: ${failed.message}\n  screenshot: ${shot}`);
        break;
      }
    }
    await browser.close().catch(() => {});
    browser = null;
  }
  clearInterval(guard);
  await narrator?.close();

  // Encode every finished clip; a clip with an outro that sits mid-video is
  // also cut just before it.
  const finals = {};
  const trimmed = {};
  for (const [id, clip] of Object.entries(clips)) {
    finals[id] = await renderClip(clip, join(runDir, 'raw', id), { captions: opts.captions });
  }
  const pick = (ids) => ids.map((id, i) => {
    const clip = clips[id];
    if (i === ids.length - 1 || clip.outroAt === null) return finals[id];
    return (trimmed[id] ??= renderClip(clip, join(runDir, 'raw', `${id}.no-outro`), { captions: opts.captions, until: clip.outroAt }));
  });

  const delivered = await deliverVideos({ project, runDir, out: opts.out, finals, pick });
  console.log(delivered.length ? `\nVideos (also in ${join(opts.out, 'latest')}/):\n  ${delivered.join('\n  ')}` : '\nNo complete video this run.');
  console.log(`Run folder: ${runDir}   (lowest free memory during the run: ${lowest} MB)`);
  if (failed || aborted) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
