"""Hear-check narrated videos: transcribe them with Whisper and compare against
the .srt next to each one, cue by cue (by time). Flags words the voice dropped,
added or garbled, and lines that start late or run into the next caption.

  .venv/bin/python lib/check_voice.py examples/demo/out/latest/*.mp4
"""
import argparse
import difflib
import json
import os
import re
import subprocess
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
from voice_sample import parse_srt  # noqa: E402


# Spelling Whisper may pick that says nothing about what was spoken.
SAME = {'colour': 'color', 'colours': 'colors', 'signup': 'sign-up', 'sign up': 'sign-up'}


def norm(text):
    text = text.lower().replace('’', "'")
    for a, b in SAME.items():
        text = re.sub(rf'\b{a.replace(" ", r"\s+")}\b', b, text)
    return re.findall(r"[a-z0-9'-]+", text)


def check_clips(model, args):
    items = json.load(open(args.clips, encoding='utf-8'))
    rows, bad = [], []
    for it in items:
        pcm = subprocess.run(['ffmpeg', '-v', 'error', '-i', it['wav'], '-ac', '1', '-ar', '16000', '-f', 'f32le', '-'],
                             check=True, capture_output=True).stdout
        segs, _ = model.transcribe(np.frombuffer(pcm, dtype=np.float32), language='en', beam_size=5)
        heard = ' '.join(s.text.strip() for s in segs)
        ratio = difflib.SequenceMatcher(None, norm(heard), norm(it['text'])).ratio()
        rows.append(f"{ratio:.2f}\t{it['text']}\t{heard}")
        if ratio < 0.85:
            bad.append(f"  {ratio:.2f}  said: {it['text']}\n        heard: {heard}")
    if args.report:
        open(args.report, 'w', encoding='utf-8').write('ratio\tline\theard\n' + '\n'.join(rows) + '\n')
    print(f'{len(items)} clips checked, {len(bad)} to listen to' + (':\n' + '\n'.join(bad) if bad else ''))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('videos', nargs='*')
    ap.add_argument('--model', default='small.en')
    ap.add_argument('--clips', help='JSON [{wav, text}]: check single narration clips instead of videos')
    ap.add_argument('--report', help='with --clips: write the full table here')
    args = ap.parse_args()
    from faster_whisper import WhisperModel
    model = WhisperModel(args.model, device='cpu', compute_type='int8', cpu_threads=8)
    if args.clips:
        return check_clips(model, args)
    bad = 0
    for video in args.videos:
        cues = parse_srt(os.path.splitext(video)[0] + '.srt')
        pcm = subprocess.run(['ffmpeg', '-v', 'error', '-i', video, '-vn', '-ac', '1', '-ar', '16000', '-f', 'f32le', '-'],
                             check=True, capture_output=True).stdout
        segments, _ = model.transcribe(np.frombuffer(pcm, dtype=np.float32), language='en', word_timestamps=True, beam_size=5)
        words = [w for s in segments for w in s.words]
        print(f'== {os.path.basename(video)}')
        for i, c in enumerate(cues):
            heard = [w for w in words if c['start'] - 0.05 <= (w.start + w.end) / 2 < c['end']]
            said, want = norm(' '.join(w.word for w in heard)), norm(c['text'])
            # Whisper writes numbers as digits and acronyms its own way; compare loosely.
            ratio = difflib.SequenceMatcher(None, said, want).ratio()
            late = heard[0].start - c['start'] if heard else None
            overrun = heard[-1].end - c['end'] if heard else None
            flag = ratio < 0.9 or late is None or late > 1.0 or (overrun or 0) > 0.05
            bad += flag
            print(f"  {'!!' if flag else 'ok'} {ratio:.2f} start+{(late or 0):.2f}s  heard: {' '.join(w.word.strip() for w in heard)}")
            if ratio < 0.9:
                print(f'       want: {c["text"]}')
    print(f'{bad} cue(s) flagged')


if __name__ == '__main__':
    main()
