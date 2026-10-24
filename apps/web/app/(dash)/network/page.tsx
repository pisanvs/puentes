import { readJob } from "@agent/lib/jobs";
import { graphStats, graphView, topEntities } from "@agent/lib/graph/query";
import { NetworkView } from "../../_dash/network-view";
import { PageHeader } from "../../_dash/ui";

export const dynamic = "force-dynamic";

const KINDS = ["org", "school", "topic", "place", "event"] as const;

export default async function NetworkPage() {
  const [stats, job, graph, ...tops] = await Promise.all([
    graphStats(),
    Promise.resolve(readJob("graph")),
    graphView(),
    ...KINDS.map((k) => topEntities(k, 12)),
  ]);
  const top = Object.fromEntries(KINDS.map((k, i) => [k, tops[i]])) as Record<(typeof KINDS)[number], (typeof tops)[number]>;

  return (
    <>
      <PageHeader
        title="Network"
        subtitle={`${stats.mapped} of ${stats.totalPeople} people mapped · ${stats.edges} connections across companies, schools, topics, places and events.`}
      />
      <NetworkView stats={stats} top={top} job={job} graph={graph} />
    </>
  );
}
