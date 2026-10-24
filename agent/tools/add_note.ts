import { defineTool } from "eve/tools";
import { z } from "zod";
import { addNote } from "../lib/queries";

export default defineTool({
  description: "Add a dated CRM note about a friend (e.g. 'kid born in March', 'wants intros to climate VCs').",
  inputSchema: z.object({ name: z.string().min(1), note: z.string().min(1) }),
  execute: ({ name, note }) => addNote(name, note),
});
