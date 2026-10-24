import { generateText, Output } from "ai";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "./db/client";
import { EVENT_TYPES } from "./db/schema";
import { EXTRACT_MODEL } from "./models";
import { answerMet } from "./new-people";

// The free-form end-of-day dump: the owner brain-dumps who they saw and what happened, in plain
// language, and we turn it into structured records — the IRL truth scraping can't see. Each entry
// becomes: the person (created if new), a warmth impulse + "met at <where>" when they met in person
// (via answerMet, which also logs a contact observation that feeds the decay curve), an event (so it
// shows in their timeline and the newspaper), and a log observation.

const entry = z.object({
  name: z.string().describe("The person's name as written."),
  met: z.boolean().describe("True if the owner actually met or talked with this person today, not just mentioned them."),
  where: z.string().nullable().describe("Where they met, if stated, e.g. 'a16z dinner', 'SF', 'the climbing gym'; null if not said."),
  summary: z.string().describe("One sentence, third person, on what's new with them. e.g. 'Ana is raising a seed round.'"),
  type: z.enum(EVENT_TYPES),
  asks: z.array(z.string()).describe("What they're looking for (hires, intros, advice)."),
  offers: z.array(z.string()).describe("What they can give."),
  places: z.array(z.string()),
  companies: z.array(z.string()),
  topics: z.array(z.string()).describe("2-4 short lowercase topics."),
});

export type DumpEntry = { name: string; met: boolean; where: string | null; summary: string; created: boolean };

/** Parse a free-form dump into people/events/warmth. Returns what it recorded, for UI feedback. */
export async function parseDump(text: string): Promise<DumpEntry[]> {
  if (!text.trim()) return [];
  const { output } = await generateText({
    model: EXTRACT_MODEL,
    output: Output.object({ schema: z.object({ entries: z.array(entry) }) }),
    system:
      "You turn an owner's free-form end-of-day note about people they saw or heard about into structured entries — one per distinct person. Capture who they met in person and where, plus any life update, ask or offer. Be faithful; never invent details that aren't there.",
    prompt: text,
  });

  const out: DumpEntry[] = [];
  for (const e of output.entries) {
    const { id, created } = await findOrCreatePerson(e.name);
    // Met in person → warm them up, note where, log a contact observation (feeds the curve + inner circle).
    if (e.met) await answerMet(id, "met", e.where ?? undefined);
    // Record the update as an event so it appears in the timeline and the newspaper.
    await db.insert(schema.events).values({
      personId: id,
      postId: null,
      type: e.type,
      summary: e.summary,
      entities: { places: e.places, companies: e.companies, topics: e.topics, dates: [] },
      asks: e.asks,
      offers: e.offers,
      occurredAt: Date.now(),
    });
    await db.insert(schema.observations).values({ kind: "note_added", personId: id, source: "owner", occurredAt: Date.now(), payload: { summary: e.summary, from: "dump" } });
    out.push({ name: e.name, met: e.met, where: e.where, summary: e.summary, created });
  }
  return out;
}

/** Match an existing person by exact (case-insensitive) name, else create one. */
async function findOrCreatePerson(name: string): Promise<{ id: number; created: boolean }> {
  const q = name.trim();
  const [existing] = await db.select({ id: schema.people.id }).from(schema.people).where(eq(sql`lower(${schema.people.name})`, q.toLowerCase())).limit(1);
  if (existing) return { id: existing.id, created: false };
  try {
    const [row] = await db.insert(schema.people).values({ name: q }).returning({ id: schema.people.id });
    return { id: row.id, created: true };
  } catch {
    // Unique-name race or accent fold: fall back to a fresh exact lookup.
    const [row] = await db.select({ id: schema.people.id }).from(schema.people).where(eq(schema.people.name, q)).limit(1);
    if (row) return { id: row.id, created: false };
    throw new Error(`Could not record "${q}".`);
  }
}
