import { integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const now = () => Date.now();

export const people = sqliteTable("people", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  phone: text("phone"),
  tags: text("tags", { mode: "json" }).$type<string[]>().notNull().default([]),
  notes: text("notes").notNull().default(""),
  lastContacted: integer("last_contacted"),
  // Inner circle: only tracked people get scraped and ranked. Imported followings start untracked.
  tracked: integer("tracked", { mode: "boolean" }).notNull().default(false),
  priority: real("priority"),
  priorityReason: text("priority_reason"),
  prioritizedAt: integer("prioritized_at"),
  // Relationship strength 0-100, from measurable signals (recency, mutual, cross-platform, graph closeness, engagement).
  warmth: real("warmth"),
  warmthReason: text("warmth_reason"),
  // Manual "love taps" — survive recompute and add on top of the measured score.
  warmthBoost: real("warmth_boost").notNull().default(0),
});

export const identities = sqliteTable(
  "identities",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    personId: integer("person_id").notNull().references(() => people.id),
    platform: text("platform", { enum: ["bluesky", "x", "linkedin", "instagram"] }).notNull(),
    handle: text("handle").notNull(),
    // Signals from importing the owner's followings, used to prioritize.
    displayName: text("display_name"),
    bio: text("bio"),
    followers: integer("followers"),
    mutual: integer("mutual", { mode: "boolean" }),
    importedAt: integer("imported_at"),
  },
  (t) => [uniqueIndex("identities_platform_handle").on(t.platform, t.handle)],
);

export const posts = sqliteTable("posts", {
  // `${platform}:${nativeId}`
  id: text("id").primaryKey(),
  platform: text("platform").notNull(),
  personId: integer("person_id").notNull().references(() => people.id),
  url: text("url"),
  text: text("text").notNull(),
  postedAt: integer("posted_at").notNull(),
  raw: text("raw_json", { mode: "json" }),
  enrichedAt: integer("enriched_at"),
});

export const snapshots = sqliteTable("snapshots", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  personId: integer("person_id").notNull().references(() => people.id),
  platform: text("platform").notNull(),
  headline: text("headline"),
  company: text("company"),
  location: text("location"),
  takenAt: integer("taken_at").notNull().$defaultFn(now),
  diffedAt: integer("diffed_at"),
});

export type Entities = {
  places: string[];
  companies: string[];
  topics: string[];
  dates: string[];
};

export const EVENT_TYPES = [
  "job_change",
  "move",
  "launch",
  "travel",
  "milestone",
  "ask",
  "event",
  "opinion",
  "other",
] as const;

export const events = sqliteTable("events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  personId: integer("person_id").notNull().references(() => people.id),
  postId: text("post_id").references(() => posts.id),
  type: text("type", { enum: EVENT_TYPES }).notNull(),
  summary: text("summary").notNull(),
  entities: text("entities_json", { mode: "json" }).$type<Entities>().notNull(),
  asks: text("asks_json", { mode: "json" }).$type<string[]>().notNull().default([]),
  offers: text("offers_json", { mode: "json" }).$type<string[]>().notNull().default([]),
  occurredAt: integer("occurred_at").notNull(),
  rankedAt: integer("ranked_at"),
});

export const objectives = sqliteTable("objectives", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  text: text("text").notNull(),
  weight: real("weight").notNull().default(1),
  createdAt: integer("created_at").notNull().$defaultFn(now),
});

export const nudges = sqliteTable("nudges", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  eventId: integer("event_id").notNull().unique().references(() => events.id),
  personId: integer("person_id").notNull().references(() => people.id),
  objectiveId: integer("objective_id").references(() => objectives.id),
  score: real("score").notNull(),
  reason: text("reason").notNull(),
  draft: text("draft").notNull(),
  status: text("status", { enum: ["new", "done", "snoozed", "dismissed"] }).notNull().default("new"),
  snoozedUntil: integer("snoozed_until"),
  createdAt: integer("created_at").notNull().$defaultFn(now),
});

export const matches = sqliteTable(
  "matches",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    personA: integer("person_a").notNull().references(() => people.id),
    personB: integer("person_b").notNull().references(() => people.id),
    shared: text("shared_json", { mode: "json" }).$type<string[]>().notNull(),
    reason: text("reason").notNull(),
    draftIntro: text("draft_intro").notNull(),
    score: real("score").notNull(),
    status: text("status", { enum: ["new", "done", "dismissed"] }).notNull().default("new"),
    createdAt: integer("created_at").notNull().$defaultFn(now),
  },
  (t) => [uniqueIndex("matches_pair").on(t.personA, t.personB)],
);

// ── Event log + knowledge graph (added alongside the derived tables above) ──

/**
 * Append-only log of everything observed, the source of truth the graph is built from.
 * One row per observation; re-imports log only what changed. occurredAt is when it happened in
 * the world (e.g. a connection date), observedAt is when Puentes recorded it.
 */
export const OBSERVATION_KINDS = [
  "connection_made", // you connected with / followed someone
  "profile_observed", // we saw their bio/headline/role at a point in time
  "entities_extracted", // we derived orgs/topics/etc. from their profile or a post
  "post_seen",
  "job_change",
  "moved",
  "note_added",
  "contact_logged",
  "engaged_with", // the owner liked/replied to/reposted this person
  "post_engagement", // engagement counts observed on this person's post
  "listening_trigger", // an announcement/opportunity surfaced by the listening engine
] as const;

export const observations = sqliteTable("observations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  kind: text("kind", { enum: OBSERVATION_KINDS }).notNull(),
  personId: integer("person_id").references(() => people.id),
  source: text("source").notNull(), // linkedin | x | bluesky | manual | owner
  payload: text("payload_json", { mode: "json" }),
  occurredAt: integer("occurred_at"),
  observedAt: integer("observed_at").notNull().$defaultFn(now),
});

/** Typed graph nodes other than people (people are nodes too, stored in `people`). */
export const ENTITY_KINDS = ["org", "school", "topic", "place", "event"] as const;

export const entities = sqliteTable(
  "entities",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    kind: text("kind", { enum: ENTITY_KINDS }).notNull(),
    name: text("name").notNull(), // display form
    key: text("key").notNull(), // normalized form for dedup
    meta: text("meta_json", { mode: "json" }),
    createdAt: integer("created_at").notNull().$defaultFn(now),
  },
  (t) => [uniqueIndex("entities_kind_key").on(t.kind, t.key)],
);

/** person → entity relations. person↔person overlaps are derived from shared entities at query time. */
export const EDGE_PREDICATES = ["works_at", "studied_at", "based_in", "interested_in", "attended", "founded"] as const;

export const edges = sqliteTable(
  "edges",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    personId: integer("person_id").notNull().references(() => people.id),
    predicate: text("predicate", { enum: EDGE_PREDICATES }).notNull(),
    entityId: integer("entity_id").notNull().references(() => entities.id),
    weight: real("weight").notNull().default(1),
    observationId: integer("observation_id").references(() => observations.id),
    firstSeen: integer("first_seen").notNull().$defaultFn(now),
    lastSeen: integer("last_seen").notNull().$defaultFn(now),
  },
  (t) => [uniqueIndex("edges_person_pred_entity").on(t.personId, t.predicate, t.entityId)],
);

/** Tracks which people have had their profile mined into the graph, so backfill is resumable. */
export const graphState = sqliteTable("graph_state", {
  personId: integer("person_id").primaryKey().references(() => people.id),
  extractedAt: integer("extracted_at").notNull().$defaultFn(now),
});

/** The owner's own accounts: who they're signed in as, and when followings were last imported. */
export const accounts = sqliteTable("accounts", {
  platform: text("platform", { enum: ["bluesky", "x", "linkedin", "instagram"] }).primaryKey(),
  handle: text("handle"),
  connectedAt: integer("connected_at"),
  importedAt: integer("imported_at"),
  importedCount: integer("imported_count"),
});
