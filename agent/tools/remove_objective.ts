import { defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { z } from "zod";
import { removeObjective, resetRanking } from "../lib/queries";

export default defineTool({
  description: "Delete one of the owner's objectives by id.",
  inputSchema: z.object({ id: z.number().int() }),
  approval: always(),
  async execute({ id }) {
    const o = await removeObjective(id);
    await resetRanking();
    return { removed: o.text };
  },
});
