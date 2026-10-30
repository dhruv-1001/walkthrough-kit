// Voices from a TTS API, instead of the local Kokoro model (lib/narrate.py).
// A provider turns one line of text into audio in any format ffmpeg reads;
// toClip() then makes it the same kind of clip Kokoro's are: mono 24 kHz WAV,
// silence trimmed, both ends faded.
//
// Built in: openai, elevenlabs, google, azure. Keys come from the environment,
// never from data.json. A project can bring its own provider: set
// data.voice.provider to a module path ("./my-tts.mjs", relative to the project)
// whose default export is { name?, voice?, model?, synthesize(req) -> Buffer }.
import { spawnSync } from 'node:child_process';
import { renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { deepMerge } from './project.mjs';

function key(name) {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set: the API key for this voice (see videos/README.md, "The voice")`);
  return v;
}

/** POST, retrying rate limits and server errors; resolves to the response body. Errors name the host, never the URL (keys can ride in it). */
async function post(url, { headers, body }) {
  for (let attempt = 1; ; attempt++) {
    let res = null;
    let failure = null;
    try {
      res = await fetch(url, { method: 'POST', headers, body, signal: AbortSignal.timeout(90000) });
      if (res.ok) return Buffer.from(await res.arrayBuffer());
    } catch (e) {
      failure = e.message;
    }
    const retry = !res || res.status === 429 || res.status >= 500;
    if (!retry || attempt === 4) {
      throw new Error(`${new URL(url).host}: ${res ? `${res.status} ${(await res.text()).slice(0, 300)}` : failure}`);
    }
    const after = Number(res?.headers.get('retry-after'));
    await new Promise((r) => setTimeout(r, after > 0 ? after * 1000 : 1000 * 3 ** (attempt - 1)));
  }
}

const json = (o) => JSON.stringify(o);
const xml = (s) => s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]);
const lang = (voice) => voice.split('-').slice(0, 2).join('-'); // en-GB-Neural2-A -> en-GB

export const PROVIDERS = {
  // https://platform.openai.com/docs/api-reference/audio/createSpeech
  // OPENAI_BASE_URL points it at any OpenAI-compatible speech server instead.
  openai: {
    voice: 'coral',
    model: 'gpt-4o-mini-tts',
    synthesize: ({ text, voice, model, speed, instructions, options }) => post(
      `${(process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '')}/audio/speech`,
      {
        headers: { authorization: `Bearer ${key('OPENAI_API_KEY')}`, 'content-type': 'application/json' },
        body: json(deepMerge({ model, voice, input: text, response_format: 'wav', ...(speed !== 1 && { speed }), ...(instructions && { instructions }) }, options ?? {})),
      },
    ),
  },
  // https://elevenlabs.io/docs/api-reference/text-to-speech/convert (voice = a voice id from your library)
  elevenlabs: {
    voice: 'JBFqnCBsd6RMkjVDRZzb',
    model: 'eleven_multilingual_v2',
    synthesize: ({ text, voice, model, speed, options }) => post(
      `${(process.env.ELEVENLABS_BASE_URL || 'https://api.elevenlabs.io').replace(/\/$/, '')}/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=mp3_44100_128`,
      {
        headers: { 'xi-api-key': key('ELEVENLABS_API_KEY'), 'content-type': 'application/json' },
        body: json(deepMerge({ text, model_id: model, ...(speed !== 1 && { voice_settings: { speed } }) }, options ?? {})),
      },
    ),
  },
  // https://cloud.google.com/text-to-speech/docs/reference/rest/v1/text/synthesize (an API key restricted to Text-to-Speech)
  google: {
    voice: 'en-US-Neural2-F',
    async synthesize({ text, voice, speed, options }) {
      const base = (process.env.GOOGLE_TTS_BASE_URL || 'https://texttospeech.googleapis.com').replace(/\/$/, '');
      const body = deepMerge({
        input: { text },
        voice: { languageCode: lang(voice), name: voice },
        audioConfig: { audioEncoding: 'LINEAR16', sampleRateHertz: 24000, speakingRate: speed },
      }, options ?? {});
      const res = await post(`${base}/v1/text:synthesize?key=${encodeURIComponent(key('GOOGLE_TTS_API_KEY'))}`, {
        headers: { 'content-type': 'application/json' }, body: json(body),
      });
      return Buffer.from(JSON.parse(res).audioContent, 'base64');
    },
  },
  // https://learn.microsoft.com/azure/ai-services/speech-service/rest-text-to-speech
  azure: {
    voice: 'en-US-AvaMultilingualNeural',
    synthesize({ text, voice, speed }) {
      const base = process.env.AZURE_SPEECH_ENDPOINT || `https://${key('AZURE_SPEECH_REGION')}.tts.speech.microsoft.com`;
      const said = speed === 1 ? xml(text) : `<prosody rate="${speed > 1 ? '+' : ''}${Math.round((speed - 1) * 100)}%">${xml(text)}</prosody>`;
      return post(`${base.replace(/\/$/, '')}/cognitiveservices/v1`, {
        headers: {
          'ocp-apim-subscription-key': key('AZURE_SPEECH_KEY'),
          'content-type': 'application/ssml+xml',
          'x-microsoft-outputformat': 'riff-24khz-16bit-mono-pcm',
          'user-agent': 'walkthrough-kit',
        },
        body: `<speak version="1.0" xml:lang="${lang(voice)}"><voice name="${xml(voice)}">${said}</voice></speak>`,
      });
    },
  },
};

export const isModulePath = (provider) => /\.m?js$/.test(provider);

/** A provider by name, or a project's own module (an absolute path). */
export async function loadProvider(provider) {
  if (PROVIDERS[provider]) return { name: provider, ...PROVIDERS[provider] };
  if (!isModulePath(provider)) {
    throw new Error(`unknown voice provider "${provider}": use kokoro, ${Object.keys(PROVIDERS).join(', ')}, or a path to a .mjs module`);
  }
  const mod = (await import(pathToFileURL(provider).href)).default;
  if (typeof mod?.synthesize !== 'function') throw new Error(`${provider}: its default export needs synthesize({ text, voice, model, speed, ... })`);
  return { name: basename(provider).replace(/\.m?js$/, ''), ...mod };
}

/** Audio in any format -> the clip the mixer expects (what narrate.py's tidy() does for Kokoro). */
export function toClip(audio, out) {
  const download = `${out}.download`;
  writeFileSync(download, audio);
  // -40 dB is the 0.01 RMS Kokoro's clips are trimmed at; up to 20 ms of quiet is kept.
  const trim = 'silenceremove=start_periods=1:start_threshold=-40dB:start_silence=0.02';
  const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', download,
    '-af', `${trim},areverse,${trim},afade=t=in:d=0.04,areverse,afade=t=in:d=0.005`,
    '-ac', '1', '-ar', '24000', '-c:a', 'pcm_s16le', '-bitexact', `${out}.tmp.wav`], { encoding: 'utf8' });
  rmSync(download, { force: true });
  if (r.status !== 0) throw new Error(`ffmpeg couldn't read the audio the API sent: ${r.stderr.trim().split('\n').pop()}`);
  renameSync(`${out}.tmp.wav`, out);
}
