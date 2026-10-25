import { generateText, Output } from "ai";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "./db/client";
import { EVENT_TYPES, POST_CATEGORIES } from "./db/schema";
import { EXTRACT_MODEL } from "./models";
import { answerMet } from "./new-people";
import { addNote, findPersonId } from "./queries";

// What the owner tells bridgr directly — the end-of-day dump and every note about a person — is the
// IRL truth scraping can't see, so it's indexed like any other signal: each mention becomes an event
// (timeline, newspaper, who's here), a log observation, and, when they met in person, a warmth impulse
// (via answerMet, which also logs a contact observation that feeds the decay curve).

const entry = z.object({
  name: z.string().describe("The person's name as written."),
  relevant: z.boolean().describe("False if it says nothing beyond trivia — no update, whereabouts, ask, offer, date or fact worth remembering."),
  met: z.boolean().describe("True if the owner actually met or talked with this person, not just mentioned them."),
  where: z.string().nullable().describe("Where they met, if stated, e.g. 'a16z dinner', 'SF'; null if not said."),
  summary: z.string().describe("One sentence, third person, on what's new with them. e.g. 'Ana is raising a seed round.'"),
  type: z.enum(EVENT_TYPES),
  category: z.enum(POST_CATEGORIES).describe("location if it says where they are or will be; life_update for life/career events; professional for work; interest otherwise."),
  asks: z.array(z.string()).describe("What they're looking for (hires, intros, advice)."),
  offers: z.array(z.string()).describe("What they can give."),
  places: z.array(z.string()).describe("Cities/countries mentioned, canonical English names (SF -> San Francisco)."),
  companies: z.array(z.string()),
  topics: z.array(z.string()).describe("2-4 short lowercase topics."),
  dates: z.array(z.string()).describe("ISO dates or ranges mentioned or implied (today is given), e.g. '2026-10-24' or '2027-03'."),
});
type Entry = z.infer<typeof entry>;

export type DumpEntry = { name: string; met: boolean; where: string | null; summary: string; created: boolean };

const today = () => new Date().toISOString().slice(0, 10);

async function extract(text: string, focus?: string) {
  const { output } = await generateText({
    model: EXTRACT_MODEL,
    output: Output.object({ schema: z.object({ entries: z.array(entry) }) }),
    system: focus
      ? `You turn the owner's note about ${focus} into one structured entry about ${focus}. Capture whereabouts, life updates, asks, offers, dates and whether the owner met them. Today is ${today()}. Be faithful; never invent details.`
      : `You turn an owner's free-form note about people they saw or heard about into structured entries — one per distinct person. Capture who they met in person and where, plus any whereabouts, life update, ask, offer or date. Today is ${today()}. Be faithful; never invent details.`,
    prompt: text,
  });
  return focus ? output.entries.slice(0, 1).map((e) => ({ ...e, name: focus })) : output.entries;
}

/** Write one extracted entry for a known person. `fromNote` means the text is already saved as a note. */
async function apply(personId: number, e: Entry, from: "dump" | "note") {
  if (e.met) await answerMet(personId, "met", e.where ?? undefined, { note: from !== "note" });
  if (!e.relevant) return false;
  await db.insert(schema.events).values({
    personId,
    postId: null, // owner-sourced: no post behind it
    type: e.type,
    category: e.category === "non_relevant" ? null : e.category,
    summary: e.summary,
    entities: { places: e.places, companies: e.companies, topics: e.topics, dates: e.dates },
    asks: e.asks,
    offers: e.offers,
    occurredAt: Date.now(),
  });
  await db.insert(schema.observations).values({ kind: "note_added", personId, source: "owner", occurredAt: Date.now(), payload: { summary: e.summary, from } });
  return true;
}

/** Parse a free-form dump into people/events/warmth. Returns what it recorded, for UI feedback. */
export async function parseDump(text: string): Promise<DumpEntry[]> {
  if (!text.trim()) return [];
  const out: DumpEntry[] = [];
  for (const e of await extract(text)) {
    const { id, created } = await findOrCreatePerson(e.name);
    await apply(id, e, "dump");
    out.push({ name: e.name, met: e.met, where: e.where, summary: e.summary, created });
  }
  return out;
}

/** Index a note already saved on a person: whereabouts, updates, asks, dates become a real event. */
export async function indexNote(personId: number, name: string, note: string) {
  const [e] = await extract(note, name);
  if (!e) return null;
  return (await apply(personId, e, "note")) ? { summary: e.summary, category: e.category, places: e.places } : null;
}

/** Save a note on someone AND index it — what both the agent and the person page call. */
export async function noteAndIndex(name: string, note: string) {
  const saved = await addNote(name, note);
  if ("error" in saved) return saved;
  const p = await findPersonId(saved.name);
  const indexed = "id" in p ? await indexNote(p.id, saved.name, note).catch(() => null) : null;
  return { ...saved, indexed };
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
