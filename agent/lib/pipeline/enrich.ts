import { generateText, Output } from "ai";
import { and, asc, desc, eq, isNull, lt, inArray } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "../db/client";
import { EVENT_TYPES } from "../db/schema";
import { ownerCard } from "../me";
import { EXTRACT_MODEL } from "../models";
import { listWatched } from "../topics";
import { triage } from "../triage";
import { pMap } from "../util";

const extraction = z.object({
  relevant: z
    .boolean()
    .describe("False only if the post says nothing about the author's life, work, whereabouts or interests (ads, spam, empty). Reshares count: they show what the author amplifies."),
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

/**
 * A one-line card per author for the classifier and extractor: headline, company, base, bio, what
 * the graph knows, and the owner's own notes. Context is what lets "at #CloudflareConnect" read as
 * "an SF engineer is at a conference this week".
 */
export async function authorCards(personIds: number[]): Promise<Map<number, string>> {
  const ids = [...new Set(personIds)];
  if (!ids.length) return new Map();
  const [ppl, idRows, snaps, links] = await Promise.all([
    db.select({ id: schema.people.id, name: schema.people.name, notes: schema.people.notes, tracked: schema.people.tracked }).from(schema.people).where(inArray(schema.people.id, ids)),
    db.select({ personId: schema.identities.personId, platform: schema.identities.platform, bio: schema.identities.bio }).from(schema.identities).where(inArray(schema.identities.personId, ids)),
    db.select().from(schema.snapshots).where(inArray(schema.snapshots.personId, ids)).orderBy(desc(schema.snapshots.takenAt)),
    db
      .select({ personId: schema.edges.personId, predicate: schema.edges.predicate, name: schema.entities.name })
      .from(schema.edges)
      .innerJoin(schema.entities, eq(schema.entities.id, schema.edges.entityId))
      .where(inArray(schema.edges.personId, ids)),
  ]);
  const cards = new Map<number, string>();
  for (const p of ppl) {
    const mine = snaps.filter((s) => s.personId === p.id);
    const pick = (k: "headline" | "company" | "location") => mine.find((s) => s[k])?.[k];
    const bios = [...new Set(idRows.filter((i) => i.personId === p.id && i.bio).map((i) => i.bio!.replace(/\s+/g, " ").slice(0, 160)))];
    const graph = links.filter((l) => l.personId === p.id).slice(0, 8).map((l) => `${l.predicate.replace("_", " ")} ${l.name}`);
    const notes = p.notes.replace(/\s+/g, " ").slice(-200);
    cards.set(
      p.id,
      [
        p.name,
        pick("headline") && `headline: ${pick("headline")}`,
        pick("company") && `works at ${pick("company")}`,
        pick("location") && `based in ${pick("location")}`,
        bios.length && `bio: ${bios.join(" | ")}`,
        graph.length && `known: ${graph.join(", ")}`,
        p.tracked && "in the owner's inner circle",
        notes && `owner's notes: ${notes}`,
      ]
        .filter(Boolean)
        .join("; "),
    );
  }
  return cards;
}

/** Turn unenriched posts into events, and LinkedIn snapshot changes into job_change/move events. */
export async function enrich() {
  const pending = await db
    .select({ post: schema.posts, name: schema.people.name })
    .from(schema.posts)
    .innerJoin(schema.people, eq(schema.people.id, schema.posts.personId))
    .where(isNull(schema.posts.enrichedAt));

  // Cheap triage first: a category per post. Only noise is dropped; everything else — life updates,
  // work, whereabouts, interests — goes on to extraction so the paper reflects the whole network.
  const objectives = await db.select({ id: schema.objectives.id, text: schema.objectives.text }).from(schema.objectives);
  const [cards, topics, reader] = await Promise.all([
    authorCards(pending.map((p) => p.post.personId)),
    listWatched(),
    ownerCard(),
  ]);
  const verdicts = await triage(
    pending.map(({ post }) => ({
      text: `[${post.platform}, ${new Date(post.postedAt).toISOString().slice(0, 10)}] ${post.text}`,
      context: cards.get(post.personId),
    })),
    { objectives, topics, reader: reader || undefined },
  );
  await Promise.all(
    pending.map(({ post }, i) => db.update(schema.posts).set({ category: verdicts[i].category }).where(eq(schema.posts.id, post.id))),
  );
  const toExtract = pending.map((p, i) => ({ ...p, verdict: verdicts[i] })).filter((p) => p.verdict.relevant);
  // Mark the noise handled so we don't re-triage it.
  const skipped = pending.filter((_, i) => !verdicts[i].relevant);
  if (skipped.length)
    await db.update(schema.posts).set({ enrichedAt: Date.now() }).where(inArray(schema.posts.id, skipped.map((p) => p.post.id)));

  let created = 0;
  await pMap(toExtract, 5, async ({ post, name, verdict }) => {
    const { output } = await generateText({
      model: EXTRACT_MODEL,
      output: Output.object({ schema: extraction }),
      prompt: `Summarize what this ${post.platform} post by ${name}, posted ${new Date(post.postedAt).toISOString().slice(0, 10)}, says about them. Triage filed it as "${verdict.category}" — for location, say where they are or will be; for interest, say what they're amplifying.\n\nAbout ${name}: ${cards.get(post.personId) ?? "(nothing known yet)"}\n\nPost:\n${post.text}`,
    });
    if (output.relevant) {
      const [ev] = await db
        .insert(schema.events)
        .values({
          personId: post.personId,
          postId: post.id,
          type: output.type,
          category: verdict.category,
          topicIds: verdict.topicIds,
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
