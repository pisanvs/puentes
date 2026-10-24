// npm run graph -- [sampleSize]    Mine a sample of the network into the event log + graph.
import { runJob } from "../agent/lib/jobs";
import { extractGraph } from "../agent/lib/graph/extract";

const limit = Number(process.argv[2] ?? process.env.GRAPH_SAMPLE ?? 150);

await runJob("graph", (progress) => extractGraph(progress, limit));
