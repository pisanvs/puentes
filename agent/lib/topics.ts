import { generateText, Output } from "ai";
import { desc, eq, gt, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "./db/client";
import { peopleAt, topEntities } from "./graph/query";
import { jevAvailable, jevDecide } from "./jev";
import { TRIAGE_MODEL } from "./models";
import { DAY, pMap } from "./util";

// The topic inner circle: like tracking people, but for ideas. Each watched topic becomes a jev
// question in triage, so posts about it get tagged (and rank higher) however they're phrased, and
// the owner can read "everything my network said about ai agents this week" in one place.

const { topics, events, people, posts } = schema;
const BACKFILL_WINDOW = 30 * DAY;

export type Topic = typeof topics.$inferSelect;

export const topicQuestion = (name: string) =>
  `The post is substantially about ${name} (the topic itself, not a passing word match).`;

const tagged = (topicId: number) =>
  sql`exists (select 1 from json_each(${events.topicIds}) where json_each.value = ${topicId})`;

export const listWatched = () => db.select().from(topics).orderBy(desc(topics.weight), topics.name);

/** Watched topics with how much the network has said about each, for the Topics page and the agent. */
export async function listTopics() {
  const rows = await listWatched();
  return Promise.all(
    rows.map(async (t) => {
      const [c] = await db
        .select({ stories: sql<number>`count(*)`, people: sql<number>`count(distinct ${events.personId})` })
        .from(events)
        .where(tagged(t.id));
      return { ...t, stories: c?.stories ?? 0, people: c?.people ?? 0 };
    }),
  );
}

/** Start watching a topic and tag recent stories with it right away. */
export async function watchTopic(name: string, weight = 1) {
  const clean = name.trim().replace(/^#/, "");
  if (!clean) throw new Error("Topic name is empty.");
  const [existing] = await db.select().from(topics).where(eq(sql`lower(${topics.name})`, clean.toLowerCase()));
  const topic = existing ?? (await db.insert(topics).values({ name: clean, weight }).returning())[0];
  const backfilled = await tagRecent(topic);
  return { topic, backfilled };
}

export async function unwatchTopic(id: number) {
  const tagged_ = await db.select({ id: events.id, topicIds: events.topicIds }).from(events).where(tagged(id));
  for (const e of tagged_) await db.update(events).set({ topicIds: e.topicIds.filter((t) => t !== id) }).where(eq(events.id, e.id));
  await db.delete(topics).where(eq(topics.id, id));
}

/** Tag the last month of stories with one topic (jev yes/no per story; chat model fallback). */
async function tagRecent(topic: Topic) {
  const rows = await db
    .select({ id: events.id, summary: events.summary, topicIds: events.topicIds, text: posts.text })
    .from(events)
    .leftJoin(posts, eq(posts.id, events.postId))
    .where(gt(events.occurredAt, Date.now() - BACKFILL_WINDOW));
  if (!rows.length) return 0;
  const input = (r: (typeof rows)[number]) => `${r.summary}${r.text ? `\n\nOriginal post:\n${r.text.slice(0, 800)}` : ""}`;

  let hits: number[];
  if (jevAvailable()) {
    const probs = await pMap(rows, 5, (r) => jevDecide(input(r), [{ name: "topic", instructions: topicQuestion(topic.name) }]));
    hits = rows.filter((_, i) => (probs[i].topic ?? 0) >= 0.5).map((r) => r.id);
  } else {
    const { output } = await generateText({
      model: TRIAGE_MODEL,
      output: Output.object({ schema: z.object({ ids: z.array(z.number()) }) }),
      system: `Return the ids of the stories that are substantially about "${topic.name}". Passing mentions don't count.`,
      prompt: JSON.stringify(rows.map((r) => ({ id: r.id, story: input(r) }))),
    });
    hits = output.ids;
  }
  for (const r of rows.filter((r) => hits.includes(r.id) && !r.topicIds.includes(topic.id)))
    await db.update(events).set({ topicIds: [...r.topicIds, topic.id] }).where(eq(events.id, r.id));
  return hits.length;
}

/** Everything about one topic: recent tagged stories plus who in the network cares about it. */
export async function topicFeed(id: number) {
  const [topic] = await db.select().from(topics).where(eq(topics.id, id));
  if (!topic) return null;
  const stories = await db
    .select({ eventId: events.id, personId: people.id, person: people.name, summary: events.summary, category: events.category, occurredAt: events.occurredAt, url: posts.url })
    .from(events)
    .innerJoin(people, eq(people.id, events.personId))
    .leftJoin(posts, eq(posts.id, events.postId))
    .where(tagged(id))
    .orderBy(desc(events.occurredAt))
    .limit(30);
  // Who the graph says works on / cares about this, even if they haven't posted about it lately.
  const graph = await peopleAt(topic.name, "topic", 40);
  const voices = [...new Map(graph.people.map((p) => [p.personId, { personId: p.personId, name: p.name, tracked: p.tracked }])).values()].slice(0, 12);
  return {
    topic,
    stories: stories.map((s) => ({ ...s, occurredAt: new Date(s.occurredAt).toISOString().slice(0, 10) })),
    voices,
  };
}

/** Topics your network clusters around that you're not watching yet. */
export async function topicSuggestions(limit = 12) {
  const watched = new Set((await listWatched()).map((t) => t.name.toLowerCase()));
  return (await topEntities("topic", 40)).filter((e) => !watched.has(e.name.toLowerCase())).slice(0, limit).map((e) => ({ name: e.name, people: e.count }));
}

/** Topic names by id, for rendering tags. */
export async function topicNames(ids: number[]) {
  if (!ids.length) return new Map<number, string>();
  return new Map((await db.select({ id: topics.id, name: topics.name }).from(topics).where(inArray(topics.id, ids))).map((t) => [t.id, t.name]));
}
