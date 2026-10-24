import { generateText, Output } from "ai";
import { desc, inArray, notInArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "../db/client";
import { EXTRACT_MODEL } from "../models";
import { cleanName, entityKey } from "./normalize";

const { people, identities, entities, edges, observations, graphState } = schema;

const SAMPLE = Number(process.env.GRAPH_SAMPLE ?? 150);
const BATCH = 12;

const extraction = z.object({
  orgs: z.array(z.string()).describe("Companies/employers, current and past. Not schools."),
  schools: z.array(z.string()).describe("Universities, colleges, bootcamps."),
  places: z.array(z.string()).describe("Cities or countries they're based in or clearly from. Canonical English names."),
  topics: z
    .array(z.string())
    .describe(
      "2-4 SPECIFIC things they work on, lowercase (e.g. 'climate', 'fintech', 'ai agents', 'robotics'). Avoid broad umbrella words like 'ai', 'software engineering', 'technology', 'engineering', 'computer science', 'startups' — they carry no signal.",
    ),
  events: z.array(z.string()).describe("Named programs, fellowships, cohorts or conferences (e.g. 'YC W24', 'Puentes Fellow'). Empty if none."),
  role: z.string().nullable().describe("Their current role/title in a few words, or null."),
});

// predicate for each extracted field
const LINKS = [
  { field: "orgs", predicate: "works_at", kind: "org" },
  { field: "schools", predicate: "studied_at", kind: "school" },
  { field: "places", predicate: "based_in", kind: "place" },
  { field: "topics", predicate: "interested_in", kind: "topic" },
  { field: "events", predicate: "attended", kind: "event" },
] as const;

type Person = { id: number; name: string; bios: string[] };

async function upsertEntity(kind: (typeof schema.entities.$inferInsert)["kind"], name: string) {
  const key = entityKey(name);
  if (!key) return null;
  const [row] = await db
    .insert(entities)
    .values({ kind, name: cleanName(name), key })
    .onConflictDoUpdate({ target: [entities.kind, entities.key], set: { name: cleanName(name) } })
    .returning({ id: entities.id });
  return row.id;
}

/**
 * Mine the owner's network into the graph: for a sample of people, extract orgs/schools/places/
 * topics/events from their bios, log an observation, and create entity + edge rows. Resumable via
 * graph_state, so re-running extends to more people without redoing work.
 */
export async function extractGraph(progress: (m: string) => void = console.log, limit = SAMPLE) {
  const doneIds = (await db.select({ id: graphState.personId }).from(graphState)).map((r) => r.id);

  // Highest-priority people first, skipping anyone already mined.
  const rows = await db
    .select({ id: people.id, name: people.name })
    .from(people)
    .where(doneIds.length ? notInArray(people.id, doneIds) : sql`1=1`)
    .orderBy(desc(people.priority))
    .limit(limit);
  if (rows.length === 0) return { people: 0, entities: 0, edges: 0 };

  const ids = rows.map((r) => r.id);
  const allIdentities = await db.select().from(identities).where(inArray(identities.personId, ids));
  const sample: Person[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    bios: [
      ...new Set(
        allIdentities
          .filter((i) => i.personId === r.id)
          .flatMap((i) => [i.bio, i.displayName])
          .filter((s): s is string => !!s && s.trim().length > 0),
      ),
    ],
  }));

  let entityCount = 0;
  let edgeCount = 0;
  let processed = 0;

  // Batch people per LLM call to keep it cheap.
  for (let i = 0; i < sample.length; i += BATCH) {
    const batch = sample.slice(i, i + BATCH);
    const results = await extractBatch(batch);

    for (const person of batch) {
      const ex = results.get(person.id);
      const [obs] = await db
        .insert(observations)
        .values({
          kind: "entities_extracted",
          personId: person.id,
          source: "profile",
          payload: { bios: person.bios, extracted: ex ?? null },
        })
        .returning({ id: observations.id });

      if (ex) {
        for (const { field, predicate, kind } of LINKS) {
          for (const name of ex[field] ?? []) {
            const entityId = await upsertEntity(kind, name);
            if (!entityId) continue;
            const [edge] = await db
              .insert(edges)
              .values({ personId: person.id, predicate, entityId, observationId: obs.id })
              .onConflictDoUpdate({
                target: [edges.personId, edges.predicate, edges.entityId],
                set: { lastSeen: Date.now() },
              })
              .returning({ id: edges.id });
            if (edge) edgeCount++;
          }
        }
        // `role` stays in the observation payload; it's an attribute, not a graph node.
      }
      await db.insert(graphState).values({ personId: person.id }).onConflictDoNothing();
      processed++;
    }
    progress(`Mapped ${processed}/${sample.length} people into the graph`);
  }

  entityCount = (await db.select({ n: sql<number>`count(*)` }).from(entities))[0].n;
  return { people: processed, entities: entityCount, edges: edgeCount };
}

const batchSchema = z.object({
  people: z.array(extraction.extend({ id: z.number() })),
});

async function extractBatch(batch: Person[]) {
  const withBios = batch.filter((p) => p.bios.length > 0);
  const out = new Map<number, z.infer<typeof extraction>>();
  if (withBios.length === 0) return out;

  const { output } = await generateText({
    model: EXTRACT_MODEL,
    output: Output.object({ schema: batchSchema }),
    system:
      "Extract structured facts from each person's social bio(s). Only include what the bio states or clearly implies. Prefer canonical names (e.g. 'Google' not 'google llc'). Leave arrays empty rather than guessing.",
    prompt: JSON.stringify(withBios.map((p) => ({ id: p.id, name: p.name, bios: p.bios }))),
  });
  for (const p of output.people) {
    const { id, ...rest } = p;
    out.set(id, rest);
  }
  return out;
}
