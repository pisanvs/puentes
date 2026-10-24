import { defineTool } from "eve/tools";
import { z } from "zod";
import { spawnJob } from "../lib/jobs";

export default defineTool({
  description:
    "Mine more of the owner's network into the knowledge graph: extract companies, schools, topics, places and events from people's bios. Runs in the background for a minute or two. Use when graph coverage is low or the owner wants more of their network mapped.",
  inputSchema: z.object({ count: z.number().int().min(10).max(1500).default(200).describe("How many more people to map.") }),
  execute({ count }) {
    return spawnJob("graph", "scripts/graph.ts", [String(count ?? 200)]);
  },
});
