import type { ReactNode } from "react";
import { getMatches, getNudges } from "@agent/lib/queries";
import { pipelineStatus } from "../_dash/actions";
import { Shell } from "../_dash/shell";

export const dynamic = "force-dynamic";

export default async function DashLayout({ children }: { children: ReactNode }) {
  const [nudges, matches, status] = await Promise.all([getNudges(100), getMatches(100), pipelineStatus()]);
  return (
    <Shell counts={{ nudges: nudges.length, matches: matches.length }} status={status}>
      {children}
    </Shell>
  );
}
