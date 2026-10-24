import { openai } from "eve/models/openai";

// Direct OpenAI (OPENAI_API_KEY). Extraction runs per post, so it gets the cheap model.
export const EXTRACT_MODEL = openai("gpt-6-luna");
export const REASON_MODEL = openai("gpt-6-sol");

/**
 * Fast triage/classification model. `jev` is the cheapest ($0.042/M in, $0 out) but lives only on
 * the Vercel AI Gateway (needs AI_GATEWAY_API_KEY). Until that's wired, fall back to gpt-5.4-nano,
 * which runs on the OpenAI-direct key we already have. Set TRIAGE_MODEL=jev once the gateway works.
 *
 * A plain gateway model-id string (no provider instance) routes through the AI Gateway in AI SDK 7.
 */
export const TRIAGE_MODEL = process.env.TRIAGE_MODEL === "jev" ? "typesafe-ai/jev" : openai("gpt-5.4-nano");
