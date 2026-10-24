import { readdir, readFile } from "node:fs/promises";
import { and, desc, eq } from "drizzle-orm";
import type { BrowserContext } from "playwright";
import { db, schema } from "../agent/lib/db/client";
import { DAY } from "../agent/lib/util";
import { identitiesFor } from "../agent/lib/people";
import { collectBluesky } from "./adapters/bluesky";
import { collectInstagram } from "./adapters/instagram";
import { collectLinkedIn } from "./adapters/linkedin";
import { collectX } from "./adapters/x";
import { jitter, openBrowser } from "./browser";
import { requireLogin } from "./session";
import type { Collected, Platform, RawPost, Snapshot } from "./types";

const LOOKBACK = Number(process.env.LOOKBACK_DAYS ?? 14) * DAY;
// A freshly-added connection has no history here yet, so we backfill a full week of their activity
// rather than only picking up what's appeared since they were added (which, for someone added today,
// is nearly nothing). Established people use the standard window. This holds even if LOOKBACK is later
// shortened for fast incremental scans.
const FRESH_BACKFILL = Number(process.env.FRESH_BACKFILL_DAYS ?? 7) * DAY;
const FRESH_WINDOW = Number(process.env.FRESH_WINDOW_DAYS ?? 2) * DAY;
const LINKEDIN_CAP = Number(process.env.LINKEDIN_CAP ?? 25);

/** How far back to scrape one identity: ≥7 days for recently-added connections, else the standard window. */
function sinceFor(importedAt: number | null) {
  const fresh = importedAt != null && Date.now() - importedAt < FRESH_WINDOW;
  return Date.now() - (fresh ? Math.max(FRESH_BACKFILL, LOOKBACK) : LOOKBACK);
}
export const ALL_PLATFORMS: Platform[] = ["bluesky", "x", "linkedin", "instagram"];

async function savePosts(personId: number, platform: Platform, posts: RawPost[]) {
  if (!posts.length) return 0;
  const rows = await db
    .insert(schema.posts)
    .values(posts.map((p) => ({ id: `${platform}:${p.nativeId}`, platform, personId, url: p.url, text: p.text, postedAt: p.postedAt, raw: p.raw ?? null })))
    .onConflictDoNothing()
    .returning({ id: schema.posts.id });
  return rows.length;
}

/** Keep a snapshot only when something changed, so enrich can diff adjacent rows. */
async function saveSnapshot(personId: number, platform: Platform, snap: Snapshot, takenAt = Date.now()) {
  if (!snap.company && !snap.location && !snap.headline) return;
  const [last] = await db
    .select()
    .from(schema.snapshots)
    .where(and(eq(schema.snapshots.personId, personId), eq(schema.snapshots.platform, platform)))
    .orderBy(desc(schema.snapshots.takenAt))
    .limit(1);
  if (last && last.company === (snap.company ?? null) && last.location === (snap.location ?? null) && last.headline === (snap.headline ?? null)) return;
  await db.insert(schema.snapshots).values({ personId, platform, ...snap, takenAt });
}

/** Scrape every identity on the given platforms. Sequential and slow on purpose. */
export async function collect(platforms = ALL_PLATFORMS, progress: (m: string) => void = console.log) {
  if (process.env.REPLAY) return replay();

  const needsBrowser = platforms.some((p) => p !== "bluesky");
  let ctx: BrowserContext | undefined;
  const stats: Record<string, { people: number; newPosts: number; errors: number; skipped?: string }> = {};

  if (needsBrowser) ctx = await openBrowser();
  for (const platform of platforms) {
    let ids = await identitiesFor(platform);
    if (platform === "linkedin") ids = ids.slice(0, LINKEDIN_CAP);
    const s = (stats[platform] = { people: ids.length, newPosts: 0, errors: 0 } as (typeof stats)[string]);
    if (ids.length && platform !== "bluesky") {
      try {
        await requireLogin(ctx!, platform);
      } catch (err) {
        s.skipped = (err as Error).message;
        progress(`[${platform}] skipped: ${s.skipped}`);
        continue;
      }
    }

    for (const id of ids) {
      try {
        const since = sinceFor(id.importedAt);
        let result: Collected;
        if (platform === "bluesky") result = await collectBluesky(id.handle, since);
        else if (platform === "x") result = await collectX(ctx!, id.handle, since);
        else if (platform === "instagram") result = await collectInstagram(ctx!, id.handle, since);
        else result = await collectLinkedIn(ctx!, id.handle, since);

        s.newPosts += await savePosts(id.personId, platform, result.posts);
        if (result.snapshot) await saveSnapshot(id.personId, platform, result.snapshot);
        progress(`[${platform}] ${id.name}: ${result.posts.length} posts`);
      } catch (err) {
        s.errors++;
        progress(`[${platform}] ${id.name} failed: ${(err as Error).message}`);
      }
      if (platform !== "bluesky") await jitter(3000, 7000);
    }
  }
  return stats;
}

type Fixture = {
  posts?: (RawPost & { person: string; platform: Platform })[];
  snapshots?: (Snapshot & { person: string; platform: Platform; takenAt: number })[];
};

/** Load fixtures/*.json instead of scraping. Dates are shifted so the newest post is "today". */
async function replay() {
  const dir = "fixtures";
  const files = (await readdir(dir)).filter((f) => f.endsWith(".json"));
  const people = new Map((await db.select().from(schema.people)).map((p) => [p.name, p.id]));
  let loaded = 0;

  for (const file of files) {
    const fx = JSON.parse(await readFile(`${dir}/${file}`, "utf8")) as Fixture;
    const newest = Math.max(...(fx.posts ?? []).map((p) => p.postedAt), ...(fx.snapshots ?? []).map((s) => s.takenAt));
    const shift = Number.isFinite(newest) ? Date.now() - DAY / 2 - newest : 0;

    for (const p of fx.posts ?? []) {
      const personId = people.get(p.person);
      if (!personId) continue;
      loaded += await savePosts(personId, p.platform, [{ ...p, postedAt: p.postedAt + shift }]);
    }
    for (const s of (fx.snapshots ?? []).sort((a, b) => a.takenAt - b.takenAt)) {
      const personId = people.get(s.person);
      if (!personId) continue;
      const { person, platform, takenAt, ...snap } = s;
      await saveSnapshot(personId, platform, snap, takenAt + shift);
    }
  }
  return { replay: { files: files.length, newPosts: loaded } };
}
