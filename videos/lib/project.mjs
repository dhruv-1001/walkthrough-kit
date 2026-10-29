// A project = one app's videos: a folder with project.mjs, a data file and
// its scenes. project.mjs default-exports:
//
//   name      'my-app' (defaults to the folder name)
//   data      the data file, relative to the folder ('data.json')
//   scenes    [scene, ...]: each { id, prepare?(ctx), run(ctx) } (see README.md)
//   passes    [{ id, scenes: [ids] }]: runs from a fresh app, in order; a scene is
//             recorded in the first pass that lists it, replayed off camera after.
//             Default: one pass with every scene.
//   videos    [{ number, id, slug, scenes: [ids], parts?: { name: [ids] } }]: what
//             gets delivered, joined in this order. Default: one video per scene.
//   browser   { width, height, scale, locale, timezoneId }: the recorded window
//             (1536x768 at 1.25 = 1920x960, padded to 1080 with the caption band)
//
// Optional hooks (all may be async):
//   load(data, env)       add computed fields the captions use (runs before the dry run)
//   prepare(data, env)    build files the scenes upload; again per pass if forPass changes the data
//   forPass(data, passId) the data a pass uses (default: data.passes[passId] merged over data)
//   stack(data, env)      how to rewind the app between passes: { restore({ pass }),
//                         snapshot?({ force }), beforeVoice?(), afterVoice?({ restoring }),
//                         ensureUp?({ restoring }) }, or null to run passes back to back
// env = { dir, out, dataFile, python, base, opts }.
import { existsSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const KIT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The Python with Kokoro, faster-whisper and openpyxl (setup-voice.sh makes it). */
export const PYTHON = process.env.WALKTHROUGH_PYTHON || join(KIT, '.venv', 'bin', 'python');

const isObject = (v) => v && typeof v === 'object' && !Array.isArray(v);

/** b merged into a: objects merge key by key, anything else (arrays too) replaces. */
export function deepMerge(a, b) {
  if (!isObject(a) || !isObject(b)) return b === undefined ? a : b;
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = deepMerge(a[k], v);
  return out;
}

export async function loadProject(dir) {
  const file = join(dir, 'project.mjs');
  if (!existsSync(file)) throw new Error(`${dir} is not a project: no project.mjs (see README.md, "Your own app")`);
  const p = { ...(await import(pathToFileURL(file).href)).default };
  p.dir = dir;
  p.name ??= basename(dir);
  p.data ??= 'data.json';
  if (!p.scenes?.length) throw new Error(`${file}: no scenes`);
  p.sceneById = Object.fromEntries(p.scenes.map((s) => [s.id, s]));
  const ids = p.scenes.map((s) => s.id);
  p.passes ??= [{ id: 'main', scenes: ids }];
  p.videos ??= p.scenes.map((s, i) => ({ number: i + 1, id: s.id, slug: `${String(i + 1).padStart(2, '0')}-${s.id}` }))
    .map((v) => ({ ...v, scenes: [v.id] }));
  p.forPass ??= (data, passId) => (data.passes?.[passId] ? deepMerge(data, data.passes[passId]) : data);

  const known = new Set(ids);
  const inPass = new Set(p.passes.flatMap((x) => x.scenes));
  for (const pass of p.passes) for (const id of pass.scenes) if (!known.has(id)) throw new Error(`pass ${pass.id}: no scene ${id}`);
  for (const v of p.videos) {
    for (const id of [...v.scenes, ...Object.values(v.parts ?? {}).flat()]) {
      if (!known.has(id)) throw new Error(`video ${v.slug}: no scene ${id}`);
      if (!inPass.has(id)) throw new Error(`video ${v.slug}: scene ${id} is in no pass, so it is never recorded`);
    }
  }
  return p;
}
