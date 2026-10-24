import { todayEdition } from "@agent/lib/edition";
import { listNearby } from "@agent/lib/nearby";
import { pipelineStatus } from "../../_dash/actions";
import { NearbyStrip } from "../../_dash/nearby-strip";
import { TodayPaper } from "../../_dash/today-paper";

export const dynamic = "force-dynamic";

export default async function TodayPage() {
  const [edition, status, nearby] = await Promise.all([todayEdition(), pipelineStatus(), listNearby()]);
  return (
    <>
      <div className="mx-auto max-w-3xl">
        <NearbyStrip initial={nearby} />
      </div>
      <TodayPaper edition={edition} status={status} />
    </>
  );
}
