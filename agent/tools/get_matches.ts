import { defineTool } from "eve/tools";
import { z } from "zod";
import { getMatches } from "../lib/queries";

export default defineTool({
  description:
    "Get serendipity matches: pairs of the owner's friends whose recent updates overlap (same city, company, topic, or one's ask fits the other's offer), with a double-opt-in intro draft.",
  inputSchema: z.object({ limit: z.number().int().min(1).max(10).optional() }),
  label: { start: () => "Look for intros" },
  execute: ({ limit }) => getMatches(limit ?? 3),
});
