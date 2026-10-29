// Spoken narration for the captions: every caption line is also read aloud by
// Kokoro (lib/narrate.py, local and offline). Clips are cached on disk by
// voice + text, so a redo only synthesises lines that changed.
//
// Memory: the model needs ~2 GB. Every line is voiced before recording starts
// (a project with a heavy stack can stop it meanwhile: stack().beforeVoice);
// a line missing during a recording is synthesised only if plenty of memory is
// free, and on Linux always inside a systemd scope capped at 3 GB, so the
// worst case is the worker being killed, not the machine freezing.
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, freemem } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { PYTHON } from './project.mjs';

const VERSION = 2; // bump when narrate.py's clip post-processing changes
const RATE = 24000;
export const LEAD = 0.15; // voice starts this long after its caption appears
export const TAIL = 0.45; // quiet after a line before the next caption may appear
const WORKER_CAP = '3G';
const MIN_FREE_FOR_WORKER_MB = 5000;

// Clips are shared by every project: the same line in the same voice is voiced once.
export const VOICE_CACHE = process.env.WALKTHROUGH_VOICE_CACHE
  || join(process.env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'walkthrough-kit', 'voice');

export function memAvailableMb() {
  // Linux counts reclaimable cache as available; elsewhere free memory is the best guess.
  if (existsSync('/proc/meminfo')) {
    const m = readFileSync('/proc/meminfo', 'utf8').match(/MemAvailable:\s+(\d+)/);
    if (m) return Math.round(Number(m[1]) / 1024);
  }
  return Math.round(freemem() / 1048576);
}

/**
 * Caption text -> what is read aloud: no "# " title marker, titles end in a
 * full stop, and bracketed codes like "(GRO)" are left to the caption.
 */
export function spokenText(caption) {
  const title = caption.startsWith('# ');
  const text = caption.replace(/^# /, '').replace(/\s*\([A-Z][A-Z0-9_]+\)/g, '').trim();
  return title && !/[.!?]$/.test(text) ? `${text}.` : text;
}

/** Duration in seconds of a PCM or float WAV file. */
export function wavInfo(file) {
  const buf = readFileSync(file);
  let off = 12;
  let fmt = null;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    if (id === 'fmt ') fmt = { format: buf.readUInt16LE(off + 8), channels: buf.readUInt16LE(off + 10), rate: buf.readUInt32LE(off + 12), bits: buf.readUInt16LE(off + 22) };
    if (id === 'data') {
      if (!fmt) break;
      const frames = size / (fmt.channels * (fmt.bits / 8));
      return { ...fmt, dataOffset: off + 8, dataSize: size, duration: frames / fmt.rate };
    }
    off += 8 + size + (size % 2);
  }
  throw new Error(`not a WAV file: ${file}`);
}

/** Mono samples of a WAV as Float32Array (16-bit PCM or 32-bit float). */
function readSamples(file) {
  const info = wavInfo(file);
  const buf = readFileSync(file);
  const n = info.dataSize / (info.bits / 8) / info.channels;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const at = info.dataOffset + i * info.channels * (info.bits / 8);
    out[i] = info.format === 3 ? buf.readFloatLE(at) : buf.readInt16LE(at) / 32768;
  }
  return { samples: out, rate: info.rate };
}

export class Narrator {
  /**
   * @param {object} o
   * @param {string} o.voice   Kokoro voice id (af_heart, bf_emma, ...)
   * @param {number} [o.speed] 1 = Kokoro's normal pace
   * @param {object} [o.lexicon] word -> phonemes, for names the voice gets wrong
   */
  constructor({ voice = 'af_heart', speed = 1, lexicon = {}, cache = VOICE_CACHE, python = PYTHON } = {}) {
    Object.assign(this, { voice, speed, lexicon, cache: resolve(cache), python: resolve(python) });
    this.worker = null;
  }

  /** The lexicon entries a line actually uses (so a new entry re-voices only its lines). */
  lexiconFor(text) {
    return Object.fromEntries(Object.entries(this.lexicon).filter(([word]) => new RegExp(`(^|[^\\w])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\w])`).test(text)));
  }

  path(caption) {
    const text = spokenText(caption);
    const key = createHash('sha1').update(JSON.stringify([VERSION, this.voice, this.speed, text, this.lexiconFor(text)])).digest('hex').slice(0, 16);
    return join(this.cache, this.voice, `${key}.wav`);
  }

  has(caption) {
    return existsSync(this.path(caption));
  }

  /** {wav, duration} for a caption, synthesising it if needed (guarded). */
  async clip(caption) {
    const wav = this.path(caption);
    if (!existsSync(wav)) await this.synthesise([caption], { during: 'recording' });
    return { wav, duration: wavInfo(wav).duration };
  }

  /** Voice every caption in `captions` that isn't cached yet. */
  async synthesise(captions, { during = 'prep' } = {}) {
    const todo = [...new Set(captions)].filter((c) => !this.has(c));
    if (!todo.length) return 0;
    if (!this.worker) {
      const free = memAvailableMb();
      if (free < MIN_FREE_FOR_WORKER_MB) {
        throw new Error(`${todo.length} narration line(s) not voiced yet, and only ${free} MB of memory is free (the voice model needs ~2 GB; ${MIN_FREE_FOR_WORKER_MB} MB required). `
          + `Free some memory and run: node record.mjs --project <dir> --voice-prep${during === 'recording' ? '' : ' again'}`);
      }
      this.startWorker();
    }
    for (const [i, caption] of todo.entries()) {
      const out = this.path(caption);
      mkdirSync(dirname(out), { recursive: true });
      const res = await this.ask({ text: spokenText(caption), voice: this.voice, speed: this.speed, lexicon: this.lexiconFor(spokenText(caption)), out });
      if (res.error) throw new Error(`narration failed for "${caption}": ${res.error}`);
      if (during === 'prep') process.stdout.write(`\r  voiced ${i + 1}/${todo.length}`);
    }
    if (during === 'prep') process.stdout.write('\n');
    return todo.length;
  }

  startWorker() {
    const script = resolve(dirname(new URL(import.meta.url).pathname), 'narrate.py');
    const args = [this.python, script, '--cache', this.cache];
    // A capped scope: if the model ever grows past the cap, only the worker dies.
    const scoped = spawnSync('systemd-run', ['--user', '--scope', '--quiet', 'true']).status === 0;
    const [cmd, ...rest] = scoped
      ? ['systemd-run', '--user', '--scope', '--quiet', '-p', `MemoryMax=${WORKER_CAP}`, '-p', 'MemorySwapMax=0', ...args]
      : args;
    this.worker = spawn(cmd, rest, { stdio: ['pipe', 'pipe', 'pipe'] });
    this.worker.stderr.on('data', () => {}); // model chatter; errors come back as JSON
    this.lines = createInterface({ input: this.worker.stdout });
    this.pending = [];
    this.lines.on('line', (line) => this.pending.shift()?.(JSON.parse(line)));
    this.worker.on('exit', (code) => {
      for (const reply of this.pending.splice(0)) reply({ error: `voice worker exited (${code}); killed for memory?` });
      this.worker = null;
    });
  }

  ask(req) {
    return new Promise((reply) => {
      this.pending.push(reply);
      this.worker.stdin.write(`${JSON.stringify(req)}\n`);
    });
  }

  /**
   * Whisper back every clip and list the lines whose words don't match (so a
   * name can be fixed with data.voice.lexicon). Same memory cap as the voice.
   */
  async check(captions, { report }) {
    const items = [...new Set(captions)].map((c) => ({ wav: this.path(c), text: spokenText(c) })).filter((i) => existsSync(i.wav));
    const manifest = `${report}.json`;
    writeFileSync(manifest, JSON.stringify(items));
    const args = [this.python, resolve(dirname(new URL(import.meta.url).pathname), 'check_voice.py'), '--clips', manifest, '--report', report];
    const scoped = spawnSync('systemd-run', ['--user', '--scope', '--quiet', 'true']).status === 0;
    const [cmd, ...rest] = scoped ? ['systemd-run', '--user', '--scope', '--quiet', '-p', `MemoryMax=${WORKER_CAP}`, '-p', 'MemorySwapMax=0', ...args] : args;
    const r = spawnSync(cmd, rest, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    if (r.status !== 0) return `voice check failed: ${r.stderr.split('\n').slice(-3).join(' ')}`;
    return r.stdout.trim();
  }

  /** End the worker; resolves once it has exited (and its memory is free). */
  close() {
    const w = this.worker;
    this.worker = null;
    if (!w || w.exitCode !== null) return Promise.resolve();
    return new Promise((done) => {
      w.on('exit', done);
      w.stdin.end();
    });
  }
}

/**
 * One narration track for a clip: each cue's voice placed at cue.start + LEAD.
 * Writes 16-bit mono WAV of exactly `duration` seconds.
 */
export function mixdown(cues, duration, out) {
  const rate = RATE;
  const track = new Float32Array(Math.ceil(duration * rate));
  for (const cue of cues) {
    if (!cue.voice) continue;
    const { samples, rate: r } = readSamples(cue.voice.wav);
    if (r !== rate) throw new Error(`${cue.voice.wav}: ${r} Hz, expected ${rate}`);
    const at = Math.round((cue.start + LEAD) * rate);
    for (let i = 0; i < samples.length && at + i < track.length; i++) track[at + i] += samples[i];
  }
  return writeWav(track, rate, out);
}

/**
 * One narration track for a joined video: each part's WAV padded or trimmed to
 * exactly `duration` (its video's length), so the parts line up sample-exact.
 */
export function joinWavs(parts, out) {
  const rate = RATE;
  const total = parts.reduce((n, p) => n + Math.round(p.duration * rate), 0);
  const track = new Float32Array(total);
  let at = 0;
  for (const p of parts) {
    const n = Math.round(p.duration * rate);
    const { samples } = readSamples(p.wav);
    track.set(samples.subarray(0, Math.min(n, samples.length)), at);
    at += n;
  }
  return writeWav(track, rate, out);
}

function writeWav(track, rate, out) {
  const data = Buffer.alloc(track.length * 2);
  for (let i = 0; i < track.length; i++) data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(track[i] * 32767))), i * 2);
  const head = Buffer.alloc(44);
  head.write('RIFF', 0); head.writeUInt32LE(36 + data.length, 4); head.write('WAVE', 8);
  head.write('fmt ', 12); head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22);
  head.writeUInt32LE(rate, 24); head.writeUInt32LE(rate * 2, 28); head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34);
  head.write('data', 36); head.writeUInt32LE(data.length, 40);
  writeFileSync(out, Buffer.concat([head, data]));
  return out;
}
