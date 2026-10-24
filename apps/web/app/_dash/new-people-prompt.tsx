"use client";

import type { newPeople } from "@agent/lib/new-people";
import { Coffee, Monitor, UserPlus, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { answerMetInPerson } from "./actions";
import { Avatar, platformLabel } from "./ui";

type Data = Awaited<ReturnType<typeof newPeople>>;
type Person = Data["people"][number];

/**
 * New faces in your network — triage one at a time: did you meet them in person (a strong warmth
 * signal) or just connect online? Shows at the top of the Inbox; collapses when cleared.
 */
export function NewPeoplePrompt({ initial }: { initial: Data }) {
  const [queue, setQueue] = useState<Person[]>(initial.people);
  const [remaining, setRemaining] = useState(initial.total);
  const [, start] = useTransition();
  const current = queue[0];

  if (!current) return null;

  const answer = (a: "met" | "online" | "skip") => {
    setQueue((q) => q.slice(1));
    setRemaining((r) => r - 1);
    start(() => answerMetInPerson(current.id, a));
  };

  return (
    <section className="mb-5 rounded-xl border border-brand/30 bg-brand-soft/40 p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm font-medium text-brand">
          New in your network{remaining > 1 ? ` · ${remaining} to triage` : ""}
        </p>
        <Button size="icon-xs" variant="ghost" onClick={() => answer("skip")} aria-label="Skip">
          <X />
        </Button>
      </div>

      <AnimatePresence mode="popLayout">
        <motion.div
          key={current.id}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, x: -30, transition: { duration: 0.15 } }}
          className="flex flex-wrap items-center gap-3"
        >
          <Avatar name={current.name} />
          <div className="min-w-0 flex-1">
            <Link href={`/people/${current.id}`} className="font-semibold hover:underline">
              {current.name}
            </Link>
            <p className="truncate text-sm text-muted-foreground">
              {current.bio || current.reason || current.platforms.map(platformLabel).join(" · ")}
            </p>
          </div>
          <p className="w-full text-sm text-muted-foreground sm:w-auto">Did you meet them in person?</p>
          <div className="flex gap-2">
            <Button size="sm" className="bg-brand text-white hover:bg-brand/90 dark:text-black" onClick={() => answer("met")}>
              <Coffee /> In person
            </Button>
            <Button size="sm" variant="secondary" onClick={() => answer("online")}>
              <Monitor /> Just online
            </Button>
          </div>
        </motion.div>
      </AnimatePresence>
      <p className="mt-2 text-xs text-muted-foreground">
        <Coffee className="mr-1 inline size-3" /> Meeting in person warms them up and adds them to your inner circle.
      </p>
    </section>
  );
}
