import { mkdirSync, writeFileSync } from "node:fs";
import type { Page } from "playwright";

// Extraction reads the JSON APIs the sites' own frontends call, not the rendered DOM.
// Navigation and scrolling just make the page request the next batch.

export type Captured = { url: string; body: unknown };

/**
 * Collect every JSON response whose URL matches `test`. Set CAPTURE_DIR to also dump them,
 * which is how you tune a parser when a site changes its payloads.
 */
export function captureJson(page: Page, test: RegExp, label = "capture") {
  const bodies: Captured[] = [];
  const pending = new Set<Promise<void>>();
  let n = 0;

  page.on("response", (res) => {
    const url = res.url();
    if (!test.test(url)) return;
    if (!(res.headers()["content-type"] ?? "").includes("json")) return;
    const p = res
      .json()
      .then((body) => {
        bodies.push({ url, body });
        if (process.env.CAPTURE_DIR) {
          mkdirSync(process.env.CAPTURE_DIR, { recursive: true });
          writeFileSync(`${process.env.CAPTURE_DIR}/${label}-${Date.now()}-${n++}.json`, JSON.stringify({ url, body }, null, 1));
        }
      })
      .catch(() => {}) // aborted / non-JSON body
      .finally(() => pending.delete(p));
    pending.add(p);
  });

  return {
    bodies,
    /** Wait for in-flight bodies to finish parsing. */
    settle: () => Promise.all([...pending]),
  };
}

/** Every object in a JSON tree, depth-first. Parsers match on shape so envelope changes don't break them. */
export function* walk(node: unknown): Generator<Record<string, any>> {
  if (!node || typeof node !== "object") return;
  if (!Array.isArray(node)) yield node as Record<string, any>;
  for (const value of Object.values(node)) yield* walk(value);
}
