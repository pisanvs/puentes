import { defineTool } from "eve/tools";
import { z } from "zod";
import { snoozeNudge } from "../lib/queries";

export default defineTool({
  description: "Snooze a nudge so it comes back in a few days.",
  inputSchema: z.object({ nudgeId: z.number().int(), days: z.number().min(1).max(60).default(3) }),
  async execute({ nudgeId, days }) {
    const n = await snoozeNudge(nudgeId, days ?? 3);
    return { nudgeId: n.id, until: new Date(n.snoozedUntil!).toISOString().slice(0, 10) };
  },
});
