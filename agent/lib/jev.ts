// jev is a "decision model" on the Vercel AI Gateway — it answers yes/no questions with calibrated
// probabilities, for ~$0.04 per million input tokens and zero output cost. It's not a chat model, so
// it uses the gateway's /decisions endpoint, not chat/completions. Perfect for high-volume triage.

const GATEWAY = "https://ai-gateway.vercel.sh/v1/decisions";
const MODEL = "typesafe-ai/jev";

export type Predicate = { name: string; instructions: string };

export const jevAvailable = () => !!process.env.AI_GATEWAY_API_KEY;

/**
 * Ask jev a batch of yes/no questions about one piece of text. Returns name → probability (0..1).
 * One decision call per item; batch across items at the caller for throughput.
 */
export async function jevDecide(text: string, questions: Predicate[]): Promise<Record<string, number>> {
  const res = await fetch(GATEWAY, {
    method: "POST",
    headers: { authorization: `Bearer ${process.env.AI_GATEWAY_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      input: [{ role: "user", content: [{ type: "input_text", text: text.slice(0, 4000) }] }],
      questions: questions.map((q) => ({ type: "predicate", name: q.name, instructions: q.instructions })),
    }),
  });
  if (!res.ok) throw new Error(`jev /decisions returned ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as { answers: { name: string; probability?: number }[] };
  return Object.fromEntries(data.answers.map((a) => [a.name, a.probability ?? 0]));
}
