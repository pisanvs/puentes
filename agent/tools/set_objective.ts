import { defineTool } from "eve/tools";
import { z } from "zod";
import { resetRanking, setObjective } from "../lib/queries";

export default defineTool({
  description:
    "Add an objective (or update one by id). Objectives are what follow-ups are ranked against, e.g. 'meet climate founders', 'I'm in NYC Dec 3-7'. Re-ranking happens on the next pipeline run.",
  inputSchema: z.object({
    text: z.string().min(3),
    weight: z.number().min(0.1).max(3).default(1).describe("1 = normal, 2 = high priority."),
    id: z.number().int().optional().describe("Existing objective to update."),
  }),
  async execute({ text, weight, id }) {
    const o = await setObjective(text, weight ?? 1, id);
    await resetRanking();
    return { id: o.id, text: o.text, weight: o.weight, note: "Run the pipeline to re-rank." };
  },
});
