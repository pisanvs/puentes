import { getPersonById } from "@agent/lib/queries";
import { ArrowLeft, ExternalLink } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PersonActions, TrackToggle } from "../../../_dash/person-actions";
import { WarmthDot } from "../../../_dash/warmth-dot";
import { Avatar, contactLabel, platformLabel, relDay, typeLabel } from "../../../_dash/ui";

export const dynamic = "force-dynamic";

const profileUrl = (platform: string, handle: string) =>
  platform === "x" ? `https://x.com/${handle}` : platform === "linkedin" ? `https://www.linkedin.com/in/${handle}/` : `https://bsky.app/profile/${handle}`;

export default async function PersonPage({ params }: { params: Promise<{ id: string }> }) {
  const p = await getPersonById(Number((await params).id));
  if (!p) notFound();

  return (
    <>
      <Link href="/people" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> People
      </Link>

      <header className="flex flex-wrap items-center gap-4">
        <Avatar name={p.name} className="size-14 text-lg" />
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">{p.name}</h1>
          <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
            <WarmthDot personId={p.id} warmth={p.warmth} withLabel /> · {contactLabel(p.daysSinceContact)}
            {p.tags.length > 0 && ` · ${p.tags.join(", ")}`}
          </p>
          {p.warmthReason && <p className="text-xs text-muted-foreground">Warmth: {p.warmthReason}</p>}
          <div className="mt-1.5 flex flex-wrap gap-3 text-sm">
            {p.handles.map((h) => (
              <a key={h.platform} href={profileUrl(h.platform, h.handle)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground">
                {platformLabel(h.platform)} <ExternalLink className="size-3" />
              </a>
            ))}
          </div>
        </div>
        <div className="flex gap-2">
          <TrackToggle personId={p.id} tracked={p.tracked} />
          <PersonActions name={p.name} notes={p.notes} mode="contact" />
        </div>
      </header>

      {!p.tracked && p.priorityReason && (
        <p className="mt-4 text-sm text-muted-foreground">Suggested because: {p.priorityReason}</p>
      )}

      {p.openNudges.length > 0 && (
        <Link href="/" className="mt-6 block rounded-xl border border-brand/30 bg-brand-soft px-4 py-3 text-sm text-brand hover:border-brand/60">
          <span className="font-medium">Open in your inbox:</span> {p.openNudges.map((n) => n.reason).join(" · ")}
        </Link>
      )}

      <section className="mt-8">
        <h2 className="mb-3 text-sm font-medium text-muted-foreground">Recent updates</h2>
        {p.timeline.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing collected in the last few weeks.</p>
        ) : (
          <ol className="relative space-y-4 border-l pl-5">
            {p.timeline.map((t, i) => (
              <li key={i} className="relative">
                <span className="absolute top-1.5 -left-[25px] size-2.5 rounded-full border-2 border-background bg-brand" />
                <p className="text-xs text-muted-foreground">
                  {typeLabel(t.type)} · {relDay(t.occurredAt)}
                  {t.url && (
                    <a href={t.url} target="_blank" rel="noreferrer" className="ml-1.5 inline-flex items-center gap-0.5 hover:text-foreground">
                      source <ExternalLink className="size-3" />
                    </a>
                  )}
                </p>
                <p className="mt-0.5 text-sm">{t.summary}</p>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="mt-8">
        <h2 className="mb-3 text-sm font-medium text-muted-foreground">Notes</h2>
        <PersonActions name={p.name} notes={p.notes} mode="notes" />
      </section>
    </>
  );
}
