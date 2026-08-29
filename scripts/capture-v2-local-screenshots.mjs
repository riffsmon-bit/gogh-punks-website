import { writeFile } from "node:fs/promises";

const cdpOrigin = process.env.GOGH_CDP_URL ?? "http://127.0.0.1:9225";
const targetOrigin = process.env.GOGH_V2_DEMO_URL ?? "http://127.0.0.1:8888";
if (new URL(cdpOrigin).hostname !== "127.0.0.1"
  || new URL(targetOrigin).hostname !== "127.0.0.1") {
  throw new TypeError("V2 capture accepts only localhost endpoints");
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
    const operation = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) operation?.reject(new Error(message.error.message));
    else operation?.resolve(message.result);
    return;
  }
  const listeners = events.get(message.method) ?? [];
  events.delete(message.method);
  for (const resolve of listeners) resolve(message.params);
});

function send(method, params = {}) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

function once(method) {
  return new Promise((resolve) => {
    const listeners = events.get(method) ?? [];
    listeners.push(resolve);
    events.set(method, listeners);
  });
}

await send("Page.enable");
await send("Runtime.enable");

const captures = [
  { name: "control-center-desktop", width: 1440, height: 1200, tab: "overview" },
  { name: "control-center-iphone-375", width: 375, height: 1000, tab: "overview" },
  { name: "control-center-mobile", width: 390, height: 1000, tab: "mint" },
  { name: "directed-mint", width: 1440, height: 1300, tab: "mint",
    focus: "[data-directed-review]" },
  { name: "paid-mint-settings", width: 1440, height: 1000, tab: "mint",
    focus: ".paid-settings" },
  { name: "portfolio-assets", width: 1440, height: 2100, tab: "assets" },
  { name: "agent-activity", width: 430, height: 1600, tab: "activity" },
];
const report = [];
for (const capture of captures) {
  await send("Emulation.setDeviceMetricsOverride", { width: capture.width,
    height: capture.height, deviceScaleFactor: 1, mobile: capture.width <= 430 });
  const loaded = once("Page.loadEventFired");
  await send("Page.navigate", { url: `${targetOrigin}/broker/punk/93?demo=1&tab=${capture.tab}` });
  await loaded;
  await new Promise((resolve) => setTimeout(resolve, 250));
  if (capture.tab === "mint") {
    await send("Runtime.evaluate", { expression: `(() => {
      document.querySelector('[data-paid-enabled]').checked = true;
      document.querySelector('[data-paid-confirm]').checked = true;
      document.querySelector('[data-paid-save]').click();
      document.querySelector('[data-directed-simulate]').click();
    })()` });
  }
  if (capture.focus) {
    await send("Runtime.evaluate", { expression: `document.querySelector(${JSON.stringify(
      capture.focus)})?.scrollIntoView({block:'start'})` });
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const evaluated = await send("Runtime.evaluate", { returnByValue: true, expression: `(() => {
    const navigation = performance.getEntriesByType('navigation')[0];
    return {
      viewportWidth: innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
      domContentLoadedMs: Math.round(navigation?.domContentLoadedEventEnd ?? 0),
      loadMs: Math.round(navigation?.loadEventEnd ?? 0),
      selectedTab: document.querySelector('[data-control-tab][aria-selected="true"]')?.dataset.controlTab,
      localSimulation: document.querySelector('[data-local-demo]')?.hidden === false,
      timings: Object.fromEntries([...document.querySelectorAll('[data-debug-metrics] > div')]
        .map((row) => [row.querySelector('dt')?.textContent, row.querySelector('dd')?.textContent]))
    };
  })()` });
  let clip;
  if (capture.focus) {
    const bounds = await send("Runtime.evaluate", { returnByValue: true,
      expression: `(() => { const rect = document.querySelector(${JSON.stringify(
        capture.focus)}).getBoundingClientRect(); return { x: Math.max(0, rect.left + scrollX - 12),
        y: Math.max(0, rect.top + scrollY - 12), width: Math.min(document.documentElement.scrollWidth,
        rect.width + 24), height: rect.height + 24, scale: 1 }; })()` });
    clip = bounds.result.value;
  }
  const screenshot = await send("Page.captureScreenshot", { format: "png",
    fromSurface: true, captureBeyondViewport: Boolean(clip), ...(clip ? { clip } : {}) });
  const path = `/private/tmp/gogh-v2-${capture.name}.png`;
  await writeFile(path, Buffer.from(screenshot.data, "base64"));
  report.push({ name: capture.name, path, ...evaluated.result.value });
}
socket.close();
console.log(JSON.stringify(report, null, 2));
