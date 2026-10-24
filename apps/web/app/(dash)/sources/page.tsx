import { listAccounts } from "@agent/lib/contacts";
import { readJob } from "@agent/lib/jobs";
import { countSuggestions } from "@agent/lib/queries";
import Link from "next/link";
import { SourcesPanel } from "../../_dash/sources-panel";
import { PageHeader } from "../../_dash/ui";

export const dynamic = "force-dynamic";

const PLATFORMS = ["x", "linkedin", "instagram", "bluesky"] as const;

export default async function SourcesPage() {
  const [accounts, suggestions] = await Promise.all([listAccounts(), countSuggestions()]);
  return (
    <>
      <PageHeader
        title="Sources"
        subtitle="Sign in once, right here. Puentes keeps its own browser signed in so it can read who you follow."
      />
      <SourcesPanel
        sources={PLATFORMS.map((p) => ({
          platform: p,
          account: accounts.find((a) => a.platform === p) ?? null,
          connectJob: p === "bluesky" ? null : readJob(`connect-${p}`),
          importJob: readJob(`import-${p}`),
        }))}
      />
      {suggestions > 0 && (
        <Link
          href="/people?tab=suggestions"
          className="mt-6 flex items-center justify-between rounded-xl border border-brand/30 bg-brand-soft px-4 py-3 text-sm text-brand hover:border-brand/60"
        >
          <span>
            <span className="font-medium">{suggestions} people imported.</span> Pick who's in your inner circle.
          </span>
          <span aria-hidden>→</span>
        </Link>
      )}
      <p className="mt-6 text-xs leading-relaxed text-muted-foreground">
        Puentes reads the same API responses the sites load for you, slowly and only for people you pick. Your sessions stay in
        Puentes' own browser profile (<code>.profile/</code>) on this machine — it never touches your everyday Chrome.
      </p>
    </>
  );
}
