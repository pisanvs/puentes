import { aliasedTable, and, desc, eq, inArray, like, lte, or, sql } from "drizzle-orm";
import { db, schema } from "./db/client";
import { personGraph, sharedWith } from "./graph/query";
import { mutualsFor } from "./mutuals";
import { DAY } from "./util";
import { isInnerCircle, rawForNorm } from "./warmth-curve";

const { people, events, nudges, matches, objectives, identities, posts, snapshots, observations } = schema;

const daysAgo = (ms: number | null) => (ms ? Math.round((Date.now() - ms) / DAY) : null);

type Person = typeof people.$inferSelect;

/** Exact name, else names with a word starting with the query ("ana" → Ana Rivera, not Kenji Watanabe). */
async function findPerson(name: string): Promise<Person | { error: string }> {
  const q = name.trim().toLowerCase();
  const rows = await db
    .select()
    .from(people)
    .where(or(like(sql`lower(${people.name})`, `${q}%`), like(sql`lower(${people.name})`, `% ${q}%`)));
  const exact = rows.find((r) => r.name.toLowerCase() === q);
  if (exact || rows.length === 1) return exact ?? rows[0];
  if (rows.length === 0) return { error: `No one named "${name}" in the inner circle.` };
  return { error: `"${name}" is ambiguous: ${rows.map((r) => r.name).join(", ")}. Ask which one.` };
}

/** Tools return lookup problems as data so the model can see them and ask the owner. */
async function withPerson<T>(name: string, fn: (p: Person) => Promise<T>) {
  const p = await findPerson(name);
  return "error" in p ? p : fn(p);
}

/** Resolve a name to an id, or an {error} the model can relay. */
export async function findPersonId(name: string): Promise<{ id: number } | { error: string }> {
  const p = await findPerson(name);
  return "error" in p ? p : { id: p.id };
}

export async function getNudges(limit = 5) {
  // Wake snoozed nudges whose time has come.
  await db
    .update(nudges)
    .set({ status: "new", snoozedUntil: null })
    .where(and(eq(nudges.status, "snoozed"), lte(nudges.snoozedUntil, Date.now())));

  const rows = await db
    .select({ nudge: nudges, person: people, event: events, objective: objectives.text, url: posts.url, platform: posts.platform })
    .from(nudges)
    .innerJoin(people, eq(people.id, nudges.personId))
    .innerJoin(events, eq(events.id, nudges.eventId))
    .leftJoin(objectives, eq(objectives.id, nudges.objectiveId))
    .leftJoin(posts, eq(posts.id, events.postId))
    .where(eq(nudges.status, "new"))
    .orderBy(desc(nudges.score))
    .limit(limit);

  return rows.map((r) => ({
    nudgeId: r.nudge.id,
    personId: r.person.id,
    person: r.person.name,
    type: r.event.type,
    platform: r.platform,
    update: r.event.summary,
    when: new Date(r.event.occurredAt).toISOString().slice(0, 10),
    reason: r.nudge.reason,
    objective: r.objective,
    draft: r.nudge.draft,
    sendLink: r.person.phone ? waLink(r.person.phone, r.nudge.draft) : null,
    sourceUrl: r.url,
    daysSinceContact: daysAgo(r.person.lastContacted),
  }));
}

export function waLink(phone: string, text: string) {
  return `https://wa.me/${phone.replace(/\D/g, "")}?text=${encodeURIComponent(text)}`;
}

export async function setNudgeStatus(nudgeId: number, status: "done" | "dismissed") {
  const [n] = await db.update(nudges).set({ status }).where(eq(nudges.id, nudgeId)).returning();
  if (!n) throw new Error(`No nudge ${nudgeId}.`);
  if (status === "done") await db.update(people).set({ lastContacted: Date.now() }).where(eq(people.id, n.personId));
  return n;
}

export async function snoozeNudge(nudgeId: number, days: number) {
  const [n] = await db
    .update(nudges)
    .set({ status: "snoozed", snoozedUntil: Date.now() + days * DAY })
    .where(eq(nudges.id, nudgeId))
    .returning();
  if (!n) throw new Error(`No nudge ${nudgeId}.`);
  return n;
}

export async function getMatches(limit = 3) {
  const a = aliasedTable(people, "a");
  const b = aliasedTable(people, "b");
  const rows = await db
    .select({ match: matches, a: a.name, b: b.name, aId: a.id, bId: b.id })
    .from(matches)
    .innerJoin(a, eq(a.id, matches.personA))
    .innerJoin(b, eq(b.id, matches.personB))
    .where(eq(matches.status, "new"))
    .orderBy(desc(matches.score))
    .limit(limit);
  return rows.map((r) => ({
    matchId: r.match.id,
    people: [r.a, r.b],
    personIds: [r.aId, r.bId],
    overlap: r.match.shared,
    reason: r.match.reason,
    draftIntro: r.match.draftIntro,
  }));
}

export async function setMatchStatus(matchId: number, status: "done" | "dismissed") {
  const [m] = await db.update(matches).set({ status }).where(eq(matches.id, matchId)).returning();
  if (!m) throw new Error(`No match ${matchId}.`);
  if (status === "done")
    await db.update(people).set({ lastContacted: Date.now() }).where(inArray(people.id, [m.personA, m.personB]));
  return m;
}

export const getPerson = (name: string) => withPerson(name, personDetail);

export async function getPersonById(id: number) {
  const [p] = await db.select().from(people).where(eq(people.id, id));
  return p ? personDetail(p) : null;
}

async function personDetail(p: Person) {
  const [handles, timeline, open] = await Promise.all([
    db.select({ platform: identities.platform, handle: identities.handle }).from(identities).where(eq(identities.personId, p.id)),
    db
      .select({ type: events.type, summary: events.summary, occurredAt: events.occurredAt, url: posts.url })
      .from(events)
      .leftJoin(posts, eq(posts.id, events.postId))
      .where(eq(events.personId, p.id))
      .orderBy(desc(events.occurredAt))
      .limit(15),
    db.select({ id: nudges.id, reason: nudges.reason }).from(nudges).where(and(eq(nudges.personId, p.id), eq(nudges.status, "new"))),
  ]);
  return {
    name: p.name,
    tags: p.tags,
    notes: p.notes,
    phone: p.phone,
    daysSinceContact: daysAgo(p.lastContacted),
    warmth: p.warmth,
    warmthReason: p.warmthReason,
    handles,
    timeline: timeline.map((t) => ({ ...t, occurredAt: new Date(t.occurredAt).toISOString().slice(0, 10) })),
    id: p.id,
    tracked: p.tracked,
    priorityReason: p.priorityReason,
    openNudges: open,
    // People you both know, as their profiles show it — useful for "who could introduce us" and context.
    inCommon: (await mutualsFor(p.id)).map((m) => ({
      platform: m.platform,
      total: m.total,
      followsYou: m.followsYou,
      named: m.shown.map((s) => s.name ?? s.label),
    })),
  };
}

/**
 * The full dossier for one person: everything we've scraped (identities, profile snapshots, raw
 * posts, derived events, the raw observation log) plus related material (graph links, people who
 * share entities with them, open intros). Heavier than personDetail — this is for the web page, not
 * the agent tools.
 */
export async function getPersonDossier(id: number) {
  const [p] = await db.select().from(people).where(eq(people.id, id));
  if (!p) return null;

  const a = aliasedTable(people, "a");
  const b = aliasedTable(people, "b");
  const [ids, snaps, rawPosts, evs, obs, graph, related, mrows, pc, ec, oc] = await Promise.all([
    db.select().from(identities).where(eq(identities.personId, id)),
    db.select().from(snapshots).where(eq(snapshots.personId, id)).orderBy(desc(snapshots.takenAt)).limit(12),
    db
      .select({ platform: posts.platform, text: posts.text, url: posts.url, postedAt: posts.postedAt })
      .from(posts)
      .where(eq(posts.personId, id))
      .orderBy(desc(posts.postedAt))
      .limit(40),
    db
      .select({ type: events.type, summary: events.summary, occurredAt: events.occurredAt, entities: events.entities, asks: events.asks, offers: events.offers, url: posts.url })
      .from(events)
      .leftJoin(posts, eq(posts.id, events.postId))
      .where(eq(events.personId, id))
      .orderBy(desc(events.occurredAt))
      .limit(30),
    db
      .select({ kind: observations.kind, source: observations.source, observedAt: observations.observedAt, occurredAt: observations.occurredAt, payload: observations.payload })
      .from(observations)
      .where(eq(observations.personId, id))
      .orderBy(desc(observations.observedAt))
      .limit(60),
    personGraph(id),
    sharedWith(id, 8),
    db
      .select({ match: matches, aId: a.id, aName: a.name, bId: b.id, bName: b.name })
      .from(matches)
      .innerJoin(a, eq(a.id, matches.personA))
      .innerJoin(b, eq(b.id, matches.personB))
      .where(and(or(eq(matches.personA, id), eq(matches.personB, id)), eq(matches.status, "new"))),
    db.select({ n: sql<number>`count(*)` }).from(posts).where(eq(posts.personId, id)),
    db.select({ n: sql<number>`count(*)` }).from(events).where(eq(events.personId, id)),
    db.select({ n: sql<number>`count(*)` }).from(observations).where(eq(observations.personId, id)),
  ]);

  // Current profile = newest non-null value for each field across platforms.
  const field = (k: "headline" | "company" | "location") => snaps.find((s) => s[k])?.[k] ?? null;
  // Dedup asks/offers across events.
  const flat = (k: "asks" | "offers") => [...new Set(evs.flatMap((e) => e[k] ?? []))].filter(Boolean);

  // Warm-ups that drive the decay curve: contacts, engagement, notes, and the first connection/import.
  const REINFORCE = new Set(["connection_made", "contact_logged", "engaged_with", "note_added"]);
  const reinforcements = [
    ...obs.filter((o) => REINFORCE.has(o.kind)).map((o) => o.occurredAt ?? o.observedAt),
    ...(p.lastContacted ? [p.lastContacted] : []),
    ...ids.map((i) => i.importedAt).filter((x): x is number => x != null),
  ].sort((x, y) => x - y);

  return {
    id: p.id,
    name: p.name,
    tags: p.tags,
    notes: p.notes,
    phone: p.phone,
    tracked: p.tracked,
    pinned: p.pinned,
    reinforcements,
    warmth: p.warmth,
    warmthReason: p.warmthReason,
    daysSinceContact: daysAgo(p.lastContacted),
    priorityReason: p.priorityReason,
    current: { headline: field("headline"), company: field("company"), location: field("location") },
    identities: ids.map((i) => ({
      platform: i.platform,
      handle: i.handle,
      displayName: i.displayName,
      bio: i.bio,
      followers: i.followers,
      mutual: i.mutual,
    })),
    snapshots: snaps.map((s) => ({ platform: s.platform, headline: s.headline, company: s.company, location: s.location, takenAt: new Date(s.takenAt).toISOString().slice(0, 10) })),
    posts: rawPosts.map((r) => ({ ...r, postedAt: new Date(r.postedAt).toISOString().slice(0, 10) })),
    timeline: evs.map((e) => ({
      type: e.type,
      summary: e.summary,
      occurredAt: new Date(e.occurredAt).toISOString().slice(0, 10),
      places: e.entities?.places ?? [],
      asks: e.asks ?? [],
      url: e.url,
    })),
    graph,
    asks: flat("asks"),
    offers: flat("offers"),
    related: related.map((r) => ({ personId: r.personId, name: r.name, tracked: r.tracked, shared: r.shared, score: r.score })),
    matches: mrows.map((r) => {
      const self = r.aId === id;
      return { matchId: r.match.id, otherId: self ? r.bId : r.aId, otherName: self ? r.bName : r.aName, shared: r.match.shared, reason: r.match.reason };
    }),
    observations: obs.map((o) => ({
      kind: o.kind,
      source: o.source,
      when: new Date(o.occurredAt ?? o.observedAt).toISOString().slice(0, 10),
      summary: (o.payload as { summary?: string } | null)?.summary ?? null,
    })),
    counts: { posts: pc[0].n, events: ec[0].n, observations: oc[0].n, identities: ids.length },
    inCommon: await mutualsFor(id),
  };
}

/** Everyone in the inner circle, stalest contact first, with their latest update. */
export async function listPeople() {
  const [rows, latest, open, handles] = await Promise.all([
    db.select().from(people).where(eq(people.tracked, true)),
    db.select({ personId: events.personId, summary: events.summary, occurredAt: events.occurredAt }).from(events).orderBy(desc(events.occurredAt)),
    db.select({ personId: nudges.personId }).from(nudges).where(eq(nudges.status, "new")),
    db.select({ personId: identities.personId, platform: identities.platform }).from(identities),
  ]);
  return rows
    .map((p) => {
      const last = latest.find((e) => e.personId === p.id);
      return {
        id: p.id,
        name: p.name,
        tags: p.tags,
        pinned: p.pinned,
        daysSinceContact: daysAgo(p.lastContacted),
        warmth: p.warmth,
        warmthReason: p.warmthReason,
        openNudges: open.filter((n) => n.personId === p.id).length,
        platforms: handles.filter((h) => h.personId === p.id).map((h) => h.platform),
        lastUpdate: last ? { summary: last.summary, occurredAt: new Date(last.occurredAt).toISOString().slice(0, 10) } : null,
      };
    })
    // Pinned ("keep warm") float to the top; within each group, stalest contact first.
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || (b.daysSinceContact ?? 9999) - (a.daysSinceContact ?? 9999));
}

/** Search recent events by free text over summaries and entities (city, company, topic). */
export async function searchPeople(query: string, limit = 10) {
  const q = `%${query.trim().toLowerCase()}%`;
  const rows = await db
    .select({ name: people.name, summary: events.summary, occurredAt: events.occurredAt })
    .from(events)
    .innerJoin(people, eq(people.id, events.personId))
    .where(
      or(
        like(sql`lower(${events.summary})`, q),
        like(sql`lower(${events.entities})`, q),
        like(sql`lower(${people.tags})`, q),
        like(sql`lower(${people.notes})`, q),
      ),
    )
    .orderBy(desc(events.occurredAt))
    .limit(limit);
  return rows.map((r) => ({ ...r, occurredAt: new Date(r.occurredAt).toISOString().slice(0, 10) }));
}

export const addNote = (name: string, note: string) => withPerson(name, async (p) => {
  const notes = [p.notes, `[${new Date().toISOString().slice(0, 10)}] ${note}`].filter(Boolean).join("\n");
  await db.update(people).set({ notes }).where(eq(people.id, p.id));
  return { name: p.name, notes };
});

export const logContact = (name: string, daysAgoCount = 0) => withPerson(name, async (p) => {
  const at = Date.now() - daysAgoCount * DAY;
  await db.update(people).set({ lastContacted: at }).where(eq(people.id, p.id));
  // Anything still open for them is now handled — follow-ups and "they're here" alike.
  await db.update(nudges).set({ status: "done" }).where(and(eq(nudges.personId, p.id), eq(nudges.status, "new")));
  await db.update(schema.nearby).set({ status: "done", updatedAt: Date.now() }).where(and(eq(schema.nearby.personId, p.id), eq(schema.nearby.status, "new")));
  return { name: p.name, lastContacted: new Date(at).toISOString().slice(0, 10) };
});

export const listObjectives = () => db.select({ id: objectives.id, text: objectives.text, weight: objectives.weight }).from(objectives);

export async function setObjective(text: string, weight = 1, id?: number) {
  if (id) {
    const [o] = await db.update(objectives).set({ text, weight }).where(eq(objectives.id, id)).returning();
    if (!o) throw new Error(`No objective ${id}.`);
    return o;
  }
  const [o] = await db.insert(objectives).values({ text, weight }).returning();
  return o;
}

export async function removeObjective(id: number) {
  await db.update(nudges).set({ objectiveId: null }).where(eq(nudges.objectiveId, id));
  const [o] = await db.delete(objectives).where(eq(objectives.id, id)).returning();
  if (!o) throw new Error(`No objective ${id}.`);
  return o;
}

/** Objectives changed: let the next pipeline run re-score recent events. */
export async function resetRanking() {
  await db.delete(nudges).where(eq(nudges.status, "new"));
  await db.update(events).set({ rankedAt: null });
}

/** Imported followings not yet in the inner circle, best candidates first. */
export async function listSuggestions(limit = 100) {
  const rows = await db
    .select()
    .from(people)
    .where(eq(people.tracked, false))
    .orderBy(desc(people.priority))
    .limit(limit);
  const ids = rows.map((r) => r.id);
  const handles = ids.length ? await db.select().from(identities).where(inArray(identities.personId, ids)) : [];
  return rows.map((p) => {
    const own = handles.filter((h) => h.personId === p.id);
    return {
      id: p.id,
      name: p.name,
      reason: p.priorityReason,
      priority: p.priority,
      mutual: own.some((h) => h.mutual),
      bio: own.map((h) => h.bio).find(Boolean) ?? null,
      handles: own.map((h) => ({ platform: h.platform, handle: h.handle, followers: h.followers })),
    };
  });
}

export async function countSuggestions() {
  const [row] = await db.select({ n: sql<number>`count(*)` }).from(people).where(eq(people.tracked, false));
  return row.n;
}

export async function setTracked(personId: number, tracked: boolean) {
  await db.update(people).set({ tracked }).where(eq(people.id, personId));
}

/** Add manual warmth "love taps" (raw, uncapped — the sigmoid handles saturation). Updates inner circle. */
export async function addWarmthBoost(personId: number, amount: number) {
  const [row] = await db
    .update(people)
    .set({ warmthBoost: sql`${people.warmthBoost} + ${amount}`, warmth: sql`coalesce(${people.warmth}, 0) + ${amount}` })
    .where(eq(people.id, personId))
    .returning({ warmth: people.warmth, boost: people.warmthBoost });
  if (row) await db.update(people).set({ tracked: isInnerCircle(row.warmth) }).where(eq(people.id, personId));
  return row ?? null;
}

/** Pin/unpin someone as "keep warm". */
export async function setPinned(personId: number, pinned: boolean) {
  await db.update(people).set({ pinned }).where(eq(people.id, personId));
}

/** Add or remove someone from the inner circle by nudging their warmth across the cutoff. */
export async function setInnerCircle(personId: number, inside: boolean) {
  const [p] = await db.select().from(people).where(eq(people.id, personId));
  if (!p) return null;
  const current = p.warmth ?? 0;
  const target = inside ? rawForNorm(0.62) : rawForNorm(0.3); // land clearly inside / outside
  const delta = target - current;
  await db
    .update(people)
    .set({ warmthBoost: sql`${people.warmthBoost} + ${delta}`, warmth: target, tracked: isInnerCircle(target) })
    .where(eq(people.id, personId));
  return { warmth: target, tracked: inside };
}
