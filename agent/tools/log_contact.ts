import { defineTool } from "eve/tools";
import { z } from "zod";
import { logContact } from "../lib/queries";

export default defineTool({
  description:
    "Record that the owner talked to a friend (today, or N days ago). Also closes that friend's open nudges.",
  inputSchema: z.object({ name: z.string().min(1), daysAgo: z.number().int().min(0).default(0) }),
  execute: ({ name, daysAgo }) => logContact(name, daysAgo ?? 0),
});
