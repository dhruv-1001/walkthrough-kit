// Screen recorder: Chrome's own screencast frames, re-timed to a constant
// frame rate and encoded by ffmpeg. Playwright's recordVideo is not used
// because it encodes VP8 at ~1 Mbit/s, which smears UI text at 1080p.
//
// The screencast only emits a frame when the page repaints, so a pump repeats
// the latest frame until the output has as many frames as wall-clock time
// says it should. pause()/resume() cut dead time (server work, page loads)
// out of the timeline: nothing is written while paused, and now() — the
// clock the captions use — stands still.
import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';

export class ScreenRecorder {
  constructor(page, { out, fps = 30, width = 1920, height = 960, quality = 92 }) {
    Object.assign(this, { page, out, fps, width, height, quality });
    this.last = null;
    this.written = 0;
    this.pausedAt = null;
  }

  async start() {
    this.ffmpeg = spawn('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'image2pipe', '-framerate', String(this.fps), '-c:v', 'mjpeg', '-i', '-',
      // Frames should already be width x height; scale only guards a stray size.
      '-vf', `scale=${this.width}:${this.height}:flags=lanczos,format=yuv420p`,
      // Near-lossless intermediate: the captioned final is encoded from this.
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '10', '-r', String(this.fps),
      this.out,
    ], { stdio: ['pipe', 'inherit', 'inherit'] });
    this.ffmpegDone = new Promise((resolve, reject) => {
      this.ffmpeg.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code} for ${this.out}`))));
    });
    this.ffmpeg.stdin.on('error', () => {});

    this.cdp = await this.page.context().newCDPSession(this.page);
    let firstFrame;
    const gotFirst = new Promise((resolve) => (firstFrame = resolve));
    this.cdp.on('Page.screencastFrame', ({ data, sessionId }) => {
      this.last = Buffer.from(data, 'base64');
      firstFrame();
      this.cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
    });
    await this.cdp.send('Page.startScreencast', {
      format: 'jpeg', quality: this.quality, maxWidth: this.width, maxHeight: this.height, everyNthFrame: 1,
    });
    // A static page sends one frame and then nothing; nudge a repaint so the
    // first frame arrives even when nothing on screen is moving.
    await this.page.evaluate(() => {
      const el = document.getElementById('__vcursor');
      if (el) el.style.opacity = el.style.opacity === '0.999' ? '1' : '0.999';
    }).catch(() => {});
    await Promise.race([gotFirst, new Promise((r) => setTimeout(r, 3000))]);
    if (!this.last) throw new Error('screencast produced no frame in 3s');

    this.t0 = performance.now();
    this.timer = setInterval(() => this.pump(), 1000 / this.fps / 2);
  }

  /** Seconds of video recorded so far (paused time excluded). */
  now() {
    const at = this.pausedAt ?? performance.now();
    return (at - this.t0) / 1000;
  }

  pump() {
    if (this.pausedAt !== null || !this.last) return;
    const due = Math.floor(this.now() * this.fps);
    while (this.written < due) {
      this.ffmpeg.stdin.write(this.last);
      this.written++;
    }
  }

  pause() {
    if (this.pausedAt !== null) return;
    this.pump();
    this.pausedAt = performance.now();
  }

  resume() {
    if (this.pausedAt === null) return;
    this.t0 += performance.now() - this.pausedAt;
    this.pausedAt = null;
  }

  /** Run `fn` with the recording paused, then hold the result on screen briefly. */
  async cut(fn) {
    this.pause();
    try {
      return await fn();
    } finally {
      // Let the page paint the finished state before frames flow again, so the
      // cut lands on the result, not on a half-rendered transition.
      await new Promise((r) => setTimeout(r, 400));
      this.resume();
    }
  }

  async stop() {
    this.resume();
    this.pump();
    clearInterval(this.timer);
    await this.cdp.send('Page.stopScreencast').catch(() => {});
    await this.cdp.detach().catch(() => {});
    this.ffmpeg.stdin.end();
    await this.ffmpegDone;
    return this.written / this.fps;
  }
}
