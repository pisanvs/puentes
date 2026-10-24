import { and, desc, eq, inArray, like, sql } from "drizzle-orm";
import { db, schema } from "../db/client";
import { entityKey } from "./normalize";

const { people, entities, edges } = schema;

export type EntityKind = (typeof schema.entities.$inferSelect)["kind"];
const PREDICATE_FOR: Record<EntityKind, string> = {
  org: "works_at",
  school: "studied_at",
  place: "based_in",
  topic: "interested_in",
  event: "attended",
};

/** The biggest hubs in your network: entities the most people connect to, by kind. */
export async function topEntities(kind?: EntityKind, limit = 20) {
  const rows = await db
    .select({
      id: entities.id,
      kind: entities.kind,
      name: entities.name,
      count: sql<number>`count(distinct ${edges.personId})`.as("count"),
    })
    .from(entities)
    .innerJoin(edges, eq(edges.entityId, entities.id))
    .where(kind ? eq(entities.kind, kind) : sql`1=1`)
    .groupBy(entities.id)
    .orderBy(desc(sql`count`))
    .limit(limit);
  return rows;
}

/** People connected to entities matching a free-text query (e.g. "Stripe", "climate", "New York"). */
export async function peopleAt(query: string, kind?: EntityKind, limit = 50) {
  const key = `%${entityKey(query)}%`;
  const matched = await db
    .select({ id: entities.id, kind: entities.kind, name: entities.name })
    .from(entities)
    .where(and(like(entities.key, key), kind ? eq(entities.kind, kind) : undefined));
  if (matched.length === 0) return { entities: [], people: [] };

  const entityIds = matched.map((e) => e.id);
  const rows = await db
    .select({
      personId: edges.personId,
      name: people.name,
      tracked: people.tracked,
      priority: people.priority,
      predicate: edges.predicate,
      entity: entities.name,
      entityKind: entities.kind,
    })
    .from(edges)
    .innerJoin(people, eq(people.id, edges.personId))
    .innerJoin(entities, eq(entities.id, edges.entityId))
    .where(inArray(edges.entityId, entityIds))
    .orderBy(desc(people.priority))
    .limit(limit);

  return { entities: matched, people: rows };
}

/** Everything the graph knows about one person: their org/school/place/topic/event links. */
export async function personGraph(personId: number) {
  const rows = await db
    .select({ predicate: edges.predicate, kind: entities.kind, name: entities.name })
    .from(edges)
    .innerJoin(entities, eq(entities.id, edges.entityId))
    .where(eq(edges.personId, personId));
  const by = (kind: EntityKind) => rows.filter((r) => r.kind === kind).map((r) => r.name);
  return { orgs: by("org"), schools: by("school"), places: by("place"), topics: by("topic"), events: by("event") };
}

/**
 * Who else in your network shares an entity with this person — the overlap graph.
 * Overlaps are weighted by rarity: sharing a specific employer or cohort counts far more than
 * sharing a broad topic like "software engineering", so distinctive connections rise to the top.
 */
export async function sharedWith(personId: number, limit = 20) {
  const mine = db.select({ entityId: edges.entityId }).from(edges).where(eq(edges.personId, personId));
  // 1 / how many people connect to it → rare entities weigh more.
  const rarity = sql<number>`1.0 / (select count(distinct person_id) from ${edges} e2 where e2.entity_id = ${edges.entityId})`;
  const rows = await db
    .select({
      personId: edges.personId,
      name: people.name,
      tracked: people.tracked,
      shared: sql<string>`group_concat(distinct ${entities.name})`.as("shared"),
      count: sql<number>`count(distinct ${edges.entityId})`.as("count"),
      score: sql<number>`sum(${rarity})`.as("score"),
    })
    .from(edges)
    .innerJoin(people, eq(people.id, edges.personId))
    .innerJoin(entities, eq(entities.id, edges.entityId))
    .where(and(inArray(edges.entityId, mine), sql`${edges.personId} != ${personId}`))
    .groupBy(edges.personId)
    .orderBy(desc(sql`score`))
    .limit(limit);
  return rows.map((r) => ({ ...r, shared: r.shared?.split(",") ?? [] }));
}

export type GraphNode = {
  id: string; // `p<personId>` | `e<entityId>`
  type: "person" | "entity";
  label: string;
  kind?: EntityKind; // entities only
  warmth?: number | null; // people only, raw/uncapped — the UI normalizes it
  tracked?: boolean; // people only — inner circle
  degree?: number; // entities only — distinct people connected
};
export type GraphLink = { source: string; target: string };
export type GraphData = { nodes: GraphNode[]; links: GraphLink[] };

/**
 * A bounded, renderable slice of the knowledge graph for the Network "Map" view: the biggest
 * entity hubs plus the people who connect to them, with the person→entity links between them.
 * The full ~1,300-person graph is unrenderable, so this caps hard: the top `entityLimit` entities
 * by degree, then up to `personLimit` people who touch them (inner circle first, then priority).
 */
export async function graphView(kind?: EntityKind, entityLimit = 40, personLimit = 140): Promise<GraphData> {
  // 1. Top entities by degree (distinct people connected), optionally filtered by kind.
  const topEnts = await db
    .select({
      id: entities.id,
      kind: entities.kind,
      name: entities.name,
      degree: sql<number>`count(distinct ${edges.personId})`.as("degree"),
    })
    .from(entities)
    .innerJoin(edges, eq(edges.entityId, entities.id))
    .where(kind ? eq(entities.kind, kind) : sql`1=1`)
    .groupBy(entities.id)
    .orderBy(desc(sql`degree`))
    .limit(entityLimit);
  if (topEnts.length === 0) return { nodes: [], links: [] };

  const entityIds = topEnts.map((e) => e.id);

  // 2. People connected to those entities — inner circle first, then by priority — capped.
  //    DISTINCT collapses the one-row-per-edge fan-out to one row per person.
  const ppl = await db
    .selectDistinct({
      id: people.id,
      name: people.name,
      warmth: people.warmth,
      tracked: people.tracked,
      priority: people.priority,
    })
    .from(people)
    .innerJoin(edges, eq(edges.personId, people.id))
    .where(inArray(edges.entityId, entityIds))
    .orderBy(desc(people.tracked), desc(people.priority))
    .limit(personLimit);
  if (ppl.length === 0) return { nodes: [], links: [] };

  const personIds = ppl.map((p) => p.id);

  // 3. The person→entity links among the included people and included entities.
  const rawLinks = await db
    .select({ personId: edges.personId, entityId: edges.entityId })
    .from(edges)
    .where(and(inArray(edges.entityId, entityIds), inArray(edges.personId, personIds)));

  const nodes: GraphNode[] = [
    ...ppl.map((p): GraphNode => ({
      id: `p${p.id}`,
      type: "person",
      label: p.name,
      warmth: p.warmth,
      tracked: p.tracked,
    })),
    ...topEnts.map((e): GraphNode => ({
      id: `e${e.id}`,
      type: "entity",
      label: e.name,
      kind: e.kind,
      degree: e.degree,
    })),
  ];
  const links: GraphLink[] = rawLinks.map((l) => ({ source: `p${l.personId}`, target: `e${l.entityId}` }));
  return { nodes, links };
}

/** Coverage stats so the UI/agent can say how much of the network has been mapped. */
export async function graphStats() {
  const [mapped] = await db.select({ n: sql<number>`count(*)` }).from(schema.graphState);
  const [total] = await db.select({ n: sql<number>`count(*)` }).from(people);
  const byKind = await db
    .select({ kind: entities.kind, n: sql<number>`count(*)` })
    .from(entities)
    .groupBy(entities.kind);
  const [edgeCount] = await db.select({ n: sql<number>`count(*)` }).from(edges);
  return {
    mapped: mapped.n,
    totalPeople: total.n,
    edges: edgeCount.n,
    entities: Object.fromEntries(byKind.map((r) => [r.kind, r.n])),
  };
}

export { PREDICATE_FOR };
