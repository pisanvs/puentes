import { spawnJob } from "./jobs";

export type PipelineOptions = { collect: boolean; platforms?: string[] };

/**
 * Run scripts/pipeline.ts as a background job. Collection drives a real browser
 * for minutes, so it never runs inside an agent turn or a web request.
 */
export function spawnPipeline({ collect, platforms }: PipelineOptions) {
  const args: string[] = [];
  if (collect) args.push("--collect");
  if (platforms?.length) args.push(`--platforms=${platforms.join(",")}`);
  // Bluesky-only collection doesn't need the browser.
  const browser = collect && (!platforms || platforms.some((p) => p !== "bluesky"));
  return spawnJob("pipeline", "scripts/pipeline.ts", args, { browser });
}
