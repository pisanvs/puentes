import { readFile } from "node:fs/promises";
import { generateText, Output } from "ai";
import { and, desc, eq, gt, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "./db/client";
import type { NearbyEvidence } from "./db/schema";
import { jevAvailable, jevDecide } from "./jev";
import { getOwner, onTrip, ownerCard } from "./me";
import { REASON_MODEL } from "./models";
import { authorCards } from "./pipeline/enrich";
import { listWatched } from "./topics";
import { DAY, pMap } from "./util";

// "Who's here now" (Story 1): while the owner is in a city, find people in their network who are
// there too — either a recent post puts them there (jev reads it with the author's card) or they
// live there — then let the reasoning model pick who's worth meeting given who the owner is and
// what they're after, with a ready-to-send "grab coffee?" draft. Own network only.

const { people, events, posts, identities, snapshots, edges, entities, nearby, objectives } = schema;
const EVENT_WINDOW = 14 * DAY;
const MIN_SCORE = 5;
// "Seen here" is a strong claim shown as a chip — only when jev is fairly sure the post places them here.
const HERE_THRESHOLD = 0.7;

// Metro aliases so "sf" matches "San Francisco", "Bay Area", "Palo Alto"… Matched as whole words.
const METROS: string[][] = [
  ["San Francisco", "sf", "san francisco", "bay area", "sf bay area", "san francisco bay area", "silicon valley", "palo alto", "mountain view", "menlo park", "oakland", "berkeley", "san mateo", "redwood city", "sunnyvale", "san jose", "soma"],
  ["New York", "nyc", "new york", "new york city", "manhattan", "brooklyn"],
  ["Los Angeles", "los angeles", "santa monica", "venice beach"],
  ["London", "london"],
  ["Santiago", "santiago", "santiago de chile", "stgo"],
  ["Mexico City", "mexico city", "cdmx", "ciudad de mexico", "ciudad de méxico"],
  ["Buenos Aires", "buenos aires", "caba"],
  ["São Paulo", "sao paulo", "são paulo"],
  ["Lisbon", "lisbon", "lisboa"],
  ["Berlin", "berlin"],
];

const norm = (s: string) => s.trim().toLowerCase().replace(/,.*$/, "");

/** Canonical name + the aliases to look for, for whatever the owner typed ("sf", "San Francisco, CA"). */
export function resolvePlace(raw: string): { label: string; aliases: string[] } {
  const n = norm(raw);
  const metro = METROS.find(([, ...aliases]) => aliases.includes(n));
  if (metro) return { label: metro[0], aliases: metro.slice(1) };
  return { label: raw.trim().replace(/,.*$/, ""), aliases: [n] };
}

const mentions = (text: string | null | undefined, aliases: string[]) => {
  if (!text) return false;
  const t = text.toLowerCase();
  return aliases.some((a) => new RegExp(`(^|[^\\p{L}\\p{N}])${a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^\\p{L}\\p{N}]|$)`, "u").test(t));
};

/** Where the owner is: their trip when on it, otherwise home. `traveling` gates pushes. */
export async function herePlace() {
  const me = await getOwner();
  if (onTrip(me) && me.trip?.place) return { ...resolvePlace(me.trip.place), traveling: true, from: me.trip.from, to: me.trip.to };
  if (me.homeBase) return { ...resolvePlace(me.homeBase), traveling: false, from: undefined, to: undefined };
  return null;
}

async function voiceGuide() {
  try {
    return await readFile("agent/subagents/drafter/instructions.md", "utf8");
  } catch {
    return "Casual, warm, short.";
  }
}

const verdicts = z.object({
  verdicts: z.array(
    z.object({
      personId: z.number(),
      score: z.number().min(0).max(10).describe("0 skip, 5 worth a coffee, 8+ directly advances an objective or a close friend in town."),
      reason: z.string().describe("One line for the owner: why meet them here, citing the evidence."),
      draft: z.string().describe("A short casual message proposing to meet while both are in the city, in the owner's voice."),
    }),
  ),
});

/** Recompute who's here. Returns what it found; stores worthwhile matches in `nearby`. */
export async function computeNearby() {
  const here = await herePlace();
  if (!here) return { place: null, candidates: 0, matches: 0 };
  const { label, aliases } = here;
  const today = new Date().toISOString().slice(0, 10);
  const evidence = new Map<number, NearbyEvidence[]>();
  const add = (personId: number, e: NearbyEvidence) => evidence.set(personId, [...(evidence.get(personId) ?? []), e]);

  // 1. Recent posts that might put someone here. Prefilter cheaply, then let jev decide with context.
  const recent = await db
    .select({ id: events.id, personId: events.personId, summary: events.summary, type: events.type, category: events.category, entities: events.entities, occurredAt: events.occurredAt, text: posts.text })
    .from(events)
    .leftJoin(posts, eq(posts.id, events.postId))
    .where(gt(events.occurredAt, Date.now() - EVENT_WINDOW));
  // What the owner told us directly (a note, the day dump — events with no post behind them) is first-
  // hand: if it puts someone here, take it as is instead of asking jev to infer it.
  const ownerSaid = recent.filter((e) => e.text == null && (e.entities.places.some((p) => mentions(p, aliases)) || mentions(e.summary, aliases)));
  for (const e of ownerSaid) add(e.personId, { kind: "you_said", detail: e.summary, at: e.occurredAt, eventId: e.id });
  const maybe = recent.filter(
    (e) =>
      e.text != null &&
      (e.category === "location" || e.type === "travel" || e.type === "event" || e.entities.places.some((p) => mentions(p, aliases)) || mentions(e.summary, aliases) || mentions(e.text, aliases)),
  );
  const cards = await authorCards(maybe.map((e) => e.personId));
  const window = here.from || here.to ? `between ${here.from ?? "now"} and ${here.to ?? "now"}` : "this week";
  // Ask about the post, not the person: where they live is separate evidence ("lives here"), and the
  // author card is only there to read the post (e.g. that "Replit's house" is in SF).
  const question = `The post itself shows the author was physically in or around ${label} (its metro area counts) ${window} — attending, visiting or posting from there. Where the author usually lives does not count. Today is ${today}.`;
  const probs = jevAvailable()
    ? await pMap(maybe, 5, (e) =>
        jevDecide(
          [`About the author: ${cards.get(e.personId) ?? "unknown"}`, `Posted ${new Date(e.occurredAt).toISOString().slice(0, 10)}: ${e.summary}`, e.text && `Original post:\n${e.text.slice(0, 800)}`]
            .filter(Boolean)
            .join("\n\n"),
          [{ name: "here", instructions: question }],
        ),
      )
    : maybe.map((e) => ({ here: e.entities.places.some((p) => mentions(p, aliases)) || mentions(e.summary, aliases) ? 1 : 0 }));
  maybe.forEach((e, i) => {
    if ((probs[i].here ?? 0) >= HERE_THRESHOLD) add(e.personId, { kind: "here_now", detail: e.summary, at: e.occurredAt, eventId: e.id });
  });

  // 2. People who live here: profile location, bio, or a based_in edge in the graph.
  const [bios, snaps, based] = await Promise.all([
    db.select({ personId: identities.personId, bio: identities.bio }).from(identities),
    db.select({ personId: snapshots.personId, location: snapshots.location }).from(snapshots),
    db
      .select({ personId: edges.personId, place: entities.name })
      .from(edges)
      .innerJoin(entities, eq(entities.id, edges.entityId))
      .where(and(eq(edges.predicate, "based_in"), eq(entities.kind, "place"))),
  ]);
  const basedHere = new Map<number, string>();
  for (const s of snaps) if (mentions(s.location, aliases)) basedHere.set(s.personId, `profile location: ${s.location}`);
  for (const b of based) if (mentions(b.place, aliases)) basedHere.set(b.personId, `based in ${b.place}`);
  // A school named after a city ("UC Berkeley") says where they studied, not where they live.
  const withoutSchools = (bio: string | null) => bio?.replace(/\b(uc|university of california,?)\s+(berkeley|los angeles|san francisco)\b/gi, "") ?? null;
  for (const b of bios)
    if (!basedHere.has(b.personId) && mentions(withoutSchools(b.bio), aliases))
      basedHere.set(b.personId, `bio mentions ${label}: “${b.bio!.replace(/\s+/g, " ").slice(0, 90)}”`);
  for (const [personId, detail] of basedHere) add(personId, { kind: "based_here", detail });

  if (!evidence.size) return { place: label, candidates: 0, matches: 0 };

  // 3. Rank who's worth meeting, given who the owner is and what they want.
  const ids = [...evidence.keys()];
  const [ppl, allCards, reader, goals, topics, voice] = await Promise.all([
    db.select().from(people).where(inArray(people.id, ids)),
    authorCards(ids),
    ownerCard(),
    db.select({ text: objectives.text }).from(objectives),
    listWatched(),
    voiceGuide(),
  ]);
  // You told us > a post puts them here > they live here.
  const presence = (id: number) => Math.max(...evidence.get(id)!.map((e) => (e.kind === "you_said" ? 2 : e.kind === "here_now" ? 1 : 0)));
  const candidates = ppl
    // People actually seen here first, then the inner circle, then warmth.
    .sort((a, b) => presence(b.id) - presence(a.id) || Number(b.tracked) - Number(a.tracked) || (b.warmth ?? 0) - (a.warmth ?? 0))
    .slice(0, 30);

  const { output } = await generateText({
    model: REASON_MODEL,
    output: Output.object({ schema: verdicts }),
    system: `The owner is ${here.traveling ? "visiting" : "at home in"} ${label}${here.to ? ` until ${here.to}` : ""}. From people in their own network with evidence of being in ${label}, pick who's worth meeting in person while there, given who the owner is, their objectives and the topics they watch. Evidence kinds: you_said = the owner told you directly they're there (strongest — trust it); here_now = a recent post places them there; based_here = they live there. Favor people present now over people who merely live there, and real overlap over generic ones. Never invent evidence. The owner's notes are dated by when they were logged, not when things happened — never claim when the owner last saw someone ("great seeing you today") unless the evidence says so.\n\nWho the owner is: ${reader || "(not filled in)"}\nObjectives: ${goals.map((g) => g.text).join(" | ") || "(none)"}\nWatched topics: ${topics.map((t) => t.name).join(", ") || "(none)"}\n\nOwner's voice:\n${voice}`,
    prompt: JSON.stringify(
      candidates.map((p) => ({
        personId: p.id,
        name: p.name,
        about: allCards.get(p.id),
        innerCircle: p.tracked,
        daysSinceContact: p.lastContacted ? Math.round((Date.now() - p.lastContacted) / DAY) : "never logged",
        evidence: evidence.get(p.id)!.map((e) => ({ ...e, at: e.at ? new Date(e.at).toISOString().slice(0, 10) : undefined })),
      })),
    ),
  });

  let matches = 0;
  for (const v of output.verdicts) {
    if (v.score < MIN_SCORE || !evidence.has(v.personId)) continue;
    const ev = evidence.get(v.personId)!;
    await db
      .insert(nearby)
      .values({ personId: v.personId, place: label, evidence: ev, score: v.score, reason: v.reason, draft: v.draft })
      .onConflictDoUpdate({ target: [nearby.personId, nearby.place], set: { evidence: ev, score: v.score, reason: v.reason, draft: v.draft, updatedAt: Date.now() } });
    matches++;
  }
  return { place: label, candidates: candidates.length, matches };
}

/** The current "who's here" list for the owner's location, best first. */
export async function listNearby(limit = 12) {
  const here = await herePlace();
  if (!here) return { place: null, traveling: false, from: undefined, to: undefined, people: [] };
  const rows = await db
    .select({ n: nearby, name: people.name, phone: people.phone, tracked: people.tracked, warmth: people.warmth })
    .from(nearby)
    .innerJoin(people, eq(people.id, nearby.personId))
    .where(and(eq(nearby.place, here.label), eq(nearby.status, "new")))
    .orderBy(desc(nearby.score))
    .limit(limit);
  return {
    place: here.label,
    traveling: here.traveling,
    from: here.from,
    to: here.to,
    people: rows.map((r) => ({
      id: r.n.id,
      personId: r.n.personId,
      name: r.name,
      tracked: r.tracked,
      score: r.n.score,
      reason: r.n.reason,
      draft: r.n.draft,
      phone: r.phone,
      evidence: r.n.evidence.map((e) => ({ ...e, at: e.at ? new Date(e.at).toISOString().slice(0, 10) : undefined })),
    })),
  };
}

export async function setNearbyStatus(id: number, status: "done" | "dismissed") {
  const [row] = await db.update(nearby).set({ status, updatedAt: Date.now() }).where(eq(nearby.id, id)).returning();
  if (row && status === "done") await db.update(people).set({ lastContacted: Date.now() }).where(eq(people.id, row.personId));
  return row;
}

/** New matches for the owner's current trip that haven't been pushed yet — marked pushed on read. */
export async function takeUnpushedNearby(cap = 3) {
  const here = await herePlace();
  if (!here?.traveling) return [];
  const rows = await db
    .select({ id: nearby.id, name: people.name, phone: people.phone, reason: nearby.reason, draft: nearby.draft })
    .from(nearby)
    .innerJoin(people, eq(people.id, nearby.personId))
    .where(and(eq(nearby.place, here.label), eq(nearby.status, "new"), isNull(nearby.pushedAt)))
    .orderBy(desc(nearby.score))
    .limit(cap);
  if (rows.length) await db.update(nearby).set({ pushedAt: Date.now() }).where(inArray(nearby.id, rows.map((r) => r.id)));
  return rows.map((r) => ({ ...r, place: here.label }));
}
