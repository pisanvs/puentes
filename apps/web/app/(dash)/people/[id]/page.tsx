import { getPersonDossier } from "@agent/lib/queries";
import { ArrowLeft, Briefcase, Database, ExternalLink, GraduationCap, Hash, HandHelping, Handshake, MapPin, Sparkles } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PersonActions, TrackToggle } from "../../../_dash/person-actions";
import { PinButton } from "../../../_dash/pin-button";
import { WarmthCurve } from "../../../_dash/warmth-curve";
import { WarmthDot } from "../../../_dash/warmth-dot";
import { Avatar, contactLabel, platformLabel, relDay, typeLabel } from "../../../_dash/ui";

export const dynamic = "force-dynamic";

const profileUrl = (platform: string, handle: string) =>
  platform === "x"
    ? `https://x.com/${handle}`
    : platform === "linkedin"
      ? `https://www.linkedin.com/in/${handle}/`
      : platform === "instagram"
        ? `https://www.instagram.com/${handle}/`
        : `https://bsky.app/profile/${handle}`;

const OBS_LABEL: Record<string, string> = {
  connection_made: "Connected",
  profile_observed: "Profile seen",
  entities_extracted: "Mined into graph",
  post_seen: "Post surfaced",
  job_change: "Job change",
  moved: "Moved",
  note_added: "Note added",
  contact_logged: "Contact logged",
  engaged_with: "You engaged",
  post_engagement: "Engagement seen",
  listening_trigger: "Listening trigger",
};

export default async function PersonPage({ params }: { params: Promise<{ id: string }> }) {
  const p = await getPersonDossier(Number((await params).id));
  if (!p) notFound();

  const { current } = p;
  const roleLine = [current.headline, current.company && `@ ${current.company}`, current.location].filter(Boolean).join(" ");

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
          {roleLine && <p className="mt-0.5 text-sm">{roleLine}</p>}
          {p.warmthReason && <p className="text-xs text-muted-foreground">Warmth: {p.warmthReason}</p>}
          <div className="mt-1.5 flex flex-wrap gap-3 text-sm">
            {p.identities.map((h) => (
              <a key={h.platform} href={profileUrl(h.platform, h.handle)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground">
                {platformLabel(h.platform)} <ExternalLink className="size-3" />
              </a>
            ))}
          </div>
        </div>
        <div className="flex gap-2">
          <PinButton personId={p.id} pinned={p.pinned} />
          <TrackToggle personId={p.id} tracked={p.tracked} />
          <PersonActions name={p.name} notes={p.notes} mode="contact" />
        </div>
      </header>

      {!p.tracked && p.priorityReason && <p className="mt-4 text-sm text-muted-foreground">Suggested because: {p.priorityReason}</p>}

      {/* The spaced-repetition warm/cold curve: warm-ups pump it up, then it releases toward cold. */}
      {p.reinforcements.length > 0 && (
        <div className="mt-6">
          <WarmthCurve reinforcements={p.reinforcements} now={Date.now()} />
        </div>
      )}

      {/* What we've collected, at a glance. */}
      <div className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat n={p.counts.identities} label="profiles" />
        <Stat n={p.counts.posts} label="posts scraped" />
        <Stat n={p.counts.events} label="events" />
        <Stat n={p.counts.observations} label="log entries" />
      </div>

      {/* Identity cards: the raw profile data per platform. */}
      {p.identities.some((i) => i.bio || i.followers || i.displayName) && (
        <Section title="Profiles">
          <div className="space-y-2">
            {p.identities.map((i) => (
              <div key={i.platform} className="rounded-xl border bg-card p-3 text-sm">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <a href={profileUrl(i.platform, i.handle)} target="_blank" rel="noreferrer" className="font-medium hover:underline">
                    {platformLabel(i.platform)}
                  </a>
                  <span className="text-muted-foreground">@{i.handle}</span>
                  {i.mutual && <span className="rounded-full bg-brand-soft px-2 py-0.5 text-xs text-brand">mutual</span>}
                  {i.followers != null && <span className="text-xs text-muted-foreground">{i.followers.toLocaleString()} followers</span>}
                </div>
                {i.bio && <p className="mt-1 text-muted-foreground">{i.bio}</p>}
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* What the graph knows: entities + what they're asking for / offering. */}
      {(hasGraph(p.graph) || p.asks.length > 0 || p.offers.length > 0) && (
        <Section title="What we know">
          <div className="space-y-2">
            <Chips icon={<Briefcase className="size-3" />} items={p.graph.orgs} />
            <Chips icon={<GraduationCap className="size-3" />} items={p.graph.schools} />
            <Chips icon={<MapPin className="size-3" />} items={[...p.graph.places]} />
            <Chips icon={<Hash className="size-3" />} items={p.graph.topics} tone="topic" />
            {p.asks.length > 0 && <Labeled label="Looking for" items={p.asks} icon={<HandHelping className="size-3" />} />}
            {p.offers.length > 0 && <Labeled label="Can offer" items={p.offers} icon={<Sparkles className="size-3" />} />}
          </div>
        </Section>
      )}

      {/* Related stuff: people who share entities, and any open intros. */}
      {(p.related.length > 0 || p.matches.length > 0) && (
        <Section title="Related people">
          <div className="space-y-2">
            {p.matches.map((m) => (
              <Link key={`m${m.matchId}`} href={`/intros`} className="block rounded-xl border border-brand/30 bg-brand-soft px-3 py-2 text-sm hover:border-brand/60">
                <span className="inline-flex items-center gap-1 font-medium text-brand">
                  <Handshake className="size-3.5" /> Intro to {m.otherName}
                </span>
                <span className="text-brand/80"> · {m.shared.join(", ")}</span>
              </Link>
            ))}
            {p.related.map((r) => (
              <Link key={r.personId} href={`/people/${r.personId}`} className="flex items-center justify-between gap-3 rounded-xl border bg-card px-3 py-2 text-sm hover:bg-card/60">
                <span className="flex items-center gap-2 font-medium">
                  <Avatar name={r.name} size="sm" /> {r.name}
                </span>
                <span className="truncate text-xs text-muted-foreground">{r.shared.join(", ")}</span>
              </Link>
            ))}
          </div>
        </Section>
      )}

      {/* Derived updates — the newspaper-grade events. */}
      <Section title="Updates">
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
      </Section>

      {/* Raw scraped posts. */}
      {p.posts.length > 0 && (
        <Details title="Scraped posts" count={p.counts.posts}>
          <div className="space-y-3">
            {p.posts.map((post, i) => (
              <article key={i} className="border-b pb-3 text-sm last:border-0">
                <p className="text-xs text-muted-foreground">
                  {platformLabel(post.platform)} · {relDay(post.postedAt)}
                  {post.url && (
                    <a href={post.url} target="_blank" rel="noreferrer" className="ml-1.5 inline-flex items-center gap-0.5 hover:text-foreground">
                      open <ExternalLink className="size-3" />
                    </a>
                  )}
                </p>
                <p className="mt-0.5 whitespace-pre-wrap">{post.text}</p>
              </article>
            ))}
          </div>
        </Details>
      )}

      {/* Profile history (snapshots over time). */}
      {p.snapshots.length > 0 && (
        <Details title="Profile history" count={p.snapshots.length}>
          <ul className="space-y-1.5 text-sm">
            {p.snapshots.map((s, i) => (
              <li key={i} className="flex flex-wrap items-center gap-x-2 text-muted-foreground">
                <span className="tabular-nums text-xs">{s.takenAt}</span>
                <span className="text-foreground">{[s.headline, s.company, s.location].filter(Boolean).join(" · ") || platformLabel(s.platform)}</span>
              </li>
            ))}
          </ul>
        </Details>
      )}

      {/* The raw event log. */}
      {p.observations.length > 0 && (
        <Details title="Event log" count={p.counts.observations} icon={<Database className="size-3.5" />}>
          <ol className="space-y-1 text-sm">
            {p.observations.map((o, i) => (
              <li key={i} className="flex flex-wrap items-baseline gap-x-2">
                <span className="tabular-nums text-xs text-muted-foreground">{o.when}</span>
                <span className="font-medium">{OBS_LABEL[o.kind] ?? o.kind}</span>
                <span className="text-xs text-muted-foreground">{o.source}</span>
                {o.summary && <span className="w-full text-muted-foreground sm:w-auto">{o.summary}</span>}
              </li>
            ))}
          </ol>
        </Details>
      )}

      <Section title="Notes">
        <PersonActions name={p.name} notes={p.notes} mode="notes" />
      </Section>
    </>
  );
}

function Stat({ n, label }: { n: number; label: string }) {
  return (
    <div className="rounded-xl border bg-card px-3 py-2 text-center">
      <p className="text-lg font-semibold tabular-nums">{n}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="mb-3 text-sm font-medium text-muted-foreground">{title}</h2>
      {children}
    </section>
  );
}

/** Collapsible block for the bulky raw data — kept out of the way but one click from everything. */
function Details({ title, count, icon, children }: { title: string; count?: number; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <details className="mt-8 group">
      <summary className="mb-3 flex cursor-pointer list-none items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground">
        {icon}
        {title}
        {count != null && <span className="rounded-full bg-muted px-1.5 text-xs tabular-nums">{count}</span>}
        <span className="ml-1 text-xs transition-transform group-open:rotate-90">›</span>
      </summary>
      {children}
    </details>
  );
}

function hasGraph(g: { orgs: string[]; schools: string[]; places: string[]; topics: string[]; events: string[] }) {
  return g.orgs.length + g.schools.length + g.places.length + g.topics.length + g.events.length > 0;
}

function Chips({ icon, items, tone }: { icon: React.ReactNode; items: string[]; tone?: "topic" }) {
  if (!items.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-muted-foreground">{icon}</span>
      {items.map((it) => (
        <span key={it} className={tone === "topic" ? "rounded-full bg-muted px-2 py-0.5 text-xs" : "rounded-full border px-2 py-0.5 text-xs"}>
          {it}
        </span>
      ))}
    </div>
  );
}

function Labeled({ label, items, icon }: { label: string; items: string[]; icon: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs">
      <span className="inline-flex items-center gap-1 font-medium text-muted-foreground">
        {icon} {label}:
      </span>
      {items.map((it) => (
        <span key={it} className="rounded-full border border-dashed px-2 py-0.5 text-muted-foreground">
          {it}
        </span>
      ))}
    </div>
  );
}
