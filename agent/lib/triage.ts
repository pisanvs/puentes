import { generateText, Output } from "ai";
import { z } from "zod";
import { POST_CATEGORIES, type PostCategory } from "./db/schema";
import { jevAvailable, jevDecide, type Predicate } from "./jev";
import { TRIAGE_MODEL } from "./models";
import { topicQuestion } from "./topics";
import { pMap } from "./util";

export type Objective = { id: number; text: string };

/** A post plus a short card about its author (role, base, company, what we know, the owner's notes). */
export type TriageItem = { text: string; context?: string };

/** Watched topics (the topic inner circle) — each becomes a yes/no question. */
export type WatchedTopic = { id: number; name: string };

export type TriageOptions = {
  objectives: Objective[];
  topics?: WatchedTopic[];
  /** The owner's reader card (`ownerCard()`): who's reading, where they are, what they care about. */
  reader?: string;
};

/**
 * What the classifier reads: who's reading, who wrote it, then the post. Context turns
 * "at #CloudflareConnect" into "an SF engineer is at a conference while you're in SF".
 */
const asInput = (item: TriageItem, reader?: string) =>
  [reader && `About the reader: ${reader}`, item.context && `About the author: ${item.context}`, `Post:\n${item.text}`]
    .filter(Boolean)
    .join("\n\n");

export type Verdict = {
  /** What kind of signal this is. Everything except non_relevant goes on to extraction. */
  category: PostCategory;
  relevant: boolean;
  /** Objective ids this signal plausibly advances. */
  objectiveIds: number[];
  /** Watched topic ids this post is about. */
  topicIds: number[];
  /** A moment worth reaching out about now (announcement, opportunity, they're nearby). */
  escalate: boolean;
  reason: string;
};

// One yes/no question per category. Written so the edges land where the owner cares: being at an
// event or in a city is location (that's who you could meet), a reshare is interest (what they
// amplify), shipping/technical takes are professional, and only true noise is non_relevant.
const CATEGORY_QUESTIONS: Record<PostCategory, string> = {
  life_update:
    "The post announces something that happened in the author's own life or career: new job, promotion, leaving a job, moving cities, launching their company or product, fundraising, graduating, a wedding, a birth, a big milestone.",
  professional:
    "The post is about the author's work, field or expertise: what they're building or shipping, technical or industry opinions, product feedback, hiring, lessons from their job.",
  location:
    "The post shows where the author physically is or will be, or an in-person event they're part of: attending, speaking at, hosting, promoting or live-posting from a conference, meetup or event (quoting a talk 'at <event>' or tagging the event hashtag counts), traveling, or being in a specific city.",
  interest:
    "The post shows a topic or person the author cares about without being about their own work, life or whereabouts: resharing someone else's work, sharing an article, cheering on someone else's launch.",
  non_relevant:
    "The post reveals nothing about the author's life, work, whereabouts or interests: a meme, a joke, a vague one-liner, a bare reaction. A post that names a real event, place, product or person is NOT this.",
};

const ESCALATE =
  "This is a good reason for the reader to reach out to the author right now: a genuine announcement or life event, an opportunity, an ask for help, or the author being somewhere the reader could meet them.";

const MIN_CATEGORY = 0.35; // below this for every real category, call it noise

/**
 * Classify social signals: a category per item, which objectives it touches, and whether it's
 * reach-out-worthy now. jev (calibrated yes/no probabilities, ~free) when the AI Gateway is
 * configured; the cheap chat model otherwise.
 */
export async function triage(items: TriageItem[], opts: TriageOptions): Promise<Verdict[]> {
  if (items.length === 0) return [];
  if (jevAvailable()) {
    try {
      return await triageJev(items, opts);
    } catch (err) {
      console.warn(`[triage] jev failed, falling back: ${(err as Error).message}`);
    }
  }
  return triageChat(items, opts);
}

async function triageJev(items: TriageItem[], { objectives, topics = [], reader }: TriageOptions): Promise<Verdict[]> {
  const questions: Predicate[] = [
    ...POST_CATEGORIES.map((c) => ({ name: c, instructions: CATEGORY_QUESTIONS[c] })),
    { name: "escalate", instructions: ESCALATE },
    ...objectives.map((o) => ({ name: `obj_${o.id}`, instructions: `The post is relevant to this goal of the reader: ${o.text}` })),
    ...topics.map((t) => ({ name: `topic_${t.id}`, instructions: topicQuestion(t.name) })),
  ];
  return pMap(items, 5, async (item) => {
    const p = await jevDecide(asInput(item, reader), questions);
    const ranked = POST_CATEGORIES.filter((c) => c !== "non_relevant").sort((a, b) => (p[b] ?? 0) - (p[a] ?? 0));
    const top = ranked[0];
    const topicIds = topics.filter((t) => (p[`topic_${t.id}`] ?? 0) >= 0.5).map((t) => t.id);
    const noise = (p.non_relevant ?? 0) > (p[top] ?? 0) || (p[top] ?? 0) < MIN_CATEGORY;
    // A post about a topic you watch is never noise to you.
    const category: PostCategory = noise ? (topicIds.length ? "interest" : "non_relevant") : top;
    return {
      category,
      relevant: category !== "non_relevant",
      objectiveIds: objectives.filter((o) => (p[`obj_${o.id}`] ?? 0) >= 0.5).map((o) => o.id),
      topicIds,
      escalate: category !== "non_relevant" && (p.escalate ?? 0) >= 0.5,
      reason: `${category} ${Math.round((p[category] ?? 0) * 100)}%`,
    };
  });
}

const chatSchema = z.object({
  verdicts: z.array(
    z.object({
      index: z.number(),
      category: z.enum(POST_CATEGORIES),
      objectiveIds: z.array(z.number()),
      topicIds: z.array(z.number()).describe("Ids of watched topics the post is substantially about."),
      escalate: z.boolean(),
      reason: z.string().describe("Under 12 words."),
    }),
  ),
});

async function triageChat(items: TriageItem[], { objectives, topics = [], reader }: TriageOptions): Promise<Verdict[]> {
  const { output } = await generateText({
    model: TRIAGE_MODEL,
    output: Output.object({ schema: chatSchema }),
    system: [
      "You triage short social posts by people in the reader's network. Give each one category:",
      ...POST_CATEGORIES.map((c) => `- ${c}: ${CATEGORY_QUESTIONS[c]}`),
      `Also mark escalate when: ${ESCALATE}`,
      "List the ids of the reader's objectives each post plausibly advances, and the ids of watched topics it is substantially about.",
      "Each item carries an `author` card (who they are, where they're based, what they work on, the reader's notes) — use it to read the post in context.",
      reader && `About the reader: ${reader}`,
    ]
      .filter(Boolean)
      .join("\n"),
    prompt: JSON.stringify({
      objectives: objectives.map((o) => ({ id: o.id, text: o.text })),
      topics: topics.map((t) => ({ id: t.id, name: t.name })),
      items: items.map((it, index) => ({ index, author: it.context, text: it.text.slice(0, 600) })),
    }),
  });

  const byIndex = new Map(output.verdicts.map((v) => [v.index, v]));
  return items.map((_, i) => {
    const v = byIndex.get(i);
    // Fail open: if the model skipped an item, let extraction decide.
    const topicIds = v?.topicIds ?? [];
    const category = v?.category === "non_relevant" && topicIds.length ? "interest" : (v?.category ?? "professional");
    return {
      category,
      relevant: category !== "non_relevant",
      objectiveIds: v?.objectiveIds ?? [],
      topicIds,
      escalate: v?.escalate ?? false,
      reason: v?.reason ?? "",
    };
  });
}
