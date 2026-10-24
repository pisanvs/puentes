import { generateText, Output } from "ai";
import { z } from "zod";
import { TRIAGE_MODEL } from "./models";

export type Objective = { id: number; text: string };

export type Verdict = {
  /** Is this worth any attention at all? Filters noise before expensive extraction. */
  relevant: boolean;
  /** Objective ids this signal plausibly advances. */
  objectiveIds: number[];
  /** Escalate to full extraction + ranking (a real life-event or opportunity, not chatter). */
  escalate: boolean;
  reason: string;
};

const schema = z.object({
  verdicts: z.array(
    z.object({
      index: z.number(),
      relevant: z.boolean(),
      objectiveIds: z.array(z.number()),
      escalate: z.boolean().describe("True only for a genuine life-event, announcement or opportunity worth acting on."),
      reason: z.string().describe("Under 12 words."),
    }),
  ),
});

/**
 * Cheap first pass over many signals (posts, search hits): which objectives each one touches and
 * whether it's worth escalating to extraction. Keeps the expensive models off the long tail of noise.
 */
export async function triage(texts: string[], objectives: Objective[]): Promise<Verdict[]> {
  if (texts.length === 0) return [];
  const { output } = await generateText({
    model: TRIAGE_MODEL,
    output: Output.object({ schema }),
    system:
      "You triage short social signals for a relationship assistant. For each item, decide if it's relevant (says something real about a person's life or an opportunity), which of the owner's objectives it advances, and whether to escalate (a genuine announcement/life-event/opportunity, not everyday chatter or opinions).",
    prompt: JSON.stringify({
      objectives: objectives.map((o) => ({ id: o.id, text: o.text })),
      items: texts.map((t, index) => ({ index, text: t.slice(0, 600) })),
    }),
  });

  const byIndex = new Map(output.verdicts.map((v) => [v.index, v]));
  return texts.map((_, i) => {
    const v = byIndex.get(i);
    return {
      relevant: v?.relevant ?? true, // fail open: if triage missed it, let extraction decide
      objectiveIds: v?.objectiveIds ?? [],
      escalate: v?.escalate ?? true,
      reason: v?.reason ?? "",
    };
  });
}
