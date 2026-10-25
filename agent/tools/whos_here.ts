import { defineTool } from "eve/tools";
import { z } from "zod";
import { computeNearby, listNearby } from "../lib/nearby";

export default defineTool({
  description:
    "Who's here now: people in the owner's network who are in the city the owner is in (their current trip, else home), worth meeting there — each with the evidence (seen there recently / lives there), why, and a ready 'grab coffee?' draft. Pass refresh=true to re-read recent posts first (slower).",
  inputSchema: z.object({ refresh: z.boolean().default(false) }),
  async execute({ refresh }) {
    if (refresh) await computeNearby();
    const n = await listNearby();
    if (!n.place) return { error: "No trip or home base set. Ask where they are and save it with remember_about_me." };
    return {
      place: n.place,
      traveling: n.traveling,
      until: n.to,
      people: n.people.map((p) => ({
        name: p.name,
        why: p.reason,
        draft: p.draft,
        evidence: p.evidence.map((e) => (e.kind === "you_said" ? `owner said: ${e.detail}` : e.kind === "here_now" ? `seen here ${e.at}: ${e.detail}` : e.detail)),
      })),
    };
  },
});
