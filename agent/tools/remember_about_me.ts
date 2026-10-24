import { defineTool } from "eve/tools";
import { z } from "zod";
import { ownerCard, rememberFact, saveOwner } from "../lib/me";

export default defineTool({
  description:
    "Save something the owner told you about themselves, so every ranking and draft knows it. Use the fields for core profile changes (role, home base, a trip) and `fact` for anything else ('training for a marathon', 'raising a pre-seed in January').",
  inputSchema: z.object({
    name: z.string().optional(),
    headline: z.string().optional().describe("Their role in a line, e.g. 'engineer at Recall.ai'."),
    homeBase: z.string().optional().describe("City they live in."),
    about: z.string().optional().describe("Replaces the free-form about text. Prefer `fact` for additions."),
    trip: z
      .object({ place: z.string(), from: z.string().optional().describe("ISO date"), to: z.string().optional().describe("ISO date") })
      .optional()
      .describe("Where they're going or currently visiting."),
    fact: z.string().optional().describe("One new thing about them."),
  }),
  async execute({ fact, ...profile }) {
    if (Object.values(profile).some((v) => v !== undefined)) await saveOwner(profile);
    if (fact) await rememberFact(fact);
    return { saved: true, card: await ownerCard() };
  },
});
