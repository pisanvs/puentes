import { spawn } from "node:child_process";
import { mkdirSync, openSync, readdirSync, readFileSync, writeFileSync } from "node:fs";

// Long-running work (scraping, logins, imports) runs as detached scripts. Each job writes its
// status to .puentes/jobs/<name>.json so the dashboard, agent tools and other jobs can see it.
const DIR = ".puentes/jobs";
const LOGS = ".puentes/logs";
const STALE_MS = 30 * 60 * 1000;

export type JobStatus = {
  state: "idle" | "running" | "done" | "failed";
  startedAt?: number;
  finishedAt?: number;
  /** Latest human-readable progress line, e.g. "Imported 340 follows". */
  message?: string;
  error?: string;
  result?: unknown;
  /** Uses the shared Chrome profile; only one such job may run at a time. */
  browser?: boolean;
};

const file = (name: string) => `${DIR}/${name}.json`;

export function readJob(name: string): JobStatus {
  try {
    return JSON.parse(readFileSync(file(name), "utf8"));
  } catch {
    return { state: "idle" };
  }
}

export function writeJob(name: string, status: JobStatus) {
  mkdirSync(DIR, { recursive: true });
  writeFileSync(file(name), JSON.stringify(status));
}

const isLive = (s: JobStatus) => s.state === "running" && Date.now() - (s.startedAt ?? 0) < STALE_MS;

/** The running job holding the Chrome profile, if any. */
export function browserBusy(): string | null {
  try {
    for (const f of readdirSync(DIR)) {
      const name = f.replace(/\.json$/, "");
      const s = readJob(name);
      if (s.browser && isLive(s)) return name;
    }
  } catch {
    // no jobs yet
  }
  return null;
}

/** Start `npx tsx <script> ...args` detached. Returns the status it starts with, or why it didn't start. */
export function spawnJob(name: string, script: string, args: string[] = [], opts: { browser?: boolean } = {}): JobStatus {
  const current = readJob(name);
  if (isLive(current)) return current;
  if (opts.browser) {
    const holder = browserBusy();
    if (holder) return { state: "failed", error: `The browser is busy with "${holder}". Try again when it finishes.` };
  }

  mkdirSync(LOGS, { recursive: true });
  const log = openSync(`${LOGS}/${name}.log`, "a");
  const status: JobStatus = { state: "running", startedAt: Date.now(), browser: opts.browser };
  writeJob(name, status);
  const child = spawn("npx", ["tsx", "--env-file-if-exists=.env.local", script, ...args], {
    cwd: process.cwd(),
    detached: true,
    stdio: ["ignore", log, log],
    env: { ...process.env, PUENTES_JOB: name },
  });
  child.unref();
  return status;
}

/**
 * Wrap a script's body: records running → done/failed, and gives it `progress()` for live messages.
 * Exits the process when finished so a stray browser handle can't keep it alive.
 */
export async function runJob<T>(fallbackName: string, fn: (progress: (message: string) => void) => Promise<T>, opts: { browser?: boolean } = {}) {
  const name = process.env.PUENTES_JOB ?? fallbackName;
  const startedAt = readJob(name).state === "running" ? (readJob(name).startedAt ?? Date.now()) : Date.now();
  const base = { startedAt, browser: opts.browser };
  writeJob(name, { ...base, state: "running" });
  const progress = (message: string) => {
    console.log(`[${name}] ${message}`);
    writeJob(name, { ...base, state: "running", message });
  };
  try {
    const result = await fn(progress);
    writeJob(name, { ...base, state: "done", finishedAt: Date.now(), result });
    console.log(`[${name}] done`, JSON.stringify(result));
    process.exit(0);
  } catch (err) {
    writeJob(name, { ...base, state: "failed", finishedAt: Date.now(), error: (err as Error).message });
    console.error(`[${name}] failed`, err);
    process.exit(1);
  }
}
