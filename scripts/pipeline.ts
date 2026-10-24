// npm run pipeline -- [--collect] [--platforms=x,linkedin]
import { ALL_PLATFORMS, collect } from "../collector/run";
import type { Platform } from "../collector/types";
import { runJob } from "../agent/lib/jobs";
import { syncPeopleFile } from "../agent/lib/people";
import { runPipeline } from "../agent/lib/pipeline";

const args = process.argv.slice(2);
const platforms = (args.find((a) => a.startsWith("--platforms="))?.split("=")[1].split(",") as Platform[]) ?? ALL_PLATFORMS;
const doCollect = args.includes("--collect") || args.includes("--collect-only");

await runJob(
  "pipeline",
  async (progress) => {
    progress(`syncing people (${JSON.stringify(await syncPeopleFile())})`);
    let collected: unknown = null;
    if (doCollect) {
      progress("collecting posts");
      collected = await collect(platforms, progress);
    }
    if (args.includes("--collect-only")) return { collected };
    progress("extracting and ranking");
    return { collected, ...(await runPipeline()) };
  },
  { browser: doCollect && !process.env.REPLAY },
);
