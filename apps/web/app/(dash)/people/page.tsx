import { listPeople, listSuggestions } from "@agent/lib/queries";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { SuggestionList } from "../../_dash/suggestion-list";
import { WarmthDot } from "../../_dash/warmth-dot";
import { Avatar, EmptyState, PageHeader, platformLabel, relDay } from "../../_dash/ui";

export const dynamic = "force-dynamic";

export default async function PeoplePage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const tab = (await searchParams).tab === "suggestions" ? "suggestions" : "circle";
  const [people, suggestions] = await Promise.all([listPeople(), listSuggestions(150)]);

  return (
    <>
      <PageHeader
        title="People"
        subtitle={tab === "circle" ? "Your inner circle, longest since you talked first." : "Everyone you follow, best inner-circle candidates first."}
      />
      <div role="tablist" className="mb-4 inline-flex rounded-lg bg-muted p-0.5 text-sm">
        {(
          [
            ["circle", `Inner circle · ${people.length}`],
            ["suggestions", `Suggestions · ${suggestions.length}`],
          ] as const
        ).map(([id, label]) => (
          <Link
            key={id}
            role="tab"
            aria-selected={tab === id}
            href={id === "circle" ? "/people" : "/people?tab=suggestions"}
            className={cn("rounded-md px-3 py-1.5", tab === id ? "bg-card font-medium shadow-sm" : "text-muted-foreground hover:text-foreground")}
          >
            {label}
          </Link>
        ))}
      </div>

      {tab === "suggestions" ? (
        <SuggestionList initial={suggestions} />
      ) : people.length === 0 ? (
        <EmptyState title="No one in your inner circle yet" body="Import who you follow from Sources, then add the best suggestions." />
      ) : (
        <ul className="divide-y overflow-hidden rounded-xl border bg-card shadow-sm">
          {people.map((p) => (
            <li key={p.id}>
              <Link href={`/people/${p.id}`} className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/50">
                <Avatar name={p.name} size="sm" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <WarmthDot personId={p.id} warmth={p.warmth} />
                    <span className="font-medium">{p.name}</span>
                    {p.openNudges > 0 && (
                      <span className="rounded-full bg-brand-soft px-1.5 text-xs font-medium text-brand">{p.openNudges} open</span>
                    )}
                  </div>
                  <p className="truncate text-sm text-muted-foreground">
                    {p.lastUpdate ? `${p.lastUpdate.summary} · ${relDay(p.lastUpdate.occurredAt)}` : p.platforms.map(platformLabel).join(" · ") || "No handles"}
                  </p>
                </div>
                <span
                  className={cn(
                    "shrink-0 text-right text-xs tabular-nums",
                    p.daysSinceContact === null || p.daysSinceContact > 60 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground",
                  )}
                >
                  {p.daysSinceContact === null ? "never logged" : p.daysSinceContact === 0 ? "today" : `${p.daysSinceContact}d`}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
