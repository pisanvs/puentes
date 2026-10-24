import { readFile } from "node:fs/promises";
import { and, eq } from "drizzle-orm";
import { parse } from "yaml";
import { db, schema } from "./db/client";

type Platform = (typeof schema.identities.$inferInsert)["platform"];

type PeopleFile = {
  objectives?: { text: string; weight?: number }[];
  people: {
    name: string;
    phone?: string;
    tags?: string[];
    notes?: string;
    handles?: Partial<Record<Platform, string>>;
  }[];
};

/** Upsert people, identities and (first run only) objectives from people.yaml. */
export async function syncPeopleFile(path = process.env.PEOPLE_FILE ?? "people.yaml") {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    // No people file yet (e.g. running on demo data): keep whoever is already in the DB.
    return { people: 0, skipped: `${path} not found` };
  }
  const file = parse(raw) as PeopleFile;

  for (const p of file.people) {
    const [row] = await db
      .insert(schema.people)
      .values({ name: p.name, phone: p.phone, tags: p.tags ?? [], notes: p.notes ?? "", tracked: true })
      .onConflictDoUpdate({
        target: schema.people.name,
        set: { phone: p.phone, tags: p.tags ?? [], tracked: true },
      })
      .returning();

    for (const [platform, handle] of Object.entries(p.handles ?? {})) {
      if (!handle) continue;
      await db
        .insert(schema.identities)
        .values({ personId: row.id, platform: platform as Platform, handle })
        .onConflictDoNothing();
    }
  }

  const existing = await db.select().from(schema.objectives).limit(1);
  if (existing.length === 0 && file.objectives?.length) {
    await db
      .insert(schema.objectives)
      .values(file.objectives.map((o) => ({ text: o.text, weight: o.weight ?? 1 })));
  }

  return { people: file.people.length };
}

export async function identitiesFor(platform: Platform) {
  return db
    .select({
      personId: schema.identities.personId,
      handle: schema.identities.handle,
      name: schema.people.name,
      importedAt: schema.identities.importedAt,
    })
    .from(schema.identities)
    .innerJoin(schema.people, eq(schema.people.id, schema.identities.personId))
    .where(and(eq(schema.identities.platform, platform), eq(schema.people.tracked, true)));
}
