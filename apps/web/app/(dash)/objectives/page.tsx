import { listObjectives } from "@agent/lib/queries";
import { ObjectivesEditor } from "../../_dash/objectives-editor";
import { PageHeader } from "../../_dash/ui";

export const dynamic = "force-dynamic";

export default async function ObjectivesPage() {
  const objectives = await listObjectives();
  return (
    <>
      <PageHeader
        title="Objectives"
        subtitle="What bridgr optimizes for. Every update is scored against these, so be specific: goals, trips, people you want to meet."
      />
      <ObjectivesEditor initial={objectives} />
    </>
  );
}
