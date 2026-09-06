import { writeFile } from "node:fs/promises";

const cdpOrigin = process.env.GOGH_CDP_URL ?? "http://127.0.0.1:9227";
const targetOrigin = process.env.GOGH_V2_URL ?? "http://127.0.0.1:8891";
for (const value of [cdpOrigin, targetOrigin]) {
  const url = new URL(value);
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1") {
    throw new TypeError("Art Broker V2 capture accepts localhost only");
  }
}
const targets = await fetch(`${cdpOrigin}/json/list`).then((response) => response.json());
const socketUrl = targets.find((target) => target.type === "page")?.webSocketDebuggerUrl;
if (!socketUrl) throw new Error("No local Chrome DevTools page is available");
const socket = new WebSocket(socketUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});
let nextId = 1;
const pending = new Map();
const events = new Map();
socket.addEventListener("message", ({ data }) => {
  const message = JSON.parse(data);
  if (message.id) {
    const operation = pending.get(message.id); pending.delete(message.id);
    if (message.error) operation?.reject(new Error(message.error.message));
    else operation?.resolve(message.result);
    return;
  }
  const listeners = events.get(message.method) ?? [];
  events.delete(message.method);
  listeners.forEach((resolve) => resolve(message.params));
});
function send(method, params = {}) {
  const id = nextId++;
  return new Promise((resolve, reject) => { pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params })); });
}
function once(method) {
  return new Promise((resolve) => { const listeners = events.get(method) ?? [];
    listeners.push(resolve); events.set(method, listeners); });
}
await send("Page.enable"); await send("Runtime.enable");
const captures = [
  { name: "desktop-wide", width: 1600, height: 1200, tab: "talk" },
  { name: "laptop-strategy", width: 1280, height: 900, tab: "strategy", scroll: "[data-v2-panel='strategy']" },
  { name: "tablet-fund", width: 820, height: 1180, tab: "fund", scroll: "[data-v2-panel='fund']" },
  { name: "iphone-talk", width: 390, height: 844, tab: "talk", scroll: "[data-v2-panel='talk']" },
  { name: "iphone-gallery", width: 375, height: 812, tab: "collection", scroll: "[data-v2-panel='collection']" },
  { name: "desktop-confirmation", width: 1440, height: 1000, tab: "talk",
    evaluate: `(async () => { document.querySelector('#punk-prompt').value =
      'Find free pixel art with an X and website. Three max today. Gas under .0005 ETH. Keep .01 ETH in reserve.';
      document.querySelector('[data-chat-form]').requestSubmit();
      await new Promise((resolve) => setTimeout(resolve, 500)); })()` },
  { name: "desktop-disconnected", width: 1440, height: 900, preview: false },
  { name: "desktop-one-punk", width: 1440, height: 900, tab: "talk",
    evaluate: `(() => { const slots = [...document.querySelectorAll('.roster-slot')];
      slots.slice(1).forEach((slot) => slot.remove());
      document.querySelector('[data-roster-count]').textContent = '1'; })()` },
  { name: "laptop-many-punks", width: 1280, height: 900, tab: "talk",
    evaluate: `(() => { const roster = document.querySelector('[data-punk-roster]');
      const seeds = [...roster.children]; for (let i = 0; i < 9; i += 1) {
        const clone = seeds[i % seeds.length].cloneNode(true); clone.removeAttribute('aria-selected');
        clone.querySelector('b').textContent = '#' + (900 + i); roster.append(clone); }
      document.querySelector('[data-roster-count]').textContent = '12'; })()` },
  { name: "iphone-long-conversation", width: 390, height: 844, tab: "talk",
    evaluate: `(() => { const feed = document.querySelector('[data-conversation]');
      for (let i = 0; i < 12; i += 1) { const clone = feed.firstElementChild.cloneNode(true);
        clone.querySelector('p').textContent = 'Screened discovery ' + (i + 1) + ': detailed policy explanation stays inside this scroll region without shifting the composer.';
        feed.append(clone); } feed.scrollTop = feed.scrollHeight; })()`, scroll: "[data-conversation]" },
  { name: "admin-wide", width: 1440, height: 1000, route: "/broker/v2/admin/" },
];
const report = [];
for (const capture of captures) {
  await send("Emulation.setDeviceMetricsOverride", { width: capture.width, height: capture.height,
    deviceScaleFactor: 1, mobile: capture.width <= 430 });
  const loaded = once("Page.loadEventFired");
  const route = capture.route ?? `/broker/v2/?${new URLSearchParams({
    ...(capture.preview === false ? {} : { preview: "1" }), ...(capture.tab ? { tab: capture.tab } : {}),
  })}`;
  await send("Page.navigate", { url: `${targetOrigin}${route}` });
  await loaded;
  await new Promise((resolve) => setTimeout(resolve, capture.route ? 500 : 250));
  if (capture.evaluate) {
    await send("Runtime.evaluate", { expression: capture.evaluate, awaitPromise: true });
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (capture.scroll) {
    await send("Runtime.evaluate", { expression: `document.querySelector(${JSON.stringify(capture.scroll)})?.scrollIntoView({block:'start', behavior:'instant'})` });
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const metrics = await send("Runtime.evaluate", { returnByValue: true, expression: `(() => {
    const smallTargets = [...document.querySelectorAll('button:not([hidden]), a[href]')]
      .map((node) => ({ text: node.textContent.trim().slice(0, 30), rect: node.getBoundingClientRect() }))
      .filter(({ rect }) => rect.width > 0 && rect.height > 0 && (rect.width < 40 || rect.height < 40))
      .map(({ text, rect }) => ({ text, width: Math.round(rect.width), height: Math.round(rect.height) }));
    return { viewportWidth: innerWidth, viewportHeight: innerHeight,
      documentWidth: document.documentElement.scrollWidth,
      horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
      selectedTab: document.querySelector('[data-v2-tab][aria-selected="true"]')?.dataset.v2Tab,
      visiblePanel: document.querySelector('[data-v2-panel]:not([hidden])')?.dataset.v2Panel,
      rosterCount: document.querySelectorAll('.roster-slot').length,
      touchTargetsBelow40: smallTargets, uncaughtMarker: document.body.textContent.includes('undefined') };
  })()` });
  const screenshot = await send("Page.captureScreenshot", { format: "png", fromSurface: true });
  const path = `/private/tmp/gogh-art-broker-v2-${capture.name}.png`;
  await writeFile(path, Buffer.from(screenshot.data, "base64"));
  report.push({ name: capture.name, path, ...metrics.result.value });
}
socket.close();
console.log(JSON.stringify(report, null, 2));
