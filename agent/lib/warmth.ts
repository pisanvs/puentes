import { eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "./db/client";
import { DAY } from "./util";
import { isInnerCircle, warmthNorm } from "./warmth-curve";

const { people, identities, edges, observations } = schema;

/**
 * Warmth = relationship strength, 0-100, from signals we can actually measure (never "how much
 * news you knew beforehand", which is unknowable). Each component is capped so no single signal
 * dominates, then the total is squashed to 0-100.
 */
type Signals = {
  daysSinceContact: number | null;
  mutual: boolean;
  platforms: number;
  closeness: number; // rarity-weighted shared-entity mass with your inner circle
  engagements: number; // times you've engaged with them (feature 2)
};

export function scoreWarmth(s: Signals): { warmth: number; reason: string } {
  const parts: { label: string; pts: number }[] = [];

  // Recency: talked recently = warm; decays over ~6 months; never-logged contributes 0.
  if (s.daysSinceContact !== null) {
    const recency = Math.max(0, 1 - s.daysSinceContact / 180);
    if (recency > 0) parts.push({ label: s.daysSinceContact <= 1 ? "talked today" : `talked ${s.daysSinceContact}d ago`, pts: 35 * recency });
  }
  if (s.mutual) parts.push({ label: "follows you back", pts: 15 });
  if (s.platforms > 1) parts.push({ label: `connected on ${s.platforms} platforms`, pts: 12 * (s.platforms - 1) });
  if (s.closeness > 0) parts.push({ label: "shares your circles", pts: Math.min(20, s.closeness * 20) });
  if (s.engagements > 0) parts.push({ label: `you engage with them (${s.engagements})`, pts: Math.min(18, s.engagements * 6) });

  // Raw is uncapped and accumulates linearly; the sigmoid (warmth-curve.ts) squashes it for display.
  const warmth = parts.reduce((a, p) => a + p.pts, 0);
  const reason = parts.length
    ? parts
        .sort((a, b) => b.pts - a.pts)
        .slice(0, 3)
        .map((p) => p.label)
        .join(", ")
    : "no signal yet";
  return { warmth, reason };
}

/** Recompute warmth for everyone (or a subset). Cheap: pure SQL aggregates, no LLM. */
export async function recomputeWarmth(progress: (m: string) => void = () => {}) {
  const rows = await db.select().from(people);
  const ids = rows.map((r) => r.id);
  if (ids.length === 0) return { people: 0 };

  // Pre-aggregate the signals in a few queries rather than per-person round-trips.
  const ids2 = await db
    .select({ personId: identities.personId, platforms: sql<number>`count(distinct ${identities.platform})`, anyMutual: sql<number>`max(${identities.mutual})` })
    .from(identities)
    .where(inArray(identities.personId, ids))
    .groupBy(identities.personId);
  const idMap = new Map(ids2.map((r) => [r.personId, r]));

  // Graph closeness: rarity-weighted count of entities a person shares with any tracked (inner-circle) person.
  const closeness = await db
    .select({
      personId: edges.personId,
      mass: sql<number>`sum(1.0 / (select count(distinct person_id) from ${edges} e2 where e2.entity_id = ${edges.entityId}))`,
    })
    .from(edges)
    .where(
      inArray(
        edges.entityId,
        db.select({ entityId: edges.entityId }).from(edges).innerJoin(people, eq(people.id, edges.personId)).where(eq(people.tracked, true)),
      ),
    )
    .groupBy(edges.personId);
  const closeMap = new Map(closeness.map((r) => [r.personId, r.mass ?? 0]));
  const maxClose = Math.max(1, ...closeMap.values());

  const engage = await db
    .select({ personId: observations.personId, n: sql<number>`count(*)` })
    .from(observations)
    .where(eq(observations.kind, "engaged_with"))
    .groupBy(observations.personId);
  const engageMap = new Map(engage.map((r) => [r.personId, r.n]));

  let i = 0;
  for (const p of rows) {
    const agg = idMap.get(p.id);
    const { warmth, reason } = scoreWarmth({
      daysSinceContact: p.lastContacted ? Math.round((Date.now() - p.lastContacted) / DAY) : null,
      mutual: Boolean(agg?.anyMutual),
      platforms: agg?.platforms ?? 1,
      closeness: (closeMap.get(p.id) ?? 0) / maxClose,
      engagements: engageMap.get(p.id ?? 0) ?? 0,
    });
    // Manual love taps add on top of the measured score (uncapped raw) and survive recompute.
    const boost = p.warmthBoost ?? 0;
    const raw = warmth + boost;
    // Inner circle is derived from the sigmoid: warm enough ⇒ in. Warming someone up pulls them in.
    await db
      .update(people)
      .set({
        warmth: raw,
        warmthReason: boost > 0 ? `${reason}, +${Math.round(boost)} from you` : reason,
        tracked: isInnerCircle(raw),
      })
      .where(eq(people.id, p.id));
    if (++i % 200 === 0) progress(`Scored warmth for ${i}/${rows.length}`);
  }
  return { people: rows.length };
}
