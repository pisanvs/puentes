import { listTopics, topicFeed, topicSuggestions } from "@agent/lib/topics";
import { TopicsBoard } from "../../_dash/topics-board";
import { PageHeader } from "../../_dash/ui";

export const dynamic = "force-dynamic";

export default async function TopicsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const tab = (await searchParams).tab === "suggestions" ? "suggestions" : "watching";
  const [topics, suggestions] = await Promise.all([listTopics(), topicSuggestions(24)]);
  const feeds = (await Promise.all(topics.map((t) => topicFeed(t.id)))).filter((f) => f !== null);
  return (
    <>
      <PageHeader
        title="Topics"
        subtitle="Your topic inner circle — ideas you track across your network. Posts about these get tagged, rank higher, and land here."
      />
      <TopicsBoard tab={tab} topics={topics} feeds={feeds} suggestions={suggestions} />
    </>
  );
}
