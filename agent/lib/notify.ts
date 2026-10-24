import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { db, schema } from "./db/client";
import { DAY } from "./util";
import { warmthDecayCurve } from "./warmth-decay";

const { people, nudges, identities, observations } = schema;

// Don't re-remind about the same cooling person within this window.
const COOLING_REPEAT = 10 * DAY;
const COOLING_CAP = 5; // at most this many cooling reminders per push, so it never floods

const waLink = (phone: string, text: string) => `https://wa.me/${phone.replace(/\D/g, "")}?text=${encodeURIComponent(text)}`;

export type PushNudge = { person: string; reason: string; draft: string; sendLink: string | null };
export type PushCooling = { person: string; daysSince: number | null };
export type Pushes = { nudges: PushNudge[]; cooling: PushCooling[] };

const REINFORCE = new Set(["connection_made", "contact_logged", "engaged_with", "note_added"]);

/**
 * Everything new worth proactively telling the owner about — and MARK it pushed/reminded so it
 * never fires twice. Returns empty arrays when there's nothing new (the schedule then stays quiet).
 * v1 is indiscriminate: every new nudge is pushed, no salience gate (that comes with jev categories).
 */
export async function collectPushes(): Promise<Pushes> {
  // 1. New nudges we haven't pushed yet.
  const rows = await db
    .select({ id: nudges.id, person: people.name, phone: people.phone, reason: nudges.reason, draft: nudges.draft })
    .from(nudges)
    .innerJoin(people, eq(people.id, nudges.personId))
    .where(and(eq(nudges.status, "new"), isNull(nudges.pushedAt)))
    .orderBy(desc(nudges.score));
  if (rows.length) await db.update(nudges).set({ pushedAt: Date.now() }).where(inArray(nudges.id, rows.map((r) => r.id)));
  const pushNudges: PushNudge[] = rows.map((r) => ({
    person: r.person,
    reason: r.reason,
    draft: r.draft,
    sendLink: r.phone ? waLink(r.phone, r.draft) : null,
  }));

  // 2. Cooling: pinned / inner-circle people whose warmth curve has crossed cold, not reminded recently.
  const candidates = await db
    .select()
    .from(people)
    .where(
      and(
        or(eq(people.pinned, true), eq(people.tracked, true)),
        or(isNull(people.coolingPushedAt), sql`${people.coolingPushedAt} < ${Date.now() - COOLING_REPEAT}`),
      ),
    );
  const cooling: PushCooling[] = [];
  const cooledIds: number[] = [];
  if (candidates.length) {
    const ids = candidates.map((c) => c.id);
    const [obs, idRows] = await Promise.all([
      db
        .select({ personId: observations.personId, occurredAt: observations.occurredAt, observedAt: observations.observedAt, kind: observations.kind })
        .from(observations)
        .where(inArray(observations.personId, ids)),
      db.select({ personId: identities.personId, importedAt: identities.importedAt }).from(identities).where(inArray(identities.personId, ids)),
    ]);
    for (const p of candidates) {
      const reinforcements = [
        ...obs.filter((o) => o.personId === p.id && REINFORCE.has(o.kind)).map((o) => o.occurredAt ?? o.observedAt),
        ...(p.lastContacted ? [p.lastContacted] : []),
        ...idRows.filter((i) => i.personId === p.id).map((i) => i.importedAt).filter((x): x is number => x != null),
      ];
      if (!reinforcements.length) continue;
      const curve = warmthDecayCurve(reinforcements);
      if (curve.coldAt != null && curve.coldAt <= Date.now()) {
        cooling.push({ person: p.name, daysSince: p.lastContacted ? Math.round((Date.now() - p.lastContacted) / DAY) : null });
        cooledIds.push(p.id);
      }
      if (cooling.length >= COOLING_CAP) break;
    }
    if (cooledIds.length) await db.update(people).set({ coolingPushedAt: Date.now() }).where(inArray(people.id, cooledIds));
  }

  return { nudges: pushNudges, cooling };
}
