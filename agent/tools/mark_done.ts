import { defineTool } from "eve/tools";
import { z } from "zod";
import { setNudgeStatus } from "../lib/queries";

export default defineTool({
  description:
    "Close a nudge. 'done' means the owner reached out (also logs the contact); 'dismissed' means not worth it.",
  inputSchema: z.object({
    nudgeId: z.number().int(),
    outcome: z.enum(["done", "dismissed"]).default("done"),
  }),
  async execute({ nudgeId, outcome }) {
    const n = await setNudgeStatus(nudgeId, outcome ?? "done");
    return { nudgeId: n.id, status: n.status };
  },
});
