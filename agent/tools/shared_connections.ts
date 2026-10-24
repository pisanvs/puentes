import { defineTool } from "eve/tools";
import { z } from "zod";
import { sharedWith } from "../lib/graph/query";
import { findPersonId } from "../lib/queries";

export default defineTool({
  description:
    "Given one person, find who else in the owner's network overlaps with them — same employer, school, cohort, place or specific topic. Distinctive overlaps rank first. Good for warm intros and 'who connects me to X'.",
  inputSchema: z.object({ name: z.string().min(1), limit: z.number().int().min(1).max(30).optional() }),
  label: { start: ({ name }) => `Overlaps with ${name}` },
  async execute({ name, limit }) {
    const id = await findPersonId(name);
    if ("error" in id) return id;
    const rows = await sharedWith(id.id, limit ?? 15);
    return rows.map((r) => ({ name: r.name, shared: r.shared, inInnerCircle: r.tracked }));
  },
});
