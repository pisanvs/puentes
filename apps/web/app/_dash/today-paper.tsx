"use client";

import type { todayEdition } from "@agent/lib/edition";
import { ExternalLink, HandHelping, MapPin, Newspaper, RefreshCw, Sparkles } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { PipelineStatus } from "./actions";
import { startRefresh } from "./actions";
import { SECTIONS, platformLabel, relDay, sectionFor, typeLabel } from "./ui";
import { useJob } from "./use-job";

type Edition = Awaited<ReturnType<typeof todayEdition>>;
type Story = Edition["stories"][number];

// A serif face turns the dashboard into something that reads like print.
const serif = "font-['Georgia','Times_New_Roman',serif]";

const longDate = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });

export function TodayPaper({ edition, status }: { edition: Edition; status: PipelineStatus }) {
  const [job] = useJob("pipeline", status);
  // The paper is a projection of the event log — it renders whatever the log holds right now.
  // "Scan" is a separate, background concern: it sends the agent to find NEW signals, which land in
  // the log and show up here on the next render. The periodic scan schedule does this automatically.
  const scanning = job.state === "running";
  const scan = () => startRefresh(true);

  const { stories } = edition;
  const [lead, ...rest] = stories;

  return (
    <div className="mx-auto max-w-3xl">
      <Masthead date={edition.date} counts={edition.counts} job={job} scanning={scanning} onScan={scan} />

      {stories.length === 0 ? (
        <AwaitingEdition scanning={scanning} onScan={scan} days={edition.sinceDays} />
      ) : (
        <>
          <LeadStory story={lead} />
          {SECTIONS.map((section) => {
            const items = rest.filter((s) => sectionFor(s.type) === section.id);
            if (!items.length) return null;
            return (
              <section key={section.id} className="mt-8">
                <SectionRule label={section.label} />
                <div className="mt-4 gap-x-8 gap-y-5 sm:columns-2 [&>*]:mb-5 [&>*]:break-inside-avoid">
                  {items.map((s) => (
                    <Brief key={s.eventId} story={s} />
                  ))}
                </div>
              </section>
            );
          })}
          <p className="mt-10 border-t border-foreground/15 pt-3 text-center text-[11px] uppercase tracking-widest text-muted-foreground">
            Puentes · compiled from your network · covering the last {edition.sinceDays} days
          </p>
        </>
      )}
    </div>
  );
}

function ago(ms?: number) {
  if (!ms) return "never";
  const min = Math.round((Date.now() - ms) / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const h = Math.round(min / 60);
  return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

function Masthead({
  date,
  counts,
  job,
  scanning,
  onScan,
}: {
  date: string;
  counts: Edition["counts"];
  job: PipelineStatus;
  scanning: boolean;
  onScan: () => void;
}) {
  return (
    <header className="text-center">
      <div className="flex items-center justify-between gap-2 text-[11px] uppercase tracking-widest text-muted-foreground">
        <span className="hidden sm:inline">Vol. I</span>
        <span className="flex items-center gap-1.5">
          <Newspaper className="size-3" /> Your network
        </span>
        <span className="hidden sm:inline">{counts.today} today</span>
      </div>
      <div className="mt-1 border-y-2 border-foreground py-2">
        <h1 className={cn(serif, "text-4xl font-black tracking-tight sm:text-5xl")}>Puentes Daily</h1>
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-center gap-x-2 text-xs text-muted-foreground">
        <span className="uppercase tracking-wider">{longDate(date)}</span>
        <span>·</span>
        <span>
          {counts.stories} {counts.stories === 1 ? "story" : "stories"} · {counts.people} people
          {counts.nudged > 0 && ` · ${counts.nudged} worth acting on`}
        </span>
      </div>

      {/* The paper is set from the event log; scanning is the agent refilling the log, kept secondary. */}
      <div className="mt-3 flex items-center justify-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          {scanning ? (
            <>
              <RefreshCw className="size-3 animate-spin" /> {job.message ?? "Scanning your network…"}
            </>
          ) : (
            <>Set from your event log · scanner last ran {ago(job.finishedAt)} · auto 4×/day</>
          )}
        </span>
        <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" disabled={scanning} onClick={onScan}>
          {scanning ? "Scanning…" : "Scan now"}
        </Button>
      </div>
    </header>
  );
}

function SectionRule({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="h-px flex-1 bg-foreground/20" />
      <h2 className={cn(serif, "text-xs font-bold uppercase tracking-[0.2em]")}>{label}</h2>
      <span className="h-px flex-1 bg-foreground/20" />
    </div>
  );
}

function LeadStory({ story: s }: { story: Story }) {
  return (
    <article className="mt-6 border-b border-foreground/15 pb-6">
      <Kicker story={s} lead />
      <h2 className={cn(serif, "mt-1.5 text-2xl font-bold leading-tight sm:text-3xl")}>
        <Headline story={s} />
      </h2>
      {s.why && (
        <p className="mt-2 flex items-start gap-1.5 text-sm font-medium text-brand">
          <Sparkles className="mt-0.5 size-3.5 shrink-0" /> {s.why}
        </p>
      )}
      <Byline story={s} />
      <StoryExtras story={s} />
    </article>
  );
}

function Brief({ story: s }: { story: Story }) {
  return (
    <article>
      <Kicker story={s} />
      <h3 className={cn(serif, "mt-1 text-base font-bold leading-snug")}>
        <Headline story={s} />
      </h3>
      {s.why && <p className="mt-1 text-xs font-medium text-brand">{s.why}</p>}
      <Byline story={s} />
      <StoryExtras story={s} compact />
    </article>
  );
}

/** The summary is the headline; clicking it opens the person. */
function Headline({ story: s }: { story: Story }) {
  return (
    <Link href={`/people/${s.personId}`} className="decoration-foreground/30 hover:underline">
      {s.summary}
    </Link>
  );
}

function Kicker({ story: s, lead }: { story: Story; lead?: boolean }) {
  return (
    <div className="flex items-center gap-2 text-[11px] uppercase tracking-widest text-muted-foreground">
      <span className={cn("font-semibold", lead ? "text-brand" : "text-foreground/70")}>{typeLabel(s.type)}</span>
      {s.isToday && <span className="rounded-sm bg-brand px-1 py-0.5 text-[10px] font-bold text-white dark:text-black">TODAY</span>}
    </div>
  );
}

function Byline({ story: s }: { story: Story }) {
  const platform = platformLabel(s.platform);
  return (
    <p className="mt-1.5 text-xs italic text-muted-foreground">
      <Link href={`/people/${s.personId}`} className="font-medium not-italic text-foreground hover:underline">
        {s.person}
      </Link>{" "}
      · {relDay(s.occurredAt)}
      {platform && (
        <>
          {" · "}
          {s.sourceUrl ? (
            <a href={s.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 not-italic hover:text-foreground">
              {platform} <ExternalLink className="size-3" />
            </a>
          ) : (
            <span className="not-italic">{platform}</span>
          )}
        </>
      )}
    </p>
  );
}

function StoryExtras({ story: s, compact }: { story: Story; compact?: boolean }) {
  const asks = s.asks.filter(Boolean);
  const places = s.places.filter(Boolean);
  if (!asks.length && !places.length && !s.objective) return null;
  return (
    <div className={cn("mt-2 flex flex-wrap items-center gap-1.5 text-[11px]", compact && "mt-1.5")}>
      {s.objective && (
        <span className="inline-flex items-center gap-1 rounded-full bg-brand-soft px-2 py-0.5 text-brand">{s.objective}</span>
      )}
      {asks.map((a) => (
        <span key={a} className="inline-flex items-center gap-1 rounded-full border border-dashed px-2 py-0.5 text-muted-foreground">
          <HandHelping className="size-3" /> {a}
        </span>
      ))}
      {places.map((p) => (
        <span key={p} className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-muted-foreground">
          <MapPin className="size-3" /> {p}
        </span>
      ))}
    </div>
  );
}

function AwaitingEdition({ scanning, onScan, days }: { scanning: boolean; onScan: () => void; days: number }) {
  return (
    <div className="mt-10 border-y border-foreground/15 py-16 text-center">
      <Newspaper className="mx-auto size-8 text-muted-foreground" />
      <p className={cn(serif, "mt-3 text-xl font-bold")}>Nothing in the log yet</p>
      <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
        This paper is set from your event log. The scanner runs automatically through the day, reading your inner circle's socials
        and logging the real signals from the last {days} days — they'll appear here as it finds them. Or send it now.
      </p>
      <Button className="mt-4" variant="secondary" disabled={scanning} onClick={onScan}>
        <RefreshCw className={cn(scanning && "animate-spin")} />
        {scanning ? "Scanning your network…" : "Scan now"}
      </Button>
    </div>
  );
}
