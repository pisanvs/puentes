"use client";

import type { listSuggestions } from "@agent/lib/queries";
import { Plus, Repeat2 } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { addTopSuggestions, track } from "./actions";
import { Avatar, EmptyState, platformLabel } from "./ui";

type Suggestion = Awaited<ReturnType<typeof listSuggestions>>[number];

const compact = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${Math.round(n / 1_000)}k` : String(n));

export function SuggestionList({ initial }: { initial: Suggestion[] }) {
  const [items, setItems] = useState(initial);
  const [pending, startTransition] = useTransition();
  useEffect(() => setItems(initial), [initial]);

  if (items.length === 0)
    return (
      <EmptyState
        title="No suggestions"
        body="Import who you follow from Sources. Everyone gets scored so the people you actually know rise to the top."
      />
    );

  const add = (id: number) => {
    setItems((list) => list.filter((s) => s.id !== id));
    startTransition(() => track(id, true));
  };

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
        <span>Only people in your inner circle get scraped and ranked.</span>
        <div className="flex gap-1">
          {[10, 25].map((n) => (
            <Button key={n} size="sm" variant="secondary" disabled={pending} onClick={() => startTransition(async () => void (await addTopSuggestions(n)))}>
              Add top {n}
            </Button>
          ))}
        </div>
      </div>
      <ul className="divide-y overflow-hidden rounded-xl border bg-card shadow-sm">
        <AnimatePresence initial={false}>
          {items.map((s) => (
            <motion.li
              key={s.id}
              layout
              exit={{ opacity: 0, height: 0, transition: { duration: 0.15 } }}
              className="flex items-center gap-3 px-4 py-3"
            >
              <Avatar name={s.name} size="sm" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <Link href={`/people/${s.id}`} className="font-medium hover:underline">
                    {s.name}
                  </Link>
                  {s.mutual && (
                    <span className="inline-flex items-center gap-0.5 rounded-full bg-brand-soft px-1.5 text-xs text-brand">
                      <Repeat2 className="size-3" /> mutual
                    </span>
                  )}
                  <span className="text-xs text-muted-foreground">
                    {s.handles
                      .map((h) => `${platformLabel(h.platform)}${h.followers !== null ? ` ${compact(h.followers)}` : ""}`)
                      .join(" · ")}
                  </span>
                </div>
                <p className="truncate text-sm text-muted-foreground">{s.reason ?? s.bio ?? ""}</p>
              </div>
              <Button size="sm" variant="ghost" onClick={() => add(s.id)} aria-label={`Add ${s.name} to inner circle`}>
                <Plus /> Add
              </Button>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
    </>
  );
}
