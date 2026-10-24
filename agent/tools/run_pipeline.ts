import { defineTool } from "eve/tools";
import { once } from "eve/tools/approval";
import { z } from "zod";
import { spawnPipeline } from "../lib/spawn-pipeline";

export default defineTool({
  description:
    "Refresh everything: scrape friends' socials in the local browser, extract updates, and re-rank nudges and matches. It runs in the background for a few minutes, so tell the owner the results will be ready soon. Use skipCollect to only re-rank (fast).",
  inputSchema: z.object({
    platforms: z.array(z.enum(["bluesky", "x", "linkedin"])).optional().describe("Defaults to all."),
    skipCollect: z.boolean().default(false),
  }),
  approval: once(),
  execute: ({ platforms, skipCollect }) => spawnPipeline({ collect: !skipCollect, platforms }),
});
