import { defineTool } from "eve/tools";
import { z } from "zod";
import { watchTopic } from "../lib/topics";

export default defineTool({
  description:
    "Add a topic to the owner's topic inner circle (e.g. 'ai agents', 'climate tech', 'robotics'). Posts about it get tagged and rank higher, and recent stories are tagged right away.",
  inputSchema: z.object({
    name: z.string().min(2),
    weight: z.number().min(0.5).max(2).default(1).describe("1 = normal, 2 = care a lot."),
  }),
  async execute({ name, weight }) {
    const { topic, backfilled } = await watchTopic(name, weight ?? 1);
    return { id: topic.id, name: topic.name, taggedRecentStories: backfilled };
  },
});
