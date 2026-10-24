import { defineTool } from "eve/tools";
import { z } from "zod";
import { getNudges } from "../lib/queries";

export default defineTool({
  description:
    "Get the top open follow-up nudges: friends with a recent update worth reaching out about, with the reason, a ready-to-send draft, and a wa.me send link when their phone is known.",
  inputSchema: z.object({ limit: z.number().int().min(1).max(20).optional() }),
  label: { start: () => "Check follow-ups" },
  execute: ({ limit }) => getNudges(limit ?? 5),
});
