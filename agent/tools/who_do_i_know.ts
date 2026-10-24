import { defineTool } from "eve/tools";
import { z } from "zod";
import { peopleAt } from "../lib/graph/query";

export default defineTool({
  description:
    "Find people in the owner's network connected to a company, school, topic, place or event. Searches the graph, e.g. 'who do I know at Stripe', 'who works on climate', 'who went to Minerva', 'who's been through YC'.",
  inputSchema: z.object({
    query: z.string().min(2).describe("A company, school, topic, place or event name."),
    kind: z.enum(["org", "school", "place", "topic", "event"]).optional().describe("Narrow to one kind if ambiguous."),
    limit: z.number().int().min(1).max(60).optional(),
  }),
  label: { start: ({ query }) => `Who do I know: ${query}` },
  async execute({ query, kind, limit }) {
    const { entities, people } = await peopleAt(query, kind, limit ?? 40);
    return {
      matchedEntities: entities.map((e) => `${e.name} (${e.kind})`),
      people: people.map((p) => ({ name: p.name, link: `${p.predicate} ${p.entity}`, inInnerCircle: p.tracked })),
      count: people.length,
    };
  },
});
