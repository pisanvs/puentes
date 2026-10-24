import { getOwner, ownerCard } from "@agent/lib/me";
import { listObjectives } from "@agent/lib/queries";
import { AboutYou } from "../../_dash/about-you";
import { ObjectivesEditor } from "../../_dash/objectives-editor";
import { PageHeader } from "../../_dash/ui";

export const dynamic = "force-dynamic";

export default async function YouPage() {
  const [objectives, me, card] = await Promise.all([listObjectives(), getOwner(), ownerCard()]);
  return (
    <>
      <PageHeader title="You" subtitle="Who you are and what you're after. Every update is read through this before it reaches you." />
      <AboutYou initial={me} card={card} />
      <h2 className="mb-3 text-sm font-medium text-muted-foreground">Objectives — what you want right now</h2>
      <ObjectivesEditor initial={objectives} />
    </>
  );
}
