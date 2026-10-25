import { defineTool } from "eve/tools";
import { z } from "zod";
import { noteAndIndex } from "../lib/dump";

export default defineTool({
  description:
    "Add a dated note about a friend (e.g. 'Andrés is in SF this week', 'kid due in March', 'wants intros to climate VCs'). The note is also indexed: whereabouts, life updates, asks and dates become an event that shows in their timeline, the paper, and who's here.",
  inputSchema: z.object({ name: z.string().min(1), note: z.string().min(1) }),
  execute: ({ name, note }) => noteAndIndex(name, note),
});
