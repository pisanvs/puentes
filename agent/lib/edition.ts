import { desc, eq, gte } from "drizzle-orm";
import { db, schema } from "./db/client";
import { listWatched } from "./topics";
import { DAY } from "./util";

const { people, events, nudges, objectives, posts } = schema;

// "Today's edition" covers a rolling window, not just the calendar day — a fresh scrape surfaces
// posts from the last couple of weeks, and an empty front page helps no one. Same-day stories get
// a "today" flag so the masthead can still lead with what's genuinely new.
const WINDOW_DAYS = Number(process.env.EDITION_WINDOW_DAYS ?? 14);

const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const isSameDay = (ms: number) => iso(ms) === iso(Date.now());

export type Story = Awaited<ReturnType<typeof todayEdition>>["stories"][number];

/**
 * The day's front page: every surfaced event in the window, ranked so the ones tied to a nudge
 * (an objective match worth acting on) float to the top. The view groups these into sections and
 * picks the lead; this just assembles the ranked material.
 */
export async function todayEdition() {
  const since = Date.now() - WINDOW_DAYS * DAY;
  const rows = await db
    .select({ event: events, person: people, nudge: nudges, objective: objectives.text, url: posts.url, platform: posts.platform })
    .from(events)
    .innerJoin(people, eq(people.id, events.personId))
    .leftJoin(nudges, eq(nudges.eventId, events.id))
    .leftJoin(objectives, eq(objectives.id, nudges.objectiveId))
    .leftJoin(posts, eq(posts.id, events.postId))
    .where(gte(events.occurredAt, since))
    .orderBy(desc(events.occurredAt));

  const topicName = new Map((await listWatched()).map((t) => [t.id, t.name]));
  const stories = rows
    .map((r) => ({
      eventId: r.event.id,
      personId: r.person.id,
      person: r.person.name,
      type: r.event.type,
      category: r.event.category,
      topics: r.event.topicIds.map((id) => topicName.get(id)).filter((n): n is string => !!n),
      summary: r.event.summary,
      occurredAt: iso(r.event.occurredAt),
      occurredMs: r.event.occurredAt,
      isToday: isSameDay(r.event.occurredAt),
      platform: r.platform ?? r.event.type, // posts carry a platform; snapshot-diff events don't
      sourceUrl: r.url,
      // "Why it matters" only exists for events the ranker turned into a live nudge.
      why: r.nudge?.status === "new" ? r.nudge.reason : null,
      objective: r.nudge?.status === "new" ? r.objective : null,
      score: r.nudge?.status === "new" ? r.nudge.score : 0,
      asks: (r.event.asks ?? []).slice(0, 2),
      offers: (r.event.offers ?? []).slice(0, 2),
      places: r.event.entities?.places ?? [],
    }))
    // Nudged stories first (best objective match leads), then the rest newest-first.
    .sort((a, b) => b.score - a.score || b.occurredMs - a.occurredMs);

  return {
    date: iso(Date.now()),
    sinceDays: WINDOW_DAYS,
    counts: {
      stories: stories.length,
      people: new Set(stories.map((s) => s.personId)).size,
      today: stories.filter((s) => s.isToday).length,
      nudged: stories.filter((s) => s.score > 0).length,
    },
    stories,
  };
}
