import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { and, desc, eq, gt, inArray, sql } from "drizzle-orm";
import { db, schema } from "./db/client";
import { addNote } from "./queries";
import { DAY } from "./util";
import { rawForNorm, warmthNorm } from "./warmth-curve";

const { people, identities } = schema;
const CACHE = ".puentes/cache/new-people.json";
const CACHE_TTL = 60 * 60 * 1000; // recompute at most hourly
const WINDOW = DAY; // "new" = added in the last day
const MET_BOOST = rawForNorm(0.75); // meeting IRL is a strong warmth signal → pushes them warm

type Answer = "met" | "online" | "skip";
type Cache = { computedAt: number; ids: number[]; answered: Record<number, Answer> };

function read(): Cache {
  try {
    return JSON.parse(readFileSync(CACHE, "utf8"));
  } catch {
    return { computedAt: 0, ids: [], answered: {} };
  }
}
function write(c: Cache) {
  mkdirSync(".puentes/cache", { recursive: true });
  writeFileSync(CACHE, JSON.stringify(c));
}

/** Recompute the set of people newly added to the network in the last day (hourly cache). */
async function refresh(cache: Cache): Promise<Cache> {
  const rows = await db
    .selectDistinct({ id: identities.personId })
    .from(identities)
    .where(gt(identities.importedAt, Date.now() - WINDOW));
  return { computedAt: Date.now(), ids: rows.map((r) => r.id), answered: cache.answered };
}

/**
 * People newly in your network that you haven't triaged yet, best-connected first, with the
 * "did you meet them in person?" question still open. Caching keeps the scan to once an hour.
 */
export async function newPeople(limit = 30) {
  let cache = read();
  if (Date.now() - cache.computedAt > CACHE_TTL) {
    cache = await refresh(cache);
    write(cache);
  }
  const pending = cache.ids.filter((id) => !cache.answered[id]);
  if (pending.length === 0) return { total: 0, people: [] };

  const rows = await db
    .select()
    .from(people)
    .where(inArray(people.id, pending))
    .orderBy(desc(people.priority))
    .limit(limit);
  const ids = rows.map((r) => r.id);
  const handles = ids.length ? await db.select().from(identities).where(inArray(identities.personId, ids)) : [];

  return {
    total: pending.length,
    people: rows.map((p) => ({
      id: p.id,
      name: p.name,
      reason: p.priorityReason,
      warmth: Math.round(warmthNorm(p.warmth) * 100),
      platforms: [...new Set(handles.filter((h) => h.personId === p.id).map((h) => h.platform))],
      bio: handles.find((h) => h.personId === p.id && h.bio)?.bio ?? null,
    })),
  };
}

/** Answer the "did you meet them?" prompt. Meeting IRL warms them up and leaves a note. */
export async function answerMet(personId: number, answer: Answer) {
  const cache = read();
  cache.answered[personId] = answer;
  write(cache);

  if (answer === "met") {
    const [p] = await db.select({ name: people.name, warmth: people.warmth }).from(people).where(eq(people.id, personId));
    if (p) {
      const bump = Math.max(0, MET_BOOST - (p.warmth ?? 0));
      await db
        .update(people)
        .set({ warmthBoost: sql`${people.warmthBoost} + ${bump}`, warmth: sql`coalesce(${people.warmth},0) + ${bump}`, tracked: true })
        .where(eq(people.id, personId));
      await addNote(p.name, "Met in person").catch(() => {});
    }
  }
  return { ok: true };
}
