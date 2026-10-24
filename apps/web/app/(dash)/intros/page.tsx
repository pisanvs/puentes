import { getMatches } from "@agent/lib/queries";
import { IntroList } from "../../_dash/intro-list";
import { PageHeader } from "../../_dash/ui";

export const dynamic = "force-dynamic";

export default async function IntrosPage() {
  const matches = await getMatches(30);
  return (
    <>
      <PageHeader title="Intros" subtitle="Friends whose updates overlap and who'd likely thank you for connecting them." />
      <IntroList initial={matches} />
    </>
  );
}
