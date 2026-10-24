import { eq } from "drizzle-orm";
import { db, schema } from "./db/client";

// Who bridgr works for. Objectives say what the owner wants this month; this says who they are —
// role, home base, where they are right now, what they're building and care about, plus facts the
// agent picks up in conversation. Compiled into a "reader card" that triage, ranking and drafts all
// read, so "an SF founder is hiring" lands differently for someone visiting SF this week.

const { owner } = schema;

export type Owner = typeof owner.$inferSelect;
export type OwnerPatch = Partial<Pick<Owner, "name" | "headline" | "homeBase" | "about" | "trip">>;

const EMPTY: Owner = { id: 1, name: "", headline: "", homeBase: "", about: "", trip: null, facts: [], updatedAt: 0 };

export async function getOwner(): Promise<Owner> {
  const [row] = await db.select().from(owner).where(eq(owner.id, 1));
  return row ?? EMPTY;
}

export async function saveOwner(patch: OwnerPatch) {
  const clean = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) as OwnerPatch;
  await db
    .insert(owner)
    .values({ ...EMPTY, ...clean, updatedAt: Date.now() })
    .onConflictDoUpdate({ target: owner.id, set: { ...clean, updatedAt: Date.now() } });
  return getOwner();
}

/** Remember one thing about the owner (from chat or the dump). Dedupes, keeps the latest 40. */
export async function rememberFact(fact: string) {
  const f = fact.trim();
  if (!f) return getOwner();
  const me = await getOwner();
  const facts = [...me.facts.filter((x) => x.toLowerCase() !== f.toLowerCase()), f].slice(-40);
  await db
    .insert(owner)
    .values({ ...me, id: 1, facts, updatedAt: Date.now() })
    .onConflictDoUpdate({ target: owner.id, set: { facts, updatedAt: Date.now() } });
  return getOwner();
}

/** Replace the learned facts wholesale (e.g. the owner deleted one). */
export async function saveOwnerFacts(facts: string[]) {
  const me = await getOwner();
  await db
    .insert(owner)
    .values({ ...me, id: 1, facts, updatedAt: Date.now() })
    .onConflictDoUpdate({ target: owner.id, set: { facts, updatedAt: Date.now() } });
}

const today = () => new Date().toISOString().slice(0, 10);

/** Is the owner on their trip right now (by ISO dates; a trip without dates counts as current)? */
export function onTrip(me: Owner) {
  const t = me.trip;
  if (!t?.place) return false;
  const d = today();
  return (!t.from || t.from <= d) && (!t.to || d <= t.to);
}

/** One paragraph about the owner for any model to read. Empty string when nothing is known yet. */
export async function ownerCard(): Promise<string> {
  const me = await getOwner();
  const trip = me.trip?.place
    ? `${onTrip(me) ? "currently in" : "planning a trip to"} ${me.trip.place}${me.trip.from || me.trip.to ? ` (${me.trip.from ?? "?"} to ${me.trip.to ?? "?"})` : ""}`
    : "";
  return [
    me.name,
    me.headline,
    me.homeBase && `based in ${me.homeBase}`,
    trip,
    me.about && `about: ${me.about.replace(/\s+/g, " ").slice(0, 600)}`,
    me.facts.length && `known facts: ${me.facts.slice(-12).join("; ")}`,
  ]
    .filter(Boolean)
    .join("; ");
}
