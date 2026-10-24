import { defineTool } from "eve/tools";
import { z } from "zod";
import { parseDump } from "../lib/dump";

export default defineTool({
  description:
    "File the owner's free-form recap of who they saw and what's new ('met Ana at the a16z dinner, she's raising; ran into Gadi, he's hiring iOS'). Creates or updates each person, warms up the people they met in person (with where), and records what's new as events. Use whenever the owner tells you about their day or people they ran into.",
  inputSchema: z.object({ text: z.string().min(3).describe("The owner's recap, verbatim or lightly cleaned.") }),
  async execute({ text }) {
    const recorded = await parseDump(text);
    return {
      recorded: recorded.map((r) => ({ name: r.name, metInPerson: r.met, where: r.where, newPerson: r.created, update: r.summary })),
    };
  },
});
