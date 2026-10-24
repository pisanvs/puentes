import { type BrowserContext, chromium, type Page } from "playwright";
import { CDP_URL, ensureBrowserDaemon } from "../agent/lib/browserd";

/**
 * Attach to the shared browser (scripts/browserd.ts), starting it if needed. Its context holds
 * your signed-in sessions. Close the pages you open; never close the context, since that's the
 * shared browser everyone else (and the dashboard view) is using.
 */
export async function openBrowser(): Promise<BrowserContext> {
  await ensureBrowserDaemon();
  const browser = await chromium.connectOverCDP(CDP_URL);
  return browser.contexts()[0];
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Random pause so the session looks like a person reading, not a crawler. */
export const jitter = (min = 1500, max = 4000) => sleep(min + Math.random() * (max - min));

/** Scroll in small wheel steps, pausing like someone reading. */
export async function humanScroll(page: Page, steps = 4) {
  for (let i = 0; i < steps; i++) {
    await page.mouse.wheel(0, 300 + Math.random() * 500);
    await sleep(400 + Math.random() * 900);
  }
  await jitter(800, 2000);
}
