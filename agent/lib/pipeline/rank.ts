import { readFile } from "node:fs/promises";
import { generateText, Output } from "ai";
import { and, gt, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "../db/client";
import { ownerCard } from "../me";
import { knownPairs } from "../mutuals";
import { REASON_MODEL } from "../models";
import { listWatched } from "../topics";
import { DAY } from "../util";

const LOOKBACK = 21 * DAY;
const TYPE_BOOST: Partial<Record<string, number>> = {
  job_change: 1.5,
  move: 1.5,
  launch: 1.5,
  milestone: 1.5,
  ask: 1,
  travel: 1,
  event: 0.5,
};

async function voiceGuide() {
  try {
    return await readFile("agent/subagents/drafter/instructions.md", "utf8");
  } catch {
    return "Casual, warm, short. No corporate language.";
  }
}

const nudgeVerdicts = z.object({
  verdicts: z.array(
    z.object({
      eventId: z.number(),
      objectiveId: z.number().nullable().describe("The objective this serves best, or null if it's just a good reason to say hi."),
      relevance: z.number().min(0).max(10),
      reason: z.string().describe("One line for the owner: why reach out now."),
      draft: z.string().describe("A ready-to-send message to the friend in the owner's voice, 1-3 sentences."),
    }),
  ),
});

/** Score unranked events against the owner's objectives and store the worthwhile ones as nudges. */
export async function rankNudges() {
  const since = Date.now() - LOOKBACK;
  const fresh = await db
    .select()
    .from(schema.events)
    .where(and(isNull(schema.events.rankedAt), gt(schema.events.occurredAt, since)));
  if (fresh.length === 0) return { scored: 0, nudges: 0 };

  const objectives = await db.select().from(schema.objectives);
  const people = new Map(
    (
      await db
        .select()
        .from(schema.people)
        .where(inArray(schema.people.id, [...new Set(fresh.map((e) => e.personId))]))
    ).map((p) => [p.id, p]),
  );
  const [voice, reader, watched] = await Promise.all([voiceGuide(), ownerCard(), listWatched()]);
  const topicById = new Map(watched.map((t) => [t.id, t]));
  const byId = new Map(fresh.map((e) => [e.id, e]));
  let created = 0;

  for (let i = 0; i < fresh.length; i += 15) {
    const batch = fresh.slice(i, i + 15);
    const { output } = await generateText({
      model: REASON_MODEL,
      output: Output.object({ schema: nudgeVerdicts }),
      system: `You help the owner keep up with friends. Score each friend update for how worth reaching out about it is, given who the owner is, their objectives and the topics they watch. 0 = noise, 5 = nice reason to say hi, 8+ = directly advances an objective, touches a watched topic the owner can add to, or is a big life moment. Drafts are messages the owner sends to the friend; ground them in what the owner and friend actually share. Notes are dated by when the owner logged them, not when things happened — never claim when they last met unless the update says so.${reader ? `\n\nWho the owner is: ${reader}` : ""}\n\nOwner's voice:\n${voice}`,
      prompt: JSON.stringify({
        objectives: objectives.map((o) => ({ id: o.id, text: o.text })),
        updates: batch.map((e) => {
          const p = people.get(e.personId)!;
          return {
            eventId: e.id,
            friend: p.name,
            tags: p.tags,
            notes: p.notes,
            daysSinceContact: p.lastContacted ? Math.round((Date.now() - p.lastContacted) / DAY) : "never logged",
            type: e.type,
            summary: e.summary,
            entities: e.entities,
            asks: e.asks,
            watchedTopics: e.topicIds.map((id) => topicById.get(id)?.name).filter(Boolean),
          };
        }),
      }),
    });

    for (const v of output.verdicts) {
      const e = byId.get(v.eventId);
      if (!e || v.relevance < 4) continue;
      const p = people.get(e.personId)!;
      const weight = objectives.find((o) => o.id === v.objectiveId)?.weight ?? 1;
      const daysSince = p.lastContacted ? (Date.now() - p.lastContacted) / DAY : 90;
      const score =
        v.relevance * weight +
        Math.min(daysSince, 90) / 30 +
        Math.max(0, 2 - (Date.now() - e.occurredAt) / (7 * DAY)) +
        (TYPE_BOOST[e.type] ?? 0) +
        // Watched topics pull a story up, scaled by how much the owner cares about the topic.
        Math.min(2, e.topicIds.reduce((s, id) => s + 0.75 * (topicById.get(id)?.weight ?? 0), 0));

      await db
        .insert(schema.nudges)
        .values({
          eventId: e.id,
          personId: e.personId,
          objectiveId: v.objectiveId,
          score,
          reason: v.reason,
          draft: v.draft,
        })
        .onConflictDoNothing();
      created++;
    }
    await db
      .update(schema.events)
      .set({ rankedAt: Date.now() })
      .where(inArray(schema.events.id, batch.map((e) => e.id)));
  }
  return { scored: fresh.length, nudges: created };
}

const ENTITY_WEIGHT = { places: 2, companies: 1.5, topics: 1 } as const;
const norm = (s: string) => s.trim().toLowerCase();

const matchVerdicts = z.object({
  verdicts: z.array(
    z.object({
      index: z.number(),
      worthIntro: z.boolean(),
      score: z.number().min(0).max(10),
      reason: z.string().describe("One line for the owner: why these two should meet now."),
      draftIntro: z.string().describe("A short double-opt-in intro message the owner could send to both."),
    }),
  ),
});

/** Pair friends whose recent updates overlap (same city, company, topic, or ask↔offer) and keep the good intros. */
export async function rankMatches() {
  const since = Date.now() - LOOKBACK;
  const recent = await db.select().from(schema.events).where(gt(schema.events.occurredAt, since));
  const names = new Map((await db.select().from(schema.people)).map((p) => [p.id, p.name]));
  // Skip pairs already handled, and pairs who already know each other (a resolved mutual on a profile).
  const done = new Set([...(await db.select().from(schema.matches)).map((m) => `${m.personA}:${m.personB}`), ...(await knownPairs())]);

  // entity -> people who mentioned it
  const index = new Map<string, Set<number>>();
  for (const e of recent) {
    for (const kind of Object.keys(ENTITY_WEIGHT) as (keyof typeof ENTITY_WEIGHT)[]) {
      for (const value of e.entities[kind] ?? []) {
        const key = `${kind}:${norm(value)}`;
        if (!index.has(key)) index.set(key, new Set());
        index.get(key)!.add(e.personId);
      }
    }
  }

  const pairs = new Map<string, { a: number; b: number; shared: string[]; score: number }>();
  const addPair = (x: number, y: number, label: string, weight: number) => {
    if (x === y) return;
    const [a, b] = x < y ? [x, y] : [y, x];
    const key = `${a}:${b}`;
    if (done.has(key)) return;
    const pair = pairs.get(key) ?? { a, b, shared: [], score: 0 };
    pair.shared.push(label);
    pair.score += weight;
    pairs.set(key, pair);
  };

  for (const [key, ids] of index) {
    if (ids.size < 2 || ids.size > 8) continue; // skip hyper-common entities like "ai"
    const [kind, value] = key.split(/:(.*)/s) as [keyof typeof ENTITY_WEIGHT, string];
    const list = [...ids];
    for (let i = 0; i < list.length; i++)
      for (let j = i + 1; j < list.length; j++) addPair(list[i], list[j], `${kind.slice(0, -1)}: ${value}`, ENTITY_WEIGHT[kind]);
  }

  // Anyone asking for something × anyone offering something: let the model judge the fit.
  const askers = recent.filter((e) => e.asks.length);
  const offerers = recent.filter((e) => e.offers.length);
  for (const ask of askers)
    for (const offer of offerers)
      addPair(ask.personId, offer.personId, `ask "${ask.asks[0]}" ↔ offer "${offer.offers[0]}"`, 1);

  const candidates = [...pairs.values()].sort((x, y) => y.score - x.score).slice(0, 20);
  if (candidates.length === 0) return { candidates: 0, matches: 0 };

  const context = (id: number) =>
    recent.filter((e) => e.personId === id).map((e) => ({ summary: e.summary, asks: e.asks, offers: e.offers }));

  const reader = await ownerCard();
  const { output } = await generateText({
    model: REASON_MODEL,
    output: Output.object({ schema: matchVerdicts }),
    system: `You spot serendipitous introductions between the owner's friends. Only say worthIntro when both people would plausibly thank the owner for it. Shared generic topics alone are not enough.${reader ? `\n\nWho the owner is (the intro comes from them, in their voice): ${reader}` : ""}`,
    prompt: JSON.stringify(
      candidates.map((c, i) => ({
        index: i,
        a: { name: names.get(c.a), updates: context(c.a) },
        b: { name: names.get(c.b), updates: context(c.b) },
        overlap: c.shared,
      })),
    ),
  });

  let created = 0;
  for (const v of output.verdicts) {
    const c = candidates[v.index];
    if (!c || !v.worthIntro) continue;
    await db
      .insert(schema.matches)
      .values({ personA: c.a, personB: c.b, shared: c.shared, reason: v.reason, draftIntro: v.draftIntro, score: v.score })
      .onConflictDoNothing();
    created++;
  }
  return { candidates: candidates.length, matches: created };
}
