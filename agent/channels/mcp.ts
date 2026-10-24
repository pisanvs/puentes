import { localDev } from "eve/channels/auth";
import { mcpChannel } from "eve/channels/mcp";

// Claude Code / Desktop: `claude mcp add --transport http puentes http://localhost:2000/eve/v1/mcp`
// localDev() only admits requests under `eve dev`; swap in real auth before deploying.
export default mcpChannel({
  auth: localDev(),
  tools: true,
  skills: true,
});
