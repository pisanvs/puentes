"use client";

import type { getMatches } from "@agent/lib/queries";
import { Check, Copy } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { closeMatch } from "./actions";
import { Avatar, EmptyState } from "./ui";

type Match = Awaited<ReturnType<typeof getMatches>>[number];

/** "place: lisbon" / `ask "x" ↔ offer "y"` → short chip text */
const chip = (s: string) => (s.startsWith("ask ") ? "ask ↔ offer" : s.replace(/^(\w+): /, "").replace(/\b\w/g, (c) => c.toUpperCase()));

export function IntroList({ initial }: { initial: Match[] }) {
  const [items, setItems] = useState(initial);
  const [, startTransition] = useTransition();
  useEffect(() => setItems(initial), [initial]);

  const close = (id: number, outcome: "done" | "dismissed") => {
    setItems((list) => list.filter((m) => m.matchId !== id));
    startTransition(() => closeMatch(id, outcome));
  };

  if (items.length === 0)
    return <EmptyState title="No intros right now" body="When two friends' updates line up (same city, same space, or one's ask fits the other's offer), they'll show up here." />;

  return (
    <div className="space-y-3">
      <AnimatePresence initial={false}>
        {items.map((m) => (
          <motion.article
            key={m.matchId}
            layout
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, x: 40, transition: { duration: 0.18 } }}
            className="rounded-xl border bg-card p-4 shadow-sm md:p-5"
          >
            <IntroCard match={m} onClose={close} />
          </motion.article>
        ))}
      </AnimatePresence>
    </div>
  );
}

function IntroCard({ match: m, onClose }: { match: Match; onClose: (id: number, outcome: "done" | "dismissed") => void }) {
  const [draft, setDraft] = useState(m.draftIntro);
  const [copied, setCopied] = useState(false);
  const chips = [...new Set(m.overlap.map(chip))];

  return (
    <>
      <header className="flex items-center gap-3">
        <div className="flex -space-x-2">
          {m.people.map((p) => (
            <Avatar key={p} name={p} />
          ))}
        </div>
        <p className="font-semibold">
          <Link href={`/people/${m.personIds[0]}`} className="hover:underline">{m.people[0]}</Link>
          <span className="px-1.5 font-normal text-muted-foreground">and</span>
          <Link href={`/people/${m.personIds[1]}`} className="hover:underline">{m.people[1]}</Link>
        </p>
      </header>
      <p className="mt-3 font-medium leading-snug text-brand">{m.reason}</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {chips.map((c) => (
          <span key={c} className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
            {c}
          </span>
        ))}
      </div>
      <p className="mt-4 mb-1.5 text-xs font-medium text-muted-foreground">
        Intro draft. Ask each of them privately first, then send this to both.
      </p>
      <Textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={3}
        aria-label="Intro draft"
        className="min-h-0 resize-none border-transparent bg-muted/60 text-sm leading-relaxed shadow-none focus-visible:bg-card"
      />
      <footer className="mt-3 flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="secondary"
          onClick={async () => {
            await navigator.clipboard.writeText(draft);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy"}
        </Button>
        <div className="ml-auto flex gap-1">
          <Button size="sm" variant="ghost" onClick={() => onClose(m.matchId, "dismissed")}>
            Not a fit
          </Button>
          <Button size="sm" className="bg-brand text-white hover:bg-brand/90 dark:text-black" onClick={() => onClose(m.matchId, "done")}>
            <Check /> Made the intro
          </Button>
        </div>
      </footer>
    </>
  );
}
