import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "./db/client";

export type Platform = (typeof schema.identities.$inferInsert)["platform"];

/** Someone the owner follows / is connected to, as read from a platform. */
export type Contact = {
  handle: string;
  name: string;
  bio?: string | null;
  followers?: number | null;
  mutual?: boolean | null;
};

/**
 * Merge imported followings into people + identities. A known handle updates its signals;
 * a new handle whose display name matches an existing person joins that person (same human,
 * another platform); anything else becomes a new, untracked person.
 */
export async function upsertContacts(platform: Platform, contacts: Contact[]) {
  const stats = { updated: 0, linked: 0, created: 0 };
  const now = Date.now();

  for (const c of contacts) {
    const name = c.name.trim() || c.handle;
    const signals = { displayName: name, bio: c.bio ?? null, followers: c.followers ?? null, mutual: c.mutual ?? null, importedAt: now };

    const [identity] = await db
      .select()
      .from(schema.identities)
      .where(and(eq(schema.identities.platform, platform), eq(sql`lower(${schema.identities.handle})`, c.handle.toLowerCase())));
    if (identity) {
      await db.update(schema.identities).set(signals).where(eq(schema.identities.id, identity.id));
      stats.updated++;
      continue;
    }

    // Match an existing person by name. SQLite's lower() only folds ASCII, so accented/non-Latin
    // names (common on IG) can miss here — the insert below is collision-safe to cover that.
    const [person] = await db.select().from(schema.people).where(eq(sql`lower(${schema.people.name})`, name.toLowerCase()));
    let personId = person?.id;
    if (!personId) {
      const inserted = await db
        .insert(schema.people)
        .values({ name, tracked: false })
        .onConflictDoNothing({ target: schema.people.name })
        .returning({ id: schema.people.id });
      // onConflict (an exact-name row already existed that the lower() match missed) → fetch it.
      personId = inserted[0]?.id ?? (await db.select({ id: schema.people.id }).from(schema.people).where(eq(schema.people.name, name)))[0]?.id;
    }
    if (!personId) continue; // couldn't resolve or create — skip rather than crash
    await db.insert(schema.identities).values({ personId, platform, handle: c.handle, ...signals }).onConflictDoNothing();
    stats[person ? "linked" : "created"]++;
  }
  return stats;
}

export const getAccount = async (platform: Platform) =>
  (await db.select().from(schema.accounts).where(eq(schema.accounts.platform, platform)))[0] ?? null;

export const listAccounts = () => db.select().from(schema.accounts);

export async function saveAccount(platform: Platform, patch: Partial<typeof schema.accounts.$inferInsert>) {
  await db
    .insert(schema.accounts)
    .values({ platform, ...patch })
    .onConflictDoUpdate({ target: schema.accounts.platform, set: patch });
}
