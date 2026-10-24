import { defineTool } from "eve/tools";
import { z } from "zod";
import { answerMet } from "../lib/new-people";
import { findPersonId } from "../lib/queries";

export default defineTool({
  description:
    "Record that the owner met someone in person (optionally where). Warms them up, adds them to the inner circle, notes where you met, and resets their 'going cold' clock. For several people at once, prefer log_day.",
  inputSchema: z.object({ name: z.string(), where: z.string().optional().describe("e.g. 'Replit house', 'a16z dinner'") }),
  async execute({ name, where }) {
    const p = await findPersonId(name);
    if ("error" in p) return p;
    await answerMet(p.id, "met", where);
    return { name, metInPerson: true, where: where ?? null };
  },
});
