import { generateText, Output } from "ai";
import { and, asc, desc, eq, isNull, lt, inArray } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "../db/client";
import { EVENT_TYPES } from "../db/schema";
import { EXTRACT_MODEL } from "../models";
import { triage } from "../triage";
import { pMap } from "../util";

const extraction = z.object({
  relevant: z
    .boolean()
    .describe("False for reposts of others, memes, ads or anything that says nothing about the author's life."),
  type: z.enum(EVENT_TYPES),
  summary: z.string().describe("One sentence, third person, e.g. 'Ana started as PM at Stripe in SF.'"),
  entities: z.object({
    places: z.array(z.string()).describe("Cities or countries, canonical English names."),
    companies: z.array(z.string()),
    topics: z.array(z.string()).describe("2-4 short lowercase topics, e.g. 'climate', 'ai agents'."),
    dates: z.array(z.string()).describe("ISO dates or ranges mentioned, e.g. '2026-12-03/2026-12-07'."),
  }),
  asks: z.array(z.string()).describe("Things the author is looking for: hires, intros, advice, recommendations."),
  offers: z.array(z.string()).describe("Things the author can give: hiring, investing, expertise, a spare ticket."),
});

/** Append one row to the observation log so the event log / "Today" edition has a timeline. */
async function logEvent(
  kind: (typeof schema.observations.$inferInsert)["kind"],
  personId: number,
  source: string,
  occurredAt: number,
  payload: unknown,
) {
  await db.insert(schema.observations).values({ kind, personId, source, occurredAt, payload });
}

/** Turn unenriched posts into events, and LinkedIn snapshot changes into job_change/move events. */
export async function enrich() {
  const pending = await db
    .select({ post: schema.posts, name: schema.people.name })
    .from(schema.posts)
    .innerJoin(schema.people, eq(schema.people.id, schema.posts.personId))
    .where(isNull(schema.posts.enrichedAt));

  // Cheap triage first: only posts that plausibly matter get the expensive extraction.
  const objectives = await db.select({ id: schema.objectives.id, text: schema.objectives.text }).from(schema.objectives);
  const verdicts = objectives.length ? await triage(pending.map((p) => p.post.text), objectives) : pending.map(() => ({ relevant: true, escalate: true, objectiveIds: [], reason: "" }));
  const toExtract = pending.filter((_, i) => verdicts[i].relevant && verdicts[i].escalate);
  // Mark the filtered-out posts handled so we don't re-triage them.
  const skipped = pending.filter((_, i) => !(verdicts[i].relevant && verdicts[i].escalate));
  if (skipped.length)
    await db.update(schema.posts).set({ enrichedAt: Date.now() }).where(inArray(schema.posts.id, skipped.map((p) => p.post.id)));

  let created = 0;
  await pMap(toExtract, 5, async ({ post, name }) => {
    const { output } = await generateText({
      model: EXTRACT_MODEL,
      output: Output.object({ schema: extraction }),
      prompt: `Extract the life update from this ${post.platform} post by ${name}, posted ${new Date(post.postedAt).toISOString().slice(0, 10)}.\n\n${post.text}`,
    });
    if (output.relevant) {
      const [ev] = await db
        .insert(schema.events)
        .values({
          personId: post.personId,
          postId: post.id,
          type: output.type,
          summary: output.summary,
          entities: output.entities,
          asks: output.asks,
          offers: output.offers,
          occurredAt: post.postedAt,
        })
        .returning({ id: schema.events.id });
      // Spine of the event log / newspaper: one human-readable row per surfaced signal.
      await logEvent("post_seen", post.personId, post.platform, post.postedAt, {
        eventId: ev.id,
        type: output.type,
        summary: output.summary,
      });
      created++;
    }
    await db.update(schema.posts).set({ enrichedAt: Date.now() }).where(eq(schema.posts.id, post.id));
  });

  created += await diffSnapshots();
  return { posts: pending.length, events: created };
}

async function diffSnapshots() {
  const fresh = await db.select().from(schema.snapshots).where(isNull(schema.snapshots.diffedAt)).orderBy(asc(schema.snapshots.takenAt));
  let created = 0;

  for (const snap of fresh) {
    const [prev] = await db
      .select()
      .from(schema.snapshots)
      .where(
        and(
          eq(schema.snapshots.personId, snap.personId),
          eq(schema.snapshots.platform, snap.platform),
          lt(schema.snapshots.takenAt, snap.takenAt),
        ),
      )
      .orderBy(desc(schema.snapshots.takenAt))
      .limit(1);

    const [person] = await db.select().from(schema.people).where(eq(schema.people.id, snap.personId));
    const changes: (typeof schema.events.$inferInsert)[] = [];
    const base = { personId: snap.personId, occurredAt: snap.takenAt, asks: [], offers: [] };

    if (prev && snap.company && prev.company && snap.company !== prev.company) {
      changes.push({
        ...base,
        type: "job_change",
        summary: `${person.name} moved from ${prev.company} to ${snap.company}${snap.headline ? ` (${snap.headline})` : ""}.`,
        entities: { places: snap.location ? [snap.location] : [], companies: [snap.company], topics: [], dates: [] },
      });
    }
    if (prev && snap.location && prev.location && snap.location !== prev.location) {
      changes.push({
        ...base,
        type: "move",
        summary: `${person.name} is now based in ${snap.location} (was ${prev.location}).`,
        entities: { places: [snap.location], companies: snap.company ? [snap.company] : [], topics: [], dates: [] },
      });
    }

    if (changes.length) {
      await db.insert(schema.events).values(changes);
      for (const c of changes)
        await logEvent(c.type === "move" ? "moved" : "job_change", snap.personId, snap.platform, snap.takenAt, { type: c.type, summary: c.summary });
    }
    created += changes.length;
    await db.update(schema.snapshots).set({ diffedAt: Date.now() }).where(eq(schema.snapshots.id, snap.id));
  }
  return created;
}
