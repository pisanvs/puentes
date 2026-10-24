"use client";

import type { newPeople } from "@agent/lib/new-people";
import { Coffee, MapPin, Monitor, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { answerMetInPerson } from "./actions";
import { Avatar, platformLabel } from "./ui";

type Data = Awaited<ReturnType<typeof newPeople>>;
type Person = Data["people"][number];

/**
 * New faces in your network — triage one at a time: did you meet them in person (a strong warmth
 * signal) or just connect online? "In person" opens a quick "where?" step with autofill so logging
 * the place is a tap. Shows at the top of the Inbox; collapses when cleared.
 */
export function NewPeoplePrompt({ initial, places = [] }: { initial: Data; places?: string[] }) {
  const [queue, setQueue] = useState<Person[]>(initial.people);
  const [remaining, setRemaining] = useState(initial.total);
  const [asking, setAsking] = useState(false); // showing the "where?" step for the current person
  const [, start] = useTransition();
  const current = queue[0];

  if (!current) return null;

  const answer = (a: "met" | "online" | "skip", where?: string) => {
    setQueue((q) => q.slice(1));
    setRemaining((r) => r - 1);
    setAsking(false);
    start(() => answerMetInPerson(current.id, a, where));
  };

  return (
    <section className="mb-5 rounded-xl border border-brand/30 bg-brand-soft/40 p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm font-medium text-brand">New in your network{remaining > 1 ? ` · ${remaining} to triage` : ""}</p>
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

          {asking ? (
            <WhereStep places={places} onSave={(where) => answer("met", where)} onBack={() => setAsking(false)} />
          ) : (
            <>
              <p className="w-full text-sm text-muted-foreground sm:w-auto">Did you meet them in person?</p>
              <div className="flex gap-2">
                <Button size="sm" className="bg-brand text-white hover:bg-brand/90 dark:text-black" onClick={() => setAsking(true)}>
                  <Coffee /> In person
                </Button>
                <Button size="sm" variant="secondary" onClick={() => answer("online")}>
                  <Monitor /> Just online
                </Button>
              </div>
            </>
          )}
        </motion.div>
      </AnimatePresence>

      {!asking && (
        <p className="mt-2 text-xs text-muted-foreground">
          <Coffee className="mr-1 inline size-3" /> Meeting in person warms them up and adds them to your inner circle.
        </p>
      )}
    </section>
  );
}

/** The quick "where did you meet?" capture: autofocused input + native autofill + one-tap chips. */
function WhereStep({ places, onSave, onBack }: { places: string[]; onSave: (where?: string) => void; onBack: () => void }) {
  const [where, setWhere] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => inputRef.current?.focus(), []);

  return (
    <div className="w-full space-y-2">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <MapPin className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={inputRef}
            value={where}
            onChange={(e) => setWhere(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onSave(where || undefined);
              else if (e.key === "Escape") onBack();
            }}
            list="met-places"
            placeholder="Where did you meet? (e.g. SF, YC dinner)"
            aria-label="Where did you meet them?"
            className="pl-8"
          />
          <datalist id="met-places">
            {places.map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>
        </div>
        <Button size="sm" className="bg-brand text-white hover:bg-brand/90 dark:text-black" onClick={() => onSave(where || undefined)}>
          Save
        </Button>
      </div>
      {places.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {places.slice(0, 5).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => onSave(p)}
              className="rounded-full border bg-card px-2.5 py-0.5 text-xs text-muted-foreground transition-colors hover:border-brand/50 hover:text-foreground"
            >
              {p}
            </button>
          ))}
          <button type="button" onClick={() => onSave(undefined)} className="rounded-full px-2.5 py-0.5 text-xs text-muted-foreground hover:text-foreground">
            skip location
          </button>
        </div>
      )}
    </div>
  );
}
