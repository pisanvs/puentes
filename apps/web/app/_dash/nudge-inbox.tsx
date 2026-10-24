"use client";

import type { getNudges } from "@agent/lib/queries";
import { Check, Clock, Copy, ExternalLink, MessageCircle, Target, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { closeNudge, snooze } from "./actions";
import { Avatar, EmptyState, contactLabel, platformLabel, relDay, typeLabel } from "./ui";

type Nudge = Awaited<ReturnType<typeof getNudges>>[number];

const waLink = (phone: string, text: string) => `https://wa.me/${phone.replace(/\D/g, "")}?text=${encodeURIComponent(text)}`;
const phoneFrom = (sendLink: string | null) => sendLink?.match(/wa\.me\/(\d+)/)?.[1] ?? null;

export function NudgeInbox({ initial }: { initial: Nudge[] }) {
  const [items, setItems] = useState(initial);
  const [focus, setFocus] = useState(0);
  const [, startTransition] = useTransition();
  const cards = useRef<(HTMLElement | null)[]>([]);

  // Server data changed (refresh finished, another tab acted): take it.
  useEffect(() => setItems(initial), [initial]);

  const remove = (id: number, act: () => Promise<void>) => {
    setItems((list) => list.filter((n) => n.nudgeId !== id));
    startTransition(act);
  };
  const done = (id: number) => remove(id, () => closeNudge(id, "done"));
  const dismiss = (id: number) => remove(id, () => closeNudge(id, "dismissed"));
  const later = (id: number, days: number) => remove(id, () => snooze(id, days));

  // j/k to move, d done, s snooze 3 days, x dismiss, c copy draft.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest("textarea, input, [role=menu]") || e.metaKey || e.ctrlKey || e.altKey) return;
      const current = items[focus];
      if (e.key === "j") setFocus((f) => Math.min(f + 1, items.length - 1));
      else if (e.key === "k") setFocus((f) => Math.max(f - 1, 0));
      else if (!current) return;
      else if (e.key === "d") done(current.nudgeId);
      else if (e.key === "s") later(current.nudgeId, 3);
      else if (e.key === "x") dismiss(current.nudgeId);
      else if (e.key === "c") cards.current[focus]?.querySelector<HTMLButtonElement>("[data-copy]")?.click();
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  useEffect(() => {
    setFocus((f) => Math.min(f, Math.max(items.length - 1, 0)));
  }, [items.length]);

  useEffect(() => {
    cards.current[focus]?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [focus]);

  if (items.length === 0)
    return <EmptyState title="You're all caught up" body="New nudges show up here after a refresh. Turn on desktop alerts to get pinged when they do." />;

  return (
    <div className="space-y-3">
      <AnimatePresence initial={false}>
        {items.map((n, i) => (
          <motion.article
            key={n.nudgeId}
            ref={(el) => {
              cards.current[i] = el;
            }}
            layout
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, x: 40, transition: { duration: 0.18 } }}
            onClick={() => setFocus(i)}
            className={cn(
              "rounded-xl border bg-card p-4 shadow-sm transition-shadow md:p-5",
              i === focus && "ring-2 ring-brand/40",
            )}
          >
            <NudgeCard nudge={n} onDone={done} onDismiss={dismiss} onSnooze={later} />
          </motion.article>
        ))}
      </AnimatePresence>
      <p className="hidden pt-2 text-center text-xs text-muted-foreground md:block">
        <Kbd>j</Kbd>/<Kbd>k</Kbd> move · <Kbd>c</Kbd> copy draft · <Kbd>d</Kbd> done · <Kbd>s</Kbd> snooze · <Kbd>x</Kbd> dismiss
      </p>
    </div>
  );
}

function Kbd({ children }: { children: string }) {
  return <kbd className="rounded border bg-card px-1 font-mono text-[11px]">{children}</kbd>;
}

function NudgeCard({
  nudge: n,
  onDone,
  onDismiss,
  onSnooze,
}: {
  nudge: Nudge;
  onDone: (id: number) => void;
  onDismiss: (id: number) => void;
  onSnooze: (id: number, days: number) => void;
}) {
  const [draft, setDraft] = useState(n.draft);
  const [copied, setCopied] = useState(false);
  const phone = phoneFrom(n.sendLink);

  const copy = async () => {
    await navigator.clipboard.writeText(draft);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <>
      <header className="flex items-start gap-3">
        <Avatar name={n.person} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <Link href={`/people/${n.personId}`} className="font-semibold hover:underline">
              {n.person}
            </Link>
            <span className="text-xs text-muted-foreground">
              {typeLabel(n.type)} · {relDay(n.when)}
              {n.platform && (
                <>
                  {" · "}
                  {n.sourceUrl ? (
                    <a href={n.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 hover:text-foreground">
                      {platformLabel(n.platform)} <ExternalLink className="size-3" />
                    </a>
                  ) : (
                    platformLabel(n.platform)
                  )}
                </>
              )}
            </span>
          </div>
          <p className="mt-1 font-medium leading-snug text-brand">{n.reason}</p>
          <p className="mt-1 text-sm text-muted-foreground">{n.update}</p>
        </div>
      </header>

      <div className="mt-3 flex flex-wrap items-center gap-2 pl-[52px] text-xs text-muted-foreground">
        {n.objective && (
          <span className="inline-flex items-center gap-1 rounded-full bg-brand-soft px-2 py-0.5 text-brand">
            <Target className="size-3" /> {n.objective}
          </span>
        )}
        <span>{contactLabel(n.daysSinceContact)}</span>
      </div>

      <div className="mt-3 md:pl-[52px]">
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={2}
          aria-label={`Draft message to ${n.person}`}
          className="min-h-0 resize-none border-transparent bg-muted/60 text-sm leading-relaxed shadow-none focus-visible:bg-card"
        />
      </div>

      <footer className="mt-3 flex flex-wrap items-center gap-2 md:pl-[52px]">
        <Button size="sm" variant="secondary" onClick={copy} data-copy>
          {copied ? <Check /> : <Copy />}
          {copied ? "Copied" : "Copy"}
        </Button>
        {phone && (
          <Button size="sm" variant="secondary" asChild>
            <a href={waLink(phone, draft)} target="_blank" rel="noreferrer">
              <MessageCircle /> WhatsApp
            </a>
          </Button>
        )}
        <div className="ml-auto flex items-center gap-1">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="ghost">
                <Clock /> Snooze
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => onSnooze(n.nudgeId, 1)}>Tomorrow</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onSnooze(n.nudgeId, 3)}>In 3 days</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onSnooze(n.nudgeId, 7)}>Next week</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button size="sm" variant="ghost" onClick={() => onDismiss(n.nudgeId)} aria-label="Dismiss">
            <X />
          </Button>
          <Button size="sm" className="bg-brand text-white hover:bg-brand/90 dark:text-black" onClick={() => onDone(n.nudgeId)}>
            <Check /> Done
          </Button>
        </div>
      </footer>
    </>
  );
}
