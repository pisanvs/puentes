import { recomputeWarmth } from "../warmth";
import { enrich } from "./enrich";
import { rankMatches, rankNudges } from "./rank";

/** enrich → rank. Collection runs separately (collector/run.ts) because it drives a local browser. */
export async function runPipeline() {
  const enriched = await enrich();
  await recomputeWarmth(); // cheap, keeps relationship strength fresh for ranking
  const nudges = await rankNudges();
  const matches = await rankMatches();
  return { enriched, nudges, matches };
}
