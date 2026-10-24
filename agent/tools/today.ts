import { defineTool } from "eve/tools";
import { z } from "zod";
import { todayEdition } from "../lib/edition";

export default defineTool({
  description:
    "Read today's edition: the latest stories from the owner's network (last two weeks), best first — each with who, what, its category (life update / whereabouts / work / interest), watched topics, and why it matters when it ties to an objective. Use for 'what's new?', 'what's my network up to?', or a quick catch-up.",
  inputSchema: z.object({ limit: z.number().int().min(1).max(30).default(8) }),
  async execute({ limit }) {
    const e = await todayEdition();
    return {
      date: e.date,
      totals: e.counts,
      stories: e.stories.slice(0, limit).map((s) => ({
        person: s.person,
        story: s.summary,
        category: s.category,
        topics: s.topics,
        when: s.occurredAt,
        whyItMatters: s.why,
        objective: s.objective,
        source: s.sourceUrl,
      })),
    };
  },
});
