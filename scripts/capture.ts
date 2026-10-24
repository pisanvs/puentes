// Dump collected posts and snapshots to fixtures/capture.json for `REPLAY=1` demos.
import { writeFile } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { db, schema } from "../agent/lib/db/client";

const posts = await db
  .select({ p: schema.posts, person: schema.people.name })
  .from(schema.posts)
  .innerJoin(schema.people, eq(schema.people.id, schema.posts.personId));
const snapshots = await db
  .select({ s: schema.snapshots, person: schema.people.name })
  .from(schema.snapshots)
  .innerJoin(schema.people, eq(schema.people.id, schema.snapshots.personId));

await writeFile(
  "fixtures/capture.json",
  JSON.stringify(
    {
      posts: posts.map(({ p, person }) => ({ person, platform: p.platform, nativeId: p.id.split(":").slice(1).join(":"), url: p.url, text: p.text, postedAt: p.postedAt })),
      snapshots: snapshots.map(({ s, person }) => ({ person, platform: s.platform, headline: s.headline, company: s.company, location: s.location, takenAt: s.takenAt })),
    },
    null,
    2,
  ),
);
console.log(`captured ${posts.length} posts, ${snapshots.length} snapshots → fixtures/capture.json`);
process.exit(0);
