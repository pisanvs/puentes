"use client";

import type { listTopics, topicFeed, topicSuggestions } from "@agent/lib/topics";
import { Hash, Plus, Users, X } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { unwatchTopicAction, watchTopicAction } from "./actions";
import { Avatar, CategoryPill, EmptyState, categoryMeta, relDay } from "./ui";

type Topic = Awaited<ReturnType<typeof listTopics>>[number];
type Feed = NonNullable<Awaited<ReturnType<typeof topicFeed>>>;
type Suggestion = Awaited<ReturnType<typeof topicSuggestions>>[number];

export function TopicsBoard({ tab, topics, feeds, suggestions }: { tab: "watching" | "suggestions"; topics: Topic[]; feeds: Feed[]; suggestions: Suggestion[] }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [, start] = useTransition();

  const watch = (topic: string) => {
    const t = topic.trim();
    if (!t) return;
    setBusy(t.toLowerCase());
    start(async () => {
      await watchTopicAction(t);
      setBusy(null);
      setName("");
    });
  };

  return (
    <>
      <div role="tablist" className="mb-4 inline-flex rounded-lg bg-muted p-0.5 text-sm">
        {(
          [
            ["watching", `Watching · ${topics.length}`],
            ["suggestions", `Suggestions · ${suggestions.length}`],
          ] as const
        ).map(([id, label]) => (
          <Link
            key={id}
            role="tab"
            aria-selected={tab === id}
            href={id === "watching" ? "/topics" : "/topics?tab=suggestions"}
            className={cn("rounded-md px-3 py-1.5", tab === id ? "bg-card font-medium shadow-sm" : "text-muted-foreground hover:text-foreground")}
          >
            {label}
          </Link>
        ))}
      </div>

      <form
        className="mb-5 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          watch(name);
        }}
      >
        <div className="relative flex-1">
          <Hash className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Watch a topic — ai agents, climate tech, LatAm founders…" className="pl-8" />
        </div>
        <Button type="submit" disabled={!name.trim() || busy !== null} className="bg-brand text-white hover:bg-brand/90 dark:text-black">
          <Plus /> {busy && busy === name.trim().toLowerCase() ? "Tagging…" : "Watch"}
        </Button>
      </form>

      {tab === "suggestions" ? (
        <div className="flex flex-wrap gap-2">
          {suggestions.map((s) => (
            <button
              key={s.name}
              type="button"
              disabled={busy !== null}
              onClick={() => watch(s.name)}
              className="group inline-flex items-center gap-1.5 rounded-full border bg-card px-3 py-1.5 text-sm shadow-sm transition-colors hover:border-brand/50 disabled:opacity-60"
            >
              <Hash className="size-3.5 text-muted-foreground group-hover:text-brand" />
              {s.name}
              <span className="text-xs text-muted-foreground">
                {busy === s.name.toLowerCase() ? "tagging…" : `${s.people} people`}
              </span>
              <Plus className="size-3.5 text-muted-foreground group-hover:text-brand" />
            </button>
          ))}
        </div>
      ) : feeds.length === 0 ? (
        <EmptyState title="No topics yet" body="Watch the ideas you care about and bridgr will tag every post about them. Your network's biggest themes are under Suggestions." />
      ) : (
        <div className="space-y-4">
          {feeds.map((f) => {
            const t = topics.find((x) => x.id === f.topic.id);
            return (
              <section key={f.topic.id} className="rounded-xl border bg-card p-4 shadow-sm">
                <header className="flex items-center gap-2">
                  <Hash className="size-4 text-brand" />
                  <h2 className="font-semibold">{f.topic.name}</h2>
                  <span className="text-xs text-muted-foreground">
                    {t?.stories ?? 0} stories · {t?.people ?? 0} people posting
                  </span>
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    className="ml-auto"
                    aria-label={`Stop watching ${f.topic.name}`}
                    onClick={() => start(() => unwatchTopicAction(f.topic.id))}
                  >
                    <X />
                  </Button>
                </header>

                {f.stories.length > 0 ? (
                  <ol className="mt-3 space-y-2.5">
                    {f.stories.slice(0, 6).map((s) => (
                      <li key={s.eventId} className="flex gap-2.5 text-sm">
                        <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", categoryMeta(s.category).dot)} />
                        <div className="min-w-0">
                          <p className="leading-snug">{s.summary}</p>
                          <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                            <Link href={`/people/${s.personId}`} className="font-medium text-foreground hover:underline">
                              {s.person}
                            </Link>
                            · {relDay(s.occurredAt)}
                            <CategoryPill category={s.category} />
                          </p>
                        </div>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="mt-3 text-sm text-muted-foreground">No posts about this in the last month yet — they'll land here as the scanner finds them.</p>
                )}

                {f.voices.length > 0 && (
                  <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t pt-3 text-xs text-muted-foreground">
                    <Users className="size-3.5" /> Works on this:
                    {f.voices.map((v) => (
                      <Link key={v.personId} href={`/people/${v.personId}`} className="inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-foreground hover:bg-muted">
                        <Avatar name={v.name} size="sm" className="size-4 text-[8px] ring-0" />
                        {v.name}
                      </Link>
                    ))}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}
