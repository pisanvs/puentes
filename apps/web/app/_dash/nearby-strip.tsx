"use client";

import type { listNearby } from "@agent/lib/nearby";
import { Check, Copy, Home, MapPin, MessageCircle, Plane, RefreshCw, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { closeNearby, refreshNearby } from "./actions";
import { Avatar, relDay } from "./ui";

type Data = Awaited<ReturnType<typeof listNearby>>;
type Match = Data["people"][number];

const waLink = (phone: string, text: string) => `https://wa.me/${phone.replace(/\D/g, "")}?text=${encodeURIComponent(text)}`;
const short = (iso?: string) => (iso ? new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "");

/**
 * "Who's here now": people in your network who are in the city you're in, worth meeting while you
 * are. Story 1 — the right person, the right place, right now.
 */
export function NearbyStrip({ initial }: { initial: Data }) {
  const [people, setPeople] = useState(initial.people);
  const [refreshing, start] = useTransition();
  const [, act] = useTransition();
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => setPeople(initial.people), [initial.people]);

  if (!initial.place) return null;
  // At home with nobody found: stay out of the way.
  if (!initial.traveling && people.length === 0) return null;

  const refresh = () =>
    start(async () => {
      const r = await refreshNearby();
      setNote(r.matches ? null : `No one new in ${r.place ?? "town"} yet — it re-checks after every scan.`);
    });
  const close = (id: number, outcome: "done" | "dismissed") => {
    setPeople((list) => list.filter((p) => p.id !== id));
    act(() => closeNearby(id, outcome));
  };

  return (
    <section className="mb-5 overflow-hidden rounded-xl border border-sky-500/30 bg-sky-500/[0.06] shadow-sm">
      <header className="flex flex-wrap items-center gap-2 px-4 pt-3.5 pb-2">
        {initial.traveling ? <Plane className="size-4 text-sky-600 dark:text-sky-400" /> : <Home className="size-4 text-sky-600 dark:text-sky-400" />}
        <p className="text-sm font-semibold">
          Here in {initial.place}
          {initial.traveling && initial.to && <span className="font-normal text-muted-foreground"> · you're here until {short(initial.to)}</span>}
        </p>
        <Button size="sm" variant="ghost" className="ml-auto h-7 text-xs" disabled={refreshing} onClick={refresh}>
          <RefreshCw className={cn("size-3.5", refreshing && "animate-spin")} />
          {refreshing ? "Looking…" : "Who's here?"}
        </Button>
      </header>

      {people.length === 0 ? (
        <p className="px-4 pb-4 text-sm text-muted-foreground">
          {note ?? `Nobody from your network spotted in ${initial.place} yet. Hit "Who's here?" — bridgr reads recent posts and bios to find them.`}
        </p>
      ) : (
        <ul className="divide-y divide-sky-500/15">
          {people.map((p) => (
            <NearbyRow key={p.id} match={p} onClose={close} />
          ))}
        </ul>
      )}
    </section>
  );
}

function NearbyRow({ match: m, onClose }: { match: Match; onClose: (id: number, outcome: "done" | "dismissed") => void }) {
  const [copied, setCopied] = useState(false);
  const seen = m.evidence.filter((e) => e.kind === "here_now").sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""));
  const lives = m.evidence.find((e) => e.kind === "based_here");
  const youSaid = m.evidence.find((e) => e.kind === "you_said");
  const copy = async () => {
    await navigator.clipboard.writeText(m.draft);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <li className="flex gap-3 px-4 py-3">
      <Avatar name={m.name} size="sm" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <Link href={`/people/${m.personId}`} className="font-semibold hover:underline">
            {m.name}
          </Link>
          {youSaid && (
            <span className="inline-flex items-center gap-0.5 rounded-full bg-brand-soft px-1.5 py-0.5 text-[11px] text-brand">
              <MessageCircle className="size-3" /> you said they're here
            </span>
          )}
          {seen.length > 0 && !youSaid && (
            <span className="inline-flex items-center gap-0.5 rounded-full bg-sky-500/15 px-1.5 py-0.5 text-[11px] text-sky-700 dark:text-sky-300">
              <MapPin className="size-3" /> seen here {relDay(seen[0].at!)}
            </span>
          )}
          {lives && !seen.length && !youSaid && (
            <span className="inline-flex items-center gap-0.5 rounded-full bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
              <Home className="size-3" /> lives here
            </span>
          )}
        </div>
        <p className="mt-0.5 text-sm leading-snug">{m.reason}</p>
        <p className="mt-1.5 rounded-lg bg-card/70 px-2.5 py-1.5 text-sm text-muted-foreground italic">“{m.draft}”</p>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <Button size="sm" variant="secondary" className="h-7 text-xs" onClick={copy}>
            {copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy"}
          </Button>
          {m.phone && (
            <Button size="sm" variant="secondary" className="h-7 text-xs" asChild>
              <a href={waLink(m.phone, m.draft)} target="_blank" rel="noreferrer">
                <MessageCircle /> WhatsApp
              </a>
            </Button>
          )}
          <Button size="sm" variant="ghost" className="ml-auto h-7 text-xs" onClick={() => onClose(m.id, "dismissed")} aria-label={`Dismiss ${m.name}`}>
            <X />
          </Button>
          <Button size="sm" className="h-7 bg-brand text-xs text-white hover:bg-brand/90 dark:text-black" onClick={() => onClose(m.id, "done")}>
            <Check /> Reached out
          </Button>
        </div>
      </div>
    </li>
  );
}
