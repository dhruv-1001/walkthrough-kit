"""Voice samples: narrate an already-recorded video in several Kokoro voices.

Each caption cue is spoken as it appears. Where a line takes longer to say than
its cue lasts, the cue's last frame is held until the voice finishes (the real
recorder waits before the next action instead). Writes <name>.<voice>.mp4 + .srt.

  .venv/bin/python lib/voice_sample.py examples/demo/out/latest/01-getting-started.mp4 \
      --voices bf_emma,bm_george,af_heart,am_michael --out /tmp/voice-samples
"""
import argparse
import os
import re
import subprocess
import sys

import numpy as np
import soundfile as sf

sys.path.insert(0, os.path.dirname(__file__))
import narrate  # noqa: E402

LEAD = 0.15  # voice starts this long after its caption appears
TAIL = 0.45  # silence after a line before the next caption may appear


def parse_srt(path):
    cues = []
    for block in re.split(r'\n\s*\n', open(path, encoding='utf-8').read().strip()):
        lines = block.strip().splitlines()
        t = re.findall(r'(\d+):(\d+):(\d+),(\d+)', lines[1])
        secs = [int(h) * 3600 + int(m) * 60 + int(s) + int(ms) / 1000 for h, m, s, ms in t]
        cues.append({'start': secs[0], 'end': secs[1], 'text': ' '.join(lines[2:])})
    return cues


def srt_time(s):
    ms = round(s * 1000)
    return f'{ms // 3600000:02}:{ms // 60000 % 60:02}:{ms // 1000 % 60:02},{ms % 1000:03}'


def build(video, cues, voice, out_dir, cache):
    duration = float(subprocess.check_output(
        ['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', video]).strip())
    clips = []
    for i, c in enumerate(cues):
        # The first cue is the video's title card ("# Title" in the scene).
        res = narrate.speak({'text': ('# ' if i == 0 else '') + c['text'], 'voice': voice}, cache)
        audio, rate = sf.read(res['wav'], dtype='float32')
        clips.append(audio)

    segs, t = [], 0.0
    for i, c in enumerate(cues):
        end = cues[i + 1]['start'] if i + 1 < len(cues) else duration
        length = end - c['start']
        pad = max(0.0, LEAD + len(clips[i]) / rate + TAIL - length)
        segs.append({'from': c['start'], 'to': end, 'pad': pad, 'at': t})
        t += length + pad
    total = t

    track = np.zeros(int(total * rate) + rate, dtype=np.float32)
    for seg, clip in zip(segs, clips):
        i0 = int((seg['at'] + LEAD) * rate)
        track[i0:i0 + len(clip)] += clip
    name = os.path.splitext(os.path.basename(video))[0]
    wav = os.path.join(out_dir, f'{name}.{voice}.wav')
    sf.write(wav, track[:int(total * rate)], rate)

    # Hold a frame from before the caption starts fading out (\fad 150 ms), not
    # the cue's last frame, so the held caption stays fully visible.
    parts = []
    for s in segs:
        if s['pad'] > 0:
            hold = max(s['from'], s['to'] - 0.25)
            parts.append((s['from'], hold, s['pad']))
            parts.append((hold, s['to'], 0))
        else:
            parts.append((s['from'], s['to'], 0))
    chains = [f"[0:v]trim=start={a:.3f}:end={b:.3f},setpts=PTS-STARTPTS"
              + (f",tpad=stop_mode=clone:stop_duration={pad:.3f}" if pad > 0 else '') + f'[v{i}]'
              for i, (a, b, pad) in enumerate(parts)]
    graph = ';'.join(chains) + ';' + ''.join(f'[v{i}]' for i in range(len(parts))) + f'concat=n={len(parts)}:v=1:a=0[v]'
    out = os.path.join(out_dir, f'{name}.{voice}.mp4')
    subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', video, '-i', wav,
                    '-filter_complex', graph + ';[1:a]loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000[a]',
                    '-map', '[v]', '-map', '[a]',
                    '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-pix_fmt', 'yuv420p', '-r', '30',
                    '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', out], check=True)
    os.remove(wav)
    with open(os.path.join(out_dir, f'{name}.{voice}.srt'), 'w', encoding='utf-8') as f:
        for i, (c, s) in enumerate(zip(cues, segs)):
            end = segs[i + 1]['at'] if i + 1 < len(segs) else total
            f.write(f"{i + 1}\n{srt_time(s['at'])} --> {srt_time(end)}\n{c['text']}\n\n")
    held = sum(s['pad'] for s in segs)
    return out, total, held


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('video')
    ap.add_argument('--voices', default='bf_emma,bm_george,af_heart,am_michael')
    ap.add_argument('--out', default='out/voice-samples')
    ap.add_argument('--cache', default='out/.voice-cache')
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)
    cues = parse_srt(os.path.splitext(args.video)[0] + '.srt')
    for voice in args.voices.split(','):
        out, total, held = build(args.video, cues, voice, args.out, args.cache)
        print(f'{voice}: {out} ({total:.1f}s, {held:.1f}s of held frames)', flush=True)


if __name__ == '__main__':
    main()
