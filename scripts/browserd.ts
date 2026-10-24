// The shared browser. Owns the Chrome profile (.profile), exposes CDP for jobs, and streams the
// active tab to the dashboard over a WebSocket (CDP screencast), relaying your mouse and keys back.
//   npx tsx scripts/browserd.ts        BROWSER_HEADED=1 to also show the real window
import { execFileSync } from "node:child_process";
import { chromium, type CDPSession, type Page } from "playwright";
import { type WebSocket, WebSocketServer } from "ws";
import { VIEW_PORT } from "../agent/lib/browserd";
import { PASSKEY_OFF, suppressPasskeys } from "../collector/session";

const PROFILE_DIR = process.env.BROWSER_PROFILE ?? ".profile";
const CDP_PORT = Number(process.env.BROWSERD_CDP_PORT ?? 9333);
const VIEWPORT = { width: 1280, height: 860 };
const ALLOWED_ORIGINS = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

// Headless Chrome advertises itself as "HeadlessChrome", which X rejects. Present as the installed Chrome.
function chromeUserAgent() {
  let major = "140";
  try {
    major = execFileSync("plutil", ["-extract", "CFBundleShortVersionString", "raw", "/Applications/Google Chrome.app/Contents/Info.plist"])
      .toString()
      .split(".")[0];
  } catch {}
  return `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`;
}

const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
  headless: !process.env.BROWSER_HEADED,
  channel: "chrome",
  viewport: VIEWPORT,
  userAgent: chromeUserAgent(),
  args: [`--remote-debugging-port=${CDP_PORT}`, "--disable-blink-features=AutomationControlled"],
});
// Reject WebAuthn on every page AND popup, before any page script runs. Playwright pauses each new
// document to inject this, so OAuth popups (e.g. "Continue with Google") get it too — no race.
// Passkey prompts can't be answered in an automated browser, so sites fall back to password.
await ctx.addInitScript({ content: PASSKEY_OFF });
console.log(`[browserd] chrome up, CDP on ${CDP_PORT}, viewer on ${VIEW_PORT}`);

// ---- active tab + screencast ----

const viewers = new Set<WebSocket>();
let active: Page | null = null;
let cast: CDPSession | null = null;

const send = (msg: object) => {
  const data = JSON.stringify(msg);
  for (const ws of viewers) ws.readyState === ws.OPEN && ws.send(data);
};

async function tabs() {
  return Promise.all(
    ctx.pages().map(async (p, index) => ({ index, url: p.url(), title: await p.title().catch(() => ""), active: p === active })),
  );
}
const announceTabs = async () => send({ type: "tabs", tabs: await tabs() });

async function stopCast() {
  const old = cast;
  cast = null;
  await old?.send("Page.stopScreencast").catch(() => {});
  await old?.detach().catch(() => {});
}

async function startCast() {
  await stopCast();
  if (!active || viewers.size === 0) return;
  const session = await ctx.newCDPSession(active);
  cast = session;
  session.on("Page.screencastFrame", ({ data, metadata, sessionId }) => {
    send({ type: "frame", data, width: metadata.deviceWidth, height: metadata.deviceHeight });
    session.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
  });
  await session.send("Page.startScreencast", { format: "jpeg", quality: 70, maxWidth: VIEWPORT.width, maxHeight: VIEWPORT.height });
}

async function activate(page: Page | null) {
  active = page;
  await startCast();
  await announceTabs();
}

function watch(page: Page) {
  // Passkey prompts are native dialogs an automated browser can't answer; reject WebAuthn so
  // login pages fall back to password. Registered before navigation, persists across it.
  suppressPasskeys(ctx, page);
  page.on("framenavigated", (f) => f === page.mainFrame() && announceTabs());
  page.on("close", () => {
    if (page === active) activate(ctx.pages().at(-1) ?? null);
    else announceTabs();
  });
}

for (const p of ctx.pages()) watch(p);
// Whatever opened most recently (a login page, a job's scrape) is what you see.
ctx.on("page", (p) => {
  watch(p);
  activate(p);
});
await activate(ctx.pages().at(-1) ?? (await ctx.newPage()));

// ---- viewer protocol ----

type Input =
  | { type: "mouse"; action: "move" | "down" | "up"; x: number; y: number; button?: "left" | "right" | "middle" }
  | { type: "wheel"; x: number; y: number; dx: number; dy: number }
  | { type: "key"; key: string; modifiers?: string[] }
  | { type: "text"; text: string }
  | { type: "goto"; url: string }
  | { type: "back" }
  | { type: "reload" }
  | { type: "tab"; index: number }
  | { type: "newTab" };

async function handle(msg: Input) {
  const page = active;
  if (msg.type === "tab") return activate(ctx.pages()[msg.index] ?? active);
  if (msg.type === "newTab") return (await ctx.newPage()).goto("about:blank");
  if (!page) return;
  // Coordinates arrive as 0..1 of the frame so the viewer can render at any size.
  const at = (x: number, y: number) => [x * VIEWPORT.width, y * VIEWPORT.height] as const;
  switch (msg.type) {
    case "mouse": {
      const [x, y] = at(msg.x, msg.y);
      await page.mouse.move(x, y);
      if (msg.action === "down") await page.mouse.down({ button: msg.button ?? "left" });
      if (msg.action === "up") await page.mouse.up({ button: msg.button ?? "left" });
      return;
    }
    case "wheel": {
      await page.mouse.move(...at(msg.x, msg.y));
      return page.mouse.wheel(msg.dx, msg.dy);
    }
    case "key":
      return page.keyboard.press([...(msg.modifiers ?? []), msg.key].join("+"));
    case "text":
      return page.keyboard.insertText(msg.text);
    case "goto":
      return page.goto(/^https?:\/\//.test(msg.url) ? msg.url : `https://${msg.url}`).then(() => {});
    case "back":
      return page.goBack().then(() => {});
    case "reload":
      return page.reload().then(() => {});
  }
}

const wss = new WebSocketServer({ host: "127.0.0.1", port: VIEW_PORT });
wss.on("connection", async (ws, req) => {
  // Only the local dashboard may watch or drive the browser: it holds your sessions.
  if (!ALLOWED_ORIGINS.test(req.headers.origin ?? "")) return ws.close(1008, "origin not allowed");
  viewers.add(ws);
  ws.on("message", (raw) => {
    try {
      handle(JSON.parse(String(raw))).catch((err) => console.error("[browserd] input failed", err.message));
    } catch {}
  });
  ws.on("close", () => {
    viewers.delete(ws);
    if (viewers.size === 0) stopCast();
  });
  await announceTabs();
  if (viewers.size === 1) await startCast();
});

const shutdown = async () => {
  wss.close();
  await ctx.close().catch(() => {});
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
ctx.on("close", () => process.exit(0));
