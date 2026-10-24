import { defineTool } from "eve/tools";
import { z } from "zod";
import { setMatchStatus } from "../lib/queries";

export default defineTool({
  description: "Close a serendipity match: 'done' once the owner made the intro, 'dismissed' if it's not a fit.",
  inputSchema: z.object({ matchId: z.number().int(), outcome: z.enum(["done", "dismissed"]) }),
  async execute({ matchId, outcome }) {
    const m = await setMatchStatus(matchId, outcome);
    return { matchId: m.id, status: m.status };
  },
});
