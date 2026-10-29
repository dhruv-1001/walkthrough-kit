// Human-paced interactions for recording: a visible cursor that glides to its
// target, a ripple on click, typing at reading speed, smooth scrolling.
// Headless Chrome draws no pointer, so the page gets one (CURSOR_SCRIPT) that
// follows the real mouse events Playwright dispatches.

export const CURSOR_SCRIPT = `(() => {
  if (window.__vcursorInstalled) return;
  window.__vcursorInstalled = true;
  let x = 0, y = 0;
  try { const s = JSON.parse(sessionStorage.getItem('__vcursor_xy') || 'null'); if (s) { x = s[0]; y = s[1]; } } catch {}
  if (!x && !y) { x = innerWidth * 0.62; y = innerHeight * 0.55; }
  const svg = '<svg width="30" height="30" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">' +
    '<path d="M4 2.5 L4 19.5 L8.6 15.2 L11.6 21.6 L14.6 20.2 L11.7 13.9 L18 13.9 Z" fill="#111" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg>';
  const style = document.createElement('style');
  style.textContent = '#__vcursor{position:fixed;left:0;top:0;width:30px;height:30px;z-index:2147483647;pointer-events:none;will-change:transform;filter:drop-shadow(0 1px 2px rgba(0,0,0,.35))}' +
    '.__vripple{position:fixed;width:36px;height:36px;margin:-18px 0 0 -18px;border-radius:50%;z-index:2147483646;pointer-events:none;' +
    'background:rgba(59,130,246,.35);border:2px solid rgba(59,130,246,.85);animation:__vr .55s ease-out forwards}' +
    '@keyframes __vr{from{transform:scale(.3);opacity:1}to{transform:scale(1.6);opacity:0}}';
  const el = document.createElement('div');
  el.id = '__vcursor';
  el.innerHTML = svg;
  const place = () => { el.style.transform = 'translate(' + (x - 4) + 'px,' + (y - 2) + 'px)'; };
  const mount = () => {
    if (!document.documentElement) return;
    if (!style.isConnected) document.documentElement.appendChild(style);
    if (!el.isConnected) document.documentElement.appendChild(el);
    place();
  };
  document.addEventListener('mousemove', (e) => {
    x = e.clientX; y = e.clientY; place();
    try { sessionStorage.setItem('__vcursor_xy', JSON.stringify([x, y])); } catch {}
  }, true);
  document.addEventListener('mousedown', (e) => {
    const r = document.createElement('div');
    r.className = '__vripple';
    r.style.left = e.clientX + 'px'; r.style.top = e.clientY + 'px';
    document.documentElement.appendChild(r);
    setTimeout(() => r.remove(), 600);
  }, true);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
  new MutationObserver(mount).observe(document, { childList: true, subtree: false });
  setInterval(mount, 500);
})();`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export class Actor {
  /** speed scales every pause: 1 = presentation pace, 0 = as fast as possible (unrecorded runs). */
  constructor(page, { speed = 1 } = {}) {
    this.page = page;
    this.speed = speed;
    this.mouse = null;
    // Set by the run: resolves once the caption on screen has been up for its reading time.
    this.settle = async () => {};
  }

  async pause(ms) {
    if (this.speed > 0 && ms > 0) await sleep(ms * this.speed);
  }

  async glide(x, y, ms = 650) {
    if (!this.mouse) {
      const vp = this.page.viewportSize();
      this.mouse = { x: vp.width * 0.62, y: vp.height * 0.55 };
    }
    if (this.speed === 0) {
      await this.page.mouse.move(x, y);
      this.mouse = { x, y };
      return;
    }
    const from = this.mouse;
    const dist = Math.hypot(x - from.x, y - from.y);
    const duration = Math.min(1100, Math.max(280, ms * Math.min(1, dist / 700) + 180)) * this.speed;
    const steps = Math.max(6, Math.round(duration / 16));
    for (let i = 1; i <= steps; i++) {
      const e = ease(i / steps);
      await this.page.mouse.move(from.x + (x - from.x) * e, from.y + (y - from.y) * e);
      await sleep(duration / steps);
    }
    this.mouse = { x, y };
  }

  /** Bring an element into view the way a person would: a smooth scroll, only if needed. */
  async reveal(locator) {
    await locator.waitFor({ state: 'visible', timeout: 30000 });
    const inView = await locator.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return r.top >= 70 && r.bottom <= window.innerHeight - 20;
    });
    if (!inView) {
      await locator.evaluate((el, behavior) => el.scrollIntoView({ block: 'center', behavior }), this.speed ? 'smooth' : 'auto');
      await sleep(this.speed ? 700 : 50);
    }
  }

  async hover(locator, { at } = {}) {
    await this.reveal(locator);
    const box = await locator.boundingBox();
    if (!box) throw new Error(`no box for ${locator}`);
    const px = at ? box.x + at.x : box.x + box.width / 2;
    const py = at ? box.y + at.y : box.y + box.height / 2;
    await this.glide(px, py);
    return box;
  }

  /**
   * Glide to an element and click it. By default the click waits until the
   * caption on screen has been readable for its full time, so a click that
   * changes the page never strands the caption on the next screen. Clicks that
   * are part of filling a form (type, choose, check) pass settle: false.
   */
  async click(locator, { before = 180, after = 450, at, force, settle = true } = {}) {
    await this.hover(locator, { at });
    if (settle) await this.settle();
    await this.pause(before);
    if (at) await locator.click({ position: at, force });
    else await locator.click({ force });
    await this.pause(after);
  }

  /** Click a field and type into it at a readable pace, replacing what was there. */
  async type(locator, text, { delay = 55, after = 350, clear = true } = {}) {
    await this.click(locator, { after: 120, settle: false });
    if (clear) {
      await locator.press('ControlOrMeta+a');
      await locator.press('Backspace');
    }
    await locator.pressSequentially(String(text), { delay: this.speed ? delay * this.speed : 0 });
    await this.pause(after);
  }

  /** Radix/shadcn Select: open the trigger, glide to the option, pick it. */
  async choose(trigger, optionName) {
    await this.click(trigger, { after: 350, settle: false });
    const option = this.page.getByRole('option', { name: optionName, exact: true });
    await this.click(option, { after: 400, settle: false });
  }

  /** A native <select>: glide to it and pick by label (its popup isn't drawn in a headless recording). */
  async select(locator, label) {
    await this.hover(locator);
    await this.pause(250);
    await locator.selectOption({ label });
    await this.pause(400);
  }

  async check(locator) {
    if (!(await locator.isChecked())) await this.click(locator, { before: 120, after: 250, settle: false });
  }

  /** Slow scroll of the window (or of the element under the cursor) by dy pixels. */
  async scroll(dy, { ms = 900 } = {}) {
    if (this.speed === 0) {
      await this.page.mouse.wheel(0, dy);
      return;
    }
    const steps = Math.max(8, Math.round((ms * this.speed) / 25));
    for (let i = 0; i < steps; i++) {
      await this.page.mouse.wheel(0, dy / steps);
      await sleep((ms * this.speed) / steps);
    }
    await sleep(250);
  }

  async scrollTop() {
    await this.page.evaluate((behavior) => window.scrollTo({ top: 0, behavior }), this.speed ? 'smooth' : 'auto');
    await this.pause(700);
  }
}
