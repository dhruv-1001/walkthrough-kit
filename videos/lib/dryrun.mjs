// A stand-in for Playwright's page and the Actor, so a scene can be "run"
// without a browser or a stack: --voice-prep runs every recorded scene this
// way only to collect the lines it will say, then voices them up front.
//
// Every property and call returns the stub again; the few Playwright calls a
// scene reads a value from answer with something empty (count 0, '' text, a
// box at the origin). Scenes keep their captions data-driven (never built from
// what the page shows), so the dry run sees exactly the lines a real run says.
const ASYNC_VALUES = {
  count: 0, isVisible: false, isChecked: false, isEnabled: true, isDisabled: false,
  inputValue: '', innerText: '', textContent: '', getAttribute: null, allInnerTexts: [], allTextContents: [],
  boundingBox: { x: 0, y: 0, width: 100, height: 40 }, all: [], evaluate: undefined,
};
const SYNC_VALUES = { url: 'about:blank', viewportSize: { width: 1536, height: 768 } };

export function stub(name = 'page') {
  return new Proxy(function () {}, {
    get(_, prop) {
      if (prop === 'then') return undefined; // `await stub` resolves to the stub itself
      if (prop === Symbol.toPrimitive) return () => '';
      if (prop === Symbol.iterator) return [][Symbol.iterator].bind([]);
      return stub(prop);
    },
    apply() {
      if (name in SYNC_VALUES) return SYNC_VALUES[name];
      if (name in ASYNC_VALUES) return Promise.resolve(ASYNC_VALUES[name]);
      return stub(name);
    },
  });
}

/** An Actor that does nothing (every method resolves at once). */
export function stubActor() {
  return new Proxy({ speed: 0, settle: async () => {} }, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (prop === 'then') return undefined;
      return async () => stub('box');
    },
  });
}

/** A recorder whose cuts skip their work (it waits on the stack). */
export const stubRecorder = { cut: async () => {}, pause() {}, resume() {}, now: () => 0, mark() {} };
