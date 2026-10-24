import { defineTool } from "eve/tools";
import { z } from "zod";
import { listTopics, topicFeed, topicSuggestions } from "../lib/topics";

export default defineTool({
  description:
    "The owner's topic inner circle: watched topics with how many recent stories and people touch each. Pass `name` to read one topic's feed (recent stories + who in the network works on it). Also returns topics the network clusters around that aren't watched yet.",
  inputSchema: z.object({ name: z.string().optional().describe("Read this topic's feed.") }),
  async execute({ name }) {
    const topics = await listTopics();
    if (name) {
      const t = topics.find((x) => x.name.toLowerCase() === name.toLowerCase());
      if (!t) return { error: `Not watching "${name}". Use watch_topic first.`, watched: topics.map((x) => x.name) };
      return topicFeed(t.id);
    }
    return {
      watched: topics.map((t) => ({ name: t.name, weight: t.weight, recentStories: t.stories, people: t.people })),
      suggestions: await topicSuggestions(8),
    };
  },
});
