// bridgr desktop: an Electron shell that runs and supervises the local-first stack on this Mac.
//
// bridgr is local by design — a Next server with the eve agent inside it, a Playwright browser holding
// your logged-in sessions, background scrape jobs, and a SQLite file. The desktop app is what keeps
// all of that alive: it attaches to (or starts) the server, gives it a native window, lives in the
// menu bar when the window is closed, and owns the schedule clock — `eve dev` never fires crons on its
// own, so the scan / push / digest schedules run because this process fires them.

import { type ChildProcess, execSync, spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { app, BrowserWindow, globalShortcut, Menu, nativeImage, nativeTheme, shell, Tray } from "electron";

const PORT = Number(process.env.BRIDGR_PORT ?? 3000);
const ORIGIN = `http://localhost:${PORT}`;
const BOOT_TIMEOUT_MS = 4 * 60_000; // first `next dev` + eve dev cold start can be slow
const HOTKEY = "CommandOrControl+Shift+Space";

// ── Where the stack lives ────────────────────────────────────────────────────────────────────────

/** The bridgr checkout to run: BRIDGR_HOME, else the path baked in at package time, else cwd (dev). */
function bridgrHome(): string {
  if (process.env.BRIDGR_HOME) return process.env.BRIDGR_HOME;
  const baked = join(process.resourcesPath ?? "", "bridgr.json");
  if (app.isPackaged && existsSync(baked)) return JSON.parse(readFileSync(baked, "utf8")).home;
  return process.cwd();
}
const HOME = bridgrHome();
const ASSETS = app.isPackaged ? process.resourcesPath : join(HOME, "desktop/build");
const LOG_DIR = join(HOME, ".puentes/logs");

function log(message: string) {
  const line = `[${new Date().toISOString()}] ${message}`;
  console.log(line);
  try {
    mkdirSync(LOG_DIR, { recursive: true });
    appendFileSync(join(LOG_DIR, "desktop.log"), `${line}\n`);
  } catch {}
}

/** Apps opened from Finder get a bare PATH; borrow the login shell's so `npx`/`node` resolve. */
function adoptLoginShellPath() {
  try {
    const shellPath = execSync(`${process.env.SHELL || "/bin/zsh"} -ilc 'printf "\\n__PATH__%s" "$PATH"'`, { encoding: "utf8", timeout: 8000 });
    const found = /__PATH__(.*)$/m.exec(shellPath)?.[1];
    if (found) process.env.PATH = [...new Set([...found.split(":"), ...(process.env.PATH ?? "").split(":")])].join(":");
  } catch (err) {
    log(`couldn't read login shell PATH: ${(err as Error).message}`);
  }
}

// ── The server ───────────────────────────────────────────────────────────────────────────────────

let server: ChildProcess | null = null;

async function healthy() {
  try {
    return (await fetch(`${ORIGIN}/eve/v1/health`, { signal: AbortSignal.timeout(3000) })).ok;
  } catch {
    return false;
  }
}

/** Attach to a running bridgr server, or start `next dev` (which boots the eve agent beside it). */
async function ensureServer() {
  if (await healthy()) {
    log(`attached to running server at ${ORIGIN}`);
    return;
  }
  log(`starting server in ${HOME}`);
  mkdirSync(LOG_DIR, { recursive: true });
  const out = openSync(join(LOG_DIR, "desktop-server.log"), "a");
  server = spawn("npx", ["next", "dev", "apps/web", "-p", String(PORT)], { cwd: HOME, env: process.env, stdio: ["ignore", out, out], detached: true });
  server.on("exit", (code) => {
    log(`server exited (${code})`);
    server = null;
  });
  const started = Date.now();
  while (Date.now() - started < BOOT_TIMEOUT_MS) {
    if (await healthy()) {
      log(`server up after ${Math.round((Date.now() - started) / 1000)}s`);
      return;
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error("bridgr's server didn't come up. See .puentes/logs/desktop-server.log.");
}

function stopServer() {
  if (server?.pid) {
    try {
      process.kill(-server.pid, "SIGTERM"); // the whole group: next + the eve dev server it spawned
    } catch {}
  }
}

// ── Schedules ────────────────────────────────────────────────────────────────────────────────────

type Schedule = { id: string; cron: string };
let schedulesPaused = false;

/** Read each schedule's cron straight from agent/schedules/*.ts — the code stays the source of truth. */
function loadSchedules(): Schedule[] {
  const dir = join(HOME, "agent/schedules");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".ts"))
    .map((f) => ({ id: f.replace(/\.ts$/, ""), cron: /cron:\s*["'`]([^"'`]+)["'`]/.exec(readFileSync(join(dir, f), "utf8"))?.[1] ?? "" }))
    .filter((s) => s.cron);
}

/** One cron field: *, n, a-b, lists, and /step on any of them. */
function fieldMatches(spec: string, value: number, min: number) {
  return spec.split(",").some((part) => {
    const [range, stepStr] = part.split("/");
    const step = stepStr ? Number(stepStr) : 1;
    let lo = min;
    let hi = Number.POSITIVE_INFINITY;
    if (range !== "*") {
      const [a, b] = range.split("-").map(Number);
      lo = a;
      hi = b ?? (stepStr ? Number.POSITIVE_INFINITY : a);
    }
    return value >= lo && value <= hi && (value - lo) % step === 0;
  });
}

/** Standard 5-field cron, evaluated in local time (9am means your 9am). */
function cronMatches(expr: string, d: Date) {
  const [min, hour, dom, mon, dow] = expr.trim().split(/\s+/);
  const dayOk =
    dom === "*" || dow === "*"
      ? fieldMatches(dom, d.getDate(), 1) && fieldMatches(dow, d.getDay(), 0)
      : fieldMatches(dom, d.getDate(), 1) || fieldMatches(dow, d.getDay(), 0); // cron's OR rule
  return fieldMatches(min, d.getMinutes(), 0) && fieldMatches(hour, d.getHours(), 0) && dayOk && fieldMatches(mon, d.getMonth() + 1, 1);
}

/** Fire a schedule through eve's dispatch route — the same path the production cron handler takes. */
async function fireSchedule(id: string, why: string) {
  try {
    const res = await fetch(`${ORIGIN}/eve/v1/dev/schedules/${encodeURIComponent(id)}`, { method: "POST" });
    log(`schedule ${id} (${why}) → ${res.status} ${(await res.text()).slice(0, 160)}`);
  } catch (err) {
    log(`schedule ${id} (${why}) failed: ${(err as Error).message}`);
  }
}

function startScheduler() {
  const schedules = loadSchedules();
  log(`schedules: ${schedules.map((s) => `${s.id} "${s.cron}"`).join(", ") || "none"}`);
  const tick = () => {
    if (schedulesPaused) return;
    const now = new Date();
    for (const s of schedules) if (cronMatches(s.cron, now)) void fireSchedule(s.id, "cron");
  };
  // Align to the top of each minute.
  setTimeout(() => {
    tick();
    setInterval(tick, 60_000);
  }, 60_000 - (Date.now() % 60_000) + 500);
}

// ── Window, tray, hotkey ─────────────────────────────────────────────────────────────────────────

let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;

// Room for the traffic lights over the sidebar, and draggable title strips.
const DESKTOP_CSS = `
  aside::before { content: ""; display: block; height: 28px; -webkit-app-region: drag; }
  main { position: relative; }
  main::before { content: ""; position: absolute; inset: 0 0 auto 0; height: 28px; -webkit-app-region: drag; }
`;

const SPLASH = `data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html><html><head><meta charset="utf-8"><style>
  :root { color-scheme: light dark; } body { margin:0; height:100vh; display:grid; place-items:center; font: 14px -apple-system, system-ui, sans-serif;
  background: ${nativeTheme.shouldUseDarkColors ? "#0a0a0a" : "#f7f7f7"}; color: ${nativeTheme.shouldUseDarkColors ? "#aaa" : "#555"}; -webkit-app-region: drag; }
  b { display:block; font-size: 28px; color: ${nativeTheme.shouldUseDarkColors ? "#fff" : "#111"}; margin-bottom: 6px; letter-spacing: -0.02em; }
</style></head><body><div style="text-align:center"><b>bridgr</b>Starting your network…</div></body></html>`)}`;

function createWindow() {
  win = new BrowserWindow({
    width: 1320,
    height: 880,
    minWidth: 900,
    minHeight: 600,
    title: "bridgr",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 14, y: 14 },
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#0a0a0a" : "#f7f7f7",
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  void win.loadURL(SPLASH);
  win.webContents.on("did-finish-load", () => {
    if (win?.webContents.getURL().startsWith(ORIGIN)) void win.webContents.insertCSS(DESKTOP_CSS);
  });
  // WhatsApp links, sources, profiles: open in your browser, not inside bridgr.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(ORIGIN)) void shell.openExternal(url);
    else void win?.loadURL(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (!url.startsWith(ORIGIN) && !url.startsWith("data:")) {
      e.preventDefault();
      void shell.openExternal(url);
    }
  });
  // Closing hides: bridgr keeps scanning and pushing from the menu bar.
  win.on("close", (e) => {
    if (!quitting) {
      e.preventDefault();
      win?.hide();
    }
  });
}

function show(path?: string) {
  if (!win) createWindow();
  if (path) void win!.loadURL(`${ORIGIN}${path}`);
  win!.show();
  win!.focus();
}

function openChat() {
  show();
  void win?.webContents.executeJavaScript(`window.dispatchEvent(new Event("bridgr:open-chat"))`).catch(() => {});
}

function buildTray() {
  const icon = nativeImage.createFromPath(join(ASSETS, "trayTemplate.png"));
  icon.setTemplateImage(true);
  tray = new Tray(icon);
  tray.setToolTip("bridgr");
  const refresh = () =>
    tray?.setContextMenu(
      Menu.buildFromTemplate([
        { label: "Open bridgr", click: () => show() },
        { label: "Today", click: () => show("/today") },
        { label: "Ask bridgr", accelerator: HOTKEY, click: openChat },
        { type: "separator" },
        { label: "Scan my network now", click: () => void fireSchedule("scan", "manual") },
        { label: "Push what's new now", click: () => void fireSchedule("notify", "manual") },
        { type: "separator" },
        {
          label: "Run schedules",
          type: "checkbox",
          checked: !schedulesPaused,
          click: (item) => {
            schedulesPaused = !item.checked;
            log(`schedules ${schedulesPaused ? "paused" : "resumed"}`);
          },
        },
        {
          label: "Open at login",
          type: "checkbox",
          checked: app.getLoginItemSettings().openAtLogin,
          click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked }),
        },
        { type: "separator" },
        { label: "Quit bridgr", click: () => app.quit() },
      ]),
    );
  refresh();
  tray.on("click", refresh);
}

// ── Lifecycle ────────────────────────────────────────────────────────────────────────────────────

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.setName("bridgr");
  app.on("second-instance", () => show());
  app.on("activate", () => show());
  app.on("before-quit", () => {
    quitting = true;
    globalShortcut.unregisterAll();
    stopServer();
  });
  app.on("window-all-closed", () => {}); // stay alive in the menu bar

  app.whenReady().then(async () => {
    log(`bridgr desktop starting (home: ${HOME})`);
    adoptLoginShellPath();
    Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: "appMenu" }, { role: "editMenu" }, { role: "viewMenu" }, { role: "windowMenu" }]));
    if (!app.isPackaged && process.platform === "darwin" && existsSync(join(ASSETS, "icon.png"))) app.dock?.setIcon(join(ASSETS, "icon.png"));
    createWindow();
    buildTray();
    if (!globalShortcut.register(HOTKEY, openChat)) log(`couldn't register ${HOTKEY}`);
    try {
      await ensureServer();
      await win!.loadURL(`${ORIGIN}/`);
      startScheduler();
    } catch (err) {
      log((err as Error).message);
      void win!.loadURL(
        `data:text/html;charset=utf-8,${encodeURIComponent(`<body style="font:14px -apple-system;padding:40px"><h2>bridgr couldn't start</h2><p>${(err as Error).message}</p><p>Home: ${HOME}</p></body>`)}`,
      );
    }
  });
}
