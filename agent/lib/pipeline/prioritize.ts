import { generateText, Output } from "ai";
import { desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "../db/client";
import { EXTRACT_MODEL } from "../models";
import { setInnerCircle } from "../queries";

const LLM_LIMIT = Number(process.env.PRIORITIZE_LLM_LIMIT ?? 400);
const BATCH = 60;

type Candidate = {
  id: number;
  name: string;
  tracked: boolean;
  platforms: string[];
  mutual: boolean;
  followers: number | null;
  bios: string[];
};

/**
 * Cheap signals that someone is a real personal connection rather than an account you follow:
 * they follow you back, you're connected on several platforms, and they don't have a celebrity-size audience.
 */
function heuristic(c: Candidate) {
  let score = 0;
  if (c.mutual) score += 3;
  score += (c.platforms.length - 1) * 2;
  if (c.platforms.includes("linkedin")) score += 1; // LinkedIn connections are mutual and usually real-world
  if (c.followers !== null) {
    if (c.followers < 2_000) score += 1;
    else if (c.followers > 200_000) score -= 3;
    else if (c.followers > 20_000) score -= 1.5;
  }
  return score;
}

const verdicts = z.object({
  people: z.array(
    z.object({
      id: z.number(),
      closeness: z.number().min(0).max(10).describe("How likely this is someone the owner personally knows (friend, colleague, classmate) vs. a public figure, brand or stranger."),
      relevance: z.number().min(0).max(10).describe("How much keeping up with them serves the owner's objectives."),
      reason: z.string().describe("Under 12 words, e.g. 'Mutual on X and LinkedIn; climate founder'."),
    }),
  ),
});

/** Score everyone the owner follows so the best inner-circle candidates rise to the top. */
export async function prioritize(progress: (m: string) => void = () => {}) {
  const [people, identities, objectives] = await Promise.all([
    db.select().from(schema.people),
    db.select().from(schema.identities),
    db.select().from(schema.objectives),
  ]);

  const candidates: Candidate[] = people.map((p) => {
    const ids = identities.filter((i) => i.personId === p.id);
    const followerCounts = ids.map((i) => i.followers).filter((n): n is number => n !== null);
    return {
      id: p.id,
      name: p.name,
      tracked: p.tracked,
      platforms: [...new Set(ids.map((i) => i.platform))],
      mutual: ids.some((i) => i.mutual),
      followers: followerCounts.length ? Math.max(...followerCounts) : null,
      bios: ids.map((i) => i.bio).filter((b): b is string => !!b),
    };
  });

  const scored = candidates.map((c) => ({ c, h: heuristic(c) })).sort((a, b) => b.h - a.h);
  const llm = new Map<number, z.infer<typeof verdicts>["people"][number]>();
  const toJudge = scored.slice(0, LLM_LIMIT);

  for (let i = 0; i < toJudge.length; i += BATCH) {
    progress(`Prioritizing ${Math.min(i + BATCH, toJudge.length)}/${toJudge.length}`);
    const { output } = await generateText({
      model: EXTRACT_MODEL,
      output: Output.object({ schema: verdicts }),
      system:
        "You help the owner pick their inner circle from everyone they follow. Score each account for closeness (do they personally know them?) and relevance to the owner's objectives. Big public figures, brands, media and news accounts have low closeness.",
      prompt: JSON.stringify({
        objectives: objectives.map((o) => o.text),
        accounts: toJudge.slice(i, i + BATCH).map(({ c }) => ({
          id: c.id,
          name: c.name,
          platforms: c.platforms,
          followsOwnerBack: c.mutual,
          followers: c.followers,
          bio: c.bios.join(" | ").slice(0, 300),
        })),
      }),
    });
    for (const v of output.people) llm.set(v.id, v);
  }

  const now = Date.now();
  for (const { c, h } of scored) {
    const v = llm.get(c.id);
    const priority = h + (v ? 0.6 * v.closeness + 0.4 * v.relevance : 0);
    const reason = v?.reason ?? [c.mutual && "Follows you back", c.platforms.length > 1 && `On ${c.platforms.length} platforms`].filter(Boolean).join(" · ");
    await db.update(schema.people).set({ priority, priorityReason: reason || null, prioritizedAt: now }).where(eq(schema.people.id, c.id));
  }
  return { people: candidates.length, judged: llm.size };
}

/** Add the top-N untracked people to the inner circle by warming them past the cutoff. */
export async function trackTop(n: number) {
  const top = await db
    .select({ id: schema.people.id })
    .from(schema.people)
    .where(eq(schema.people.tracked, false))
    .orderBy(desc(schema.people.priority))
    .limit(n);
  for (const t of top) await setInnerCircle(t.id, true);
  return top.length;
}

