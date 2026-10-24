import { todayEdition } from "@agent/lib/edition";
import { pipelineStatus } from "../../_dash/actions";
import { TodayPaper } from "../../_dash/today-paper";

export const dynamic = "force-dynamic";

export default async function TodayPage() {
  const [edition, status] = await Promise.all([todayEdition(), pipelineStatus()]);
  return <TodayPaper edition={edition} status={status} />;
}
