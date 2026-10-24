import { defineTool } from "eve/tools";
import { z } from "zod";
import { findPersonId, setPinned } from "../lib/queries";

export default defineTool({
  description:
    "Pin (or unpin) someone as 'keep warm': they float to the top of People, their posts always push, and bridgr reminds the owner before the relationship goes cold.",
  inputSchema: z.object({ name: z.string(), pinned: z.boolean().default(true) }),
  async execute({ name, pinned }) {
    const p = await findPersonId(name);
    if ("error" in p) return p;
    await setPinned(p.id, pinned ?? true);
    return { name, pinned: pinned ?? true };
  },
});
