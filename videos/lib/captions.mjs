// English captions, timed to what actually happens on screen. A scene calls
// say(text) as it acts; the caption runs until the next say(). Each caption is
// held for at least its reading time, so a fast UI can't flash text past the
// viewer. Captions render in a band BELOW the app (the page is recorded at
// 1920x960 and padded to 1080), so they never cover what is being shown.
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { LEAD, TAIL, mixdown } from './narration.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Seconds a caption must stay up: ~200 words a minute, never under 2.2s. */
export function readingTime(text) {
  const words = text.replace(/^# /, '').trim().split(/\s+/).length;
  return Math.max(2.2, 0.8 + words * 0.32);
}

export class Captions {
  /**
   * @param recorder  the ScreenRecorder (null = not recording)
   * @param narrator  a Narrator: each caption is also read aloud, and held until it has been
   * @param collect   an array: dry run, only record which lines would be said (for --voice-prep)
   */
  constructor(recorder, { enabled = true, narrator = null, collect = null } = {}) {
    this.rec = recorder;
    this.enabled = enabled;
    this.narrator = narrator;
    this.collect = collect;
    this.cues = [];
    this.current = null;
  }

  /** How long a cue must stay up: its reading time, or its voice plus a breath. */
  hold(cue) {
    return Math.max(readingTime(cue.text), cue.voice ? LEAD + cue.voice.duration + TAIL : 0);
  }

  /**
   * Show `text` (null clears). Waits out the previous caption first.
   * `spoken` reads something other than the caption aloud (e.g. "G.R.O." for "GRO").
   */
  async say(text, { spoken } = {}) {
    if (this.collect) {
      if (text) this.collect.push(spoken ?? text);
      return;
    }
    if (!this.rec) return;
    if (this.current) {
      const minEnd = this.current.start + this.hold(this.current);
      const now = this.rec.now();
      if (now < minEnd) await sleep((minEnd - now) * 1000);
      this.current.end = this.rec.now();
      this.cues.push(this.current);
      this.current = null;
    }
    if (text) {
      const voice = this.narrator ? await this.narrator.clip(spoken ?? text) : null;
      this.current = { start: this.rec.now(), text, voice };
    }
  }

  /** Wait until the current caption has been readable (and spoken) for its full time. */
  async settle() {
    if (!this.rec || !this.current) return;
    const minEnd = this.current.start + this.hold(this.current);
    const now = this.rec.now();
    if (now < minEnd) await sleep((minEnd - now) * 1000);
  }

  async close() {
    await this.say(null);
  }

  toSrt() {
    const ts = (s) => {
      const ms = Math.round(s * 1000);
      const p = (n, w = 2) => String(n).padStart(w, '0');
      return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
    };
    return this.cues.map((c, i) => `${i + 1}\n${ts(c.start)} --> ${ts(c.end)}\n${c.text.replace(/^# /, '')}\n`).join('\n');
  }

  toAss({ width = 1920, height = 1080, band = 120, font = 'Noto Sans', size = 38 } = {}) {
    const ts = (s) => {
      const cs = Math.round(s * 100);
      return `${Math.floor(cs / 360000)}:${String(Math.floor(cs / 6000) % 60).padStart(2, '0')}:${String(Math.floor(cs / 100) % 60).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`;
    };
    const esc = (t) => t.replace(/\\/g, '\\\\').replace(/\{/g, '\\{').replace(/\}/g, '\\}').replace(/\n/g, '\\N');
    const cy = height - band / 2;
    return [
      '[Script Info]',
      'ScriptType: v4.00+',
      `PlayResX: ${width}`,
      `PlayResY: ${height}`,
      'WrapStyle: 0',
      'ScaledBorderAndShadow: yes',
      '',
      '[V4+ Styles]',
      'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
      `Style: Cap,${font},${size},&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,5,160,160,0,1`,
      `Style: Title,${font},${size + 8},&H00FFFFFF,&H000000FF,&H00000000,&H00000000,-1,0,0,0,100,100,0.5,0,1,0,0,5,160,160,0,1`,
      '',
      '[Events]',
      'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
      ...this.cues.map((c) => {
        const title = c.text.startsWith('# ');
        return `Dialogue: 0,${ts(c.start)},${ts(c.end)},${title ? 'Title' : 'Cap'},,0,0,0,,{\\an5\\pos(${width / 2},${cy})\\fad(150,150)}${esc(title ? c.text.slice(2) : c.text)}`;
      }),
      '',
    ].join('\n');
  }
}

/**
 * raw (1920x960) -> final 1920x1080: caption band underneath, captions burnt
 * in, a silent AAC track (some players and upload pipelines want audio).
 */
export async function renderFinal({ raw, ass, out, narration = null, until = null, band = 120, bandColor = '0x0f172a', crf = 18 }) {
  const vf = [
    `pad=iw:ih+${band}:0:0:color=${bandColor}`,
    `drawbox=x=0:y=ih-${band}:w=iw:h=2:color=0x334155:t=fill`,
    ass ? `ass='${ass.replace(/'/g, "\\'")}'` : null,
  ].filter(Boolean).join(',');
  const args = [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-i', raw,
    ...(narration ? ['-i', narration] : ['-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000']),
    '-vf', vf,
    ...(narration ? ['-af', 'loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000', '-ac', '2'] : []),
    '-c:v', 'libx264', '-preset', 'slow', '-crf', String(crf), '-pix_fmt', 'yuv420p', '-profile:v', 'high',
    '-c:a', 'aac', '-b:a', narration ? '128k' : '64k', '-shortest',
    ...(until !== null ? ['-t', until.toFixed(3)] : []),
    '-movflags', '+faststart',
    out,
  ];
  await new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', args, { stdio: ['ignore', 'inherit', 'inherit'] });
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg render exited ${code} for ${out}`))));
  });
}

export function writeCaptionFiles(captions, base, { duration } = {}) {
  writeFileSync(`${base}.srt`, captions.toSrt());
  writeFileSync(`${base}.ass`, captions.toAss());
  const voiced = captions.cues.some((c) => c.voice);
  const narration = voiced && duration ? mixdown(captions.cues, duration, `${base}.voice.wav`) : null;
  return { srt: `${base}.srt`, ass: `${base}.ass`, narration };
}
