import { defineTool } from "eve/tools";
import { z } from "zod";
import { listWatched, unwatchTopic } from "../lib/topics";

export default defineTool({
  description: "Remove a topic from the owner's topic inner circle.",
  inputSchema: z.object({ name: z.string() }),
  async execute({ name }) {
    const t = (await listWatched()).find((x) => x.name.toLowerCase() === name.toLowerCase());
    if (!t) return { error: `Not watching "${name}".` };
    await unwatchTopic(t.id);
    return { removed: t.name };
  },
});
