import { defineTool } from "eve/tools";
import { z } from "zod";
import { searchPeople } from "../lib/queries";

export default defineTool({
  description:
    "Search friends' recent updates, tags and notes by a keyword such as a city ('Lisbon'), company ('Stripe') or topic ('climate'). Use one keyword per call.",
  inputSchema: z.object({ query: z.string().min(2), limit: z.number().int().min(1).max(30).optional() }),
  label: { start: ({ query }) => `Search for ${query}` },
  execute: ({ query, limit }) => searchPeople(query, limit ?? 10),
});
