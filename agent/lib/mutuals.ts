import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import type { Mutuals } from "../../collector/types";
import { db, schema } from "./db/client";

// People you and someone both know, exactly as their profile surfaces them — a handful of names and a
// count, never a crawl of anyone's connection list. Used for "in common" on the dossier, a closeness
// signal in warmth, and to stop suggesting intros between people who already know each other.

const { mutuals, identities, people } = schema;
type Platform = (typeof mutuals.$inferInsert)["platform"];

const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .toLowerCase();

/** Store what one profile showed. Replaces that profile's previous list (it reflects the UI now). */
export async function saveMutuals(personId: number, platform: Platform, m: Mutuals) {
  const update: Partial<typeof identities.$inferInsert> = {};
  if (m.total !== undefined) update.mutualsTotal = m.total;
  if (m.followsYou !== undefined) update.mutual = m.followsYou;
  if (Object.keys(update).length)
    await db.update(identities).set(update).where(and(eq(identities.personId, personId), eq(identities.platform, platform)));

  const labels = [...(m.handles ?? []), ...(m.names ?? [])];
  if (!m.handles && !m.names) return 0; // nothing listed — keep whatever we had
  await db.delete(mutuals).where(and(eq(mutuals.personId, personId), eq(mutuals.platform, platform)));
  if (!labels.length) return 0;

  // Handles resolve exactly on the same platform; LinkedIn first names only when unambiguous.
  const byHandle = m.handles?.length
    ? new Map(
        (
          await db
            .select({ handle: identities.handle, personId: identities.personId })
            .from(identities)
            .where(and(eq(identities.platform, platform), inArray(sql`lower(${identities.handle})`, m.handles.map((h) => h.toLowerCase()))))
        ).map((r) => [r.handle.toLowerCase(), r.personId]),
      )
    : new Map<string, number>();
  const firstNames = new Map<string, number[]>();
  if (m.names?.length) {
    const rows = await db
      .selectDistinct({ id: people.id, name: people.name })
      .from(people)
      .innerJoin(identities, eq(identities.personId, people.id))
      .where(eq(identities.platform, platform));
    for (const r of rows) {
      const first = fold(r.name.split(/\s+/)[0] ?? "");
      firstNames.set(first, [...(firstNames.get(first) ?? []), r.id]);
    }
  }

  const rows = labels.map((label) => {
    const viaHandle = byHandle.get(label.toLowerCase());
    const candidates = firstNames.get(fold(label)) ?? [];
    const via = viaHandle ?? (candidates.length === 1 ? candidates[0] : undefined);
    return { personId, platform, label, viaPersonId: via !== personId ? via : undefined };
  });
  await db.insert(mutuals).values(rows).onConflictDoNothing();
  return rows.length;
}

/** "In common" for one person, per platform: the profile's count, follows-back, and who it named. */
export async function mutualsFor(personId: number) {
  const [ids, rows] = await Promise.all([
    db
      .select({ platform: identities.platform, total: identities.mutualsTotal, followsYou: identities.mutual })
      .from(identities)
      .where(eq(identities.personId, personId)),
    db
      .select({ platform: mutuals.platform, label: mutuals.label, viaPersonId: mutuals.viaPersonId, viaName: people.name })
      .from(mutuals)
      .leftJoin(people, eq(people.id, mutuals.viaPersonId))
      .where(eq(mutuals.personId, personId)),
  ]);
  return ids
    .map((i) => ({
      platform: i.platform,
      total: i.total,
      followsYou: i.followsYou,
      shown: rows.filter((r) => r.platform === i.platform).map((r) => ({ label: r.label, personId: r.viaPersonId, name: r.viaName })),
    }))
    .filter((p) => p.total || p.shown.length || p.followsYou);
}

/** Pairs of people in the network who already know each other (by a resolved mutual), as "a:b" with a<b. */
export async function knownPairs() {
  const rows = await db.select({ a: mutuals.personId, b: mutuals.viaPersonId }).from(mutuals).where(isNotNull(mutuals.viaPersonId));
  return new Set(rows.map((r) => (r.a < r.b! ? `${r.a}:${r.b}` : `${r.b}:${r.a}`)));
}
