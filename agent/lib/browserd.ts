import { spawn } from "node:child_process";
import { mkdirSync, openSync } from "node:fs";

// One shared Chrome, owned by scripts/browserd.ts. Jobs attach over CDP; the dashboard
// watches and drives it through the screencast WebSocket. No Playwright import here so the
// web server can call ensureBrowserDaemon() cheaply.
export const CDP_URL = `http://127.0.0.1:${process.env.BROWSERD_CDP_PORT ?? 9333}`;
export const VIEW_PORT = Number(process.env.BROWSERD_PORT ?? 4317);

export async function browserDaemonUp() {
  try {
    const res = await fetch(`${CDP_URL}/json/version`, { signal: AbortSignal.timeout(1000) });
    return res.ok;
  } catch {
    return false;
  }
}

/** Start the daemon if it isn't running, and wait until Chrome accepts CDP connections. */
export async function ensureBrowserDaemon() {
  if (await browserDaemonUp()) return;
  mkdirSync(".puentes/logs", { recursive: true });
  const log = openSync(".puentes/logs/browserd.log", "a");
  const child = spawn("npx", ["tsx", "--env-file-if-exists=.env.local", "scripts/browserd.ts"], {
    cwd: process.cwd(),
    detached: true,
    stdio: ["ignore", log, log],
  });
  child.unref();
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (await browserDaemonUp()) return;
  }
  throw new Error("The browser didn't start. See .puentes/logs/browserd.log.");
}
