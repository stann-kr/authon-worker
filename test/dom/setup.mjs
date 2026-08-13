import { JSDOM } from "jsdom";

const dom = new JSDOM(
  "<!doctype html><html><body><main id=\"main-content\"></main></body></html>",
  { url: "http://localhost" },
);

const window = dom.window;
const globals = {
  window,
  document: window.document,
  navigator: window.navigator,
  HTMLElement: window.HTMLElement,
  HTMLButtonElement: window.HTMLButtonElement,
  Node: window.Node,
  Event: window.Event,
  KeyboardEvent: window.KeyboardEvent,
  MouseEvent: window.MouseEvent,
  MutationObserver: window.MutationObserver,
  getComputedStyle: window.getComputedStyle.bind(window),
  requestAnimationFrame: (callback) => window.setTimeout(callback, 0),
  cancelAnimationFrame: (id) => window.clearTimeout(id),
  IS_REACT_ACT_ENVIRONMENT: true,
};

for (const [key, value] of Object.entries(globals)) {
  Object.defineProperty(globalThis, key, {
    configurable: true,
    writable: true,
    value,
  });
}

window.matchMedia = (query) => ({
  matches: query === "(prefers-reduced-motion: reduce)",
  media: query,
  onchange: null,
  addListener() {},
  removeListener() {},
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent() {
    return false;
  },
});
