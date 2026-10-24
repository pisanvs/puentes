import { defineTool } from "eve/tools";
import { z } from "zod";
import { listObjectives } from "../lib/queries";

export default defineTool({
  description: "List the owner's objectives, the goals every nudge is ranked against, with their ids and weights.",
  inputSchema: z.object({}),
  execute: () => listObjectives(),
});
