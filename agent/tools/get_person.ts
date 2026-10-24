import { defineTool } from "eve/tools";
import { z } from "zod";
import { getPerson } from "../lib/queries";

export default defineTool({
  description:
    "Look up one friend: handles, tags, notes, days since last contact, open nudges, and a timeline of their recent life updates.",
  inputSchema: z.object({ name: z.string().min(1).describe("Full or partial name.") }),
  label: { start: ({ name }) => `Look up ${name}` },
  execute: ({ name }) => getPerson(name),
});
