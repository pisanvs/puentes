import { computeNearby } from "../nearby";
import { recomputeWarmth } from "../warmth";
import { enrich } from "./enrich";
import { rankMatches, rankNudges } from "./rank";

/** enrich → rank → who's here. Collection runs separately (collector/run.ts) because it drives a local browser. */
export async function runPipeline() {
  const enriched = await enrich();
  await recomputeWarmth(); // cheap, keeps relationship strength fresh for ranking
  const nudges = await rankNudges();
  const matches = await rankMatches();
  // Fresh posts can put people in the owner's city; never let this sink the run.
  const nearby = await computeNearby().catch((err) => ({ error: (err as Error).message }));
  return { enriched, nudges, matches, nearby };
}
