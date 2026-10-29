"""Narration worker: speaks caption lines with Kokoro (local, offline TTS).

Reads one JSON request per line on stdin and answers one JSON line per request:
  {"text": "...", "voice": "bf_emma", "speed": 1.0, "lexicon": {"Wekesa": "wɛkˈɛsə"}}
  -> {"wav": "/abs/path.wav", "duration": 3.41}
Clips are cached by (voice, speed, text, lexicon) under --cache, so a redo only
synthesises lines that changed. Voices starting "b" are British English, "a"
American (see https://huggingface.co/hexgrad/Kokoro-82M/blob/main/VOICES.md).
"""
import argparse
import hashlib
import json
import os
import re
import sys
import warnings

warnings.filterwarnings('ignore')
os.environ.setdefault('TOKENIZERS_PARALLELISM', 'false')

import numpy as np  # noqa: E402
import soundfile as sf  # noqa: E402

RATE = 24000
VERSION = 2  # bump when the clip post-processing changes; it is part of the cache key
_pipelines = {}


def pipeline(voice):
    lang = voice[0]  # 'a' American, 'b' British
    if lang not in _pipelines:
        from kokoro import KPipeline
        _pipelines[lang] = KPipeline(lang_code=lang, repo_id='hexgrad/Kokoro-82M')
    return _pipelines[lang]


def apply_lexicon(text, lexicon):
    # Misaki's inline override: [word](/phonemes/) is spoken with those phonemes.
    for word, phonemes in (lexicon or {}).items():
        text = re.sub(rf'(?<![\w\[]){re.escape(word)}(?![\w\]])', f'[{word}](/{phonemes}/)', text)
    return text


def tidy(audio):
    """Trim silence by 10 ms loudness windows (not single peaks) and fade both
    ends. Some voices (bf_emma) end a phrase in ~70 ms of breathy noise that
    reads as a trailing "s" ("Account brandings"); the fade-out removes it."""
    win = RATE // 100
    n = len(audio) // win
    if n < 3:
        return audio
    rms = np.sqrt((audio[: n * win].reshape(n, win) ** 2).mean(axis=1))
    loud = np.flatnonzero(rms > 0.01)
    if not loud.size:
        return audio
    audio = audio[max(0, loud[0] - 2) * win: (loud[-1] + 1) * win].copy()
    fade_in, fade_out = RATE // 200, RATE // 25
    audio[:fade_in] *= np.linspace(0, 1, fade_in)
    audio[-fade_out:] *= np.linspace(1, 0, fade_out)
    return audio


def speak(req, cache):
    text = req['text'].removeprefix('# ').strip()
    voice = req.get('voice', 'bf_emma')
    speed = float(req.get('speed', 1.0))
    lexicon = req.get('lexicon') or {}
    if req.get('title') or req['text'].startswith('# '):
        text = text if text.endswith(('.', '!', '?')) else text + '.'
    if req.get('out'):  # the recorder (lib/narration.mjs) owns the cache layout
        out = req['out']
    else:
        key = hashlib.sha1(json.dumps([VERSION, voice, speed, text, sorted(lexicon.items())]).encode()).hexdigest()[:16]
        out = os.path.join(cache, voice, f'{key}.wav')
    if not os.path.exists(out):
        os.makedirs(os.path.dirname(out), exist_ok=True)
        chunks = [r.audio.numpy() for r in pipeline(voice)(apply_lexicon(text, lexicon), voice=voice, speed=speed) if r.audio is not None]
        audio = np.concatenate(chunks) if chunks else np.zeros(RATE // 4, dtype=np.float32)
        audio = tidy(audio)
        sf.write(out + '.tmp.wav', audio, RATE)
        os.replace(out + '.tmp.wav', out)
    return {'wav': os.path.abspath(out), 'duration': round(sf.info(out).duration, 3)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--cache', required=True)
    args = ap.parse_args()
    # Replies own the real stdout; everything else (spaCy's first-run model
    # download, library chatter, child processes) is pushed to stderr.
    replies = os.fdopen(os.dup(1), 'w')
    os.dup2(2, 1)
    sys.stdout = sys.stderr
    for line in sys.stdin:
        if not line.strip():
            continue
        try:
            res = speak(json.loads(line), args.cache)
        except Exception as e:  # report and keep serving
            res = {'error': f'{type(e).__name__}: {e}'}
        replies.write(json.dumps(res) + '\n')
        replies.flush()


if __name__ == '__main__':
    main()
