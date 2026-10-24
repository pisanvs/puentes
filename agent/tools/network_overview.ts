import { defineTool } from "eve/tools";
import { z } from "zod";
import { graphStats, topEntities } from "../lib/graph/query";

export default defineTool({
  description:
    "Overview of the owner's network graph: the biggest hubs (companies, schools, topics, places, events) that the most people connect to, plus how much of the network has been mapped.",
  inputSchema: z.object({
    kind: z.enum(["org", "school", "place", "topic", "event"]).optional().describe("Limit to one kind; omit for all."),
    limit: z.number().int().min(1).max(40).optional(),
  }),
  label: { start: () => "Survey the network" },
  async execute({ kind, limit }) {
    const stats = await graphStats();
    if (kind) return { stats, [`${kind}s`]: await topEntities(kind, limit ?? 20) };
    const kinds = ["org", "school", "topic", "place", "event"] as const;
    const top = Object.fromEntries(await Promise.all(kinds.map(async (k) => [`${k}s`, await topEntities(k, limit ?? 8)])));
    return { stats, ...top };
  },
});
