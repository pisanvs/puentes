import { metPlaces, newPeople } from "@agent/lib/new-people";
import { getNudges } from "@agent/lib/queries";
import { NewPeoplePrompt } from "../_dash/new-people-prompt";
import { NudgeInbox } from "../_dash/nudge-inbox";
import { PageHeader } from "../_dash/ui";

export const dynamic = "force-dynamic";

export default async function InboxPage() {
  const [nudges, fresh, places] = await Promise.all([getNudges(50), newPeople(10), metPlaces()]);
  return (
    <>
      <PageHeader
        title="Inbox"
        subtitle={
          nudges.length
            ? `${nudges.length} people worth reaching out to, ranked by your objectives.`
            : "Nothing waiting on you."
        }
      />
      <NewPeoplePrompt initial={fresh} places={places} />
      <NudgeInbox initial={nudges} />
    </>
  );
}
