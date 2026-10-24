"use client";

import type { JobStatus } from "@agent/lib/jobs";
import type { GraphData, graphStats, peopleAt, topEntities } from "@agent/lib/graph/query";
import { Building2, CalendarDays, GraduationCap, Hash, MapPin, Network, Search, Sparkles, X } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { mapMoreNetwork, queryGraph } from "./actions";
import { NetworkGraph } from "./network-graph";
import { Avatar } from "./ui";
import { useJob } from "./use-job";

type Kind = "org" | "school" | "topic" | "place" | "event";
type Entity = Awaited<ReturnType<typeof topEntities>>[number];
type Stats = Awaited<ReturnType<typeof graphStats>>;
type Result = Awaited<ReturnType<typeof peopleAt>>;

const KIND_META: Record<Kind, { label: string; icon: typeof Hash }> = {
  org: { label: "Companies", icon: Building2 },
  school: { label: "Schools", icon: GraduationCap },
  topic: { label: "Topics", icon: Hash },
  place: { label: "Places", icon: MapPin },
  event: { label: "Events & cohorts", icon: CalendarDays },
};
const ORDER: Kind[] = ["org", "event", "school", "topic", "place"];

export function NetworkView({
  stats,
  top,
  job,
  graph,
}: {
  stats: Stats;
  top: Record<Kind, Entity[]>;
  job: JobStatus;
  graph: GraphData;
}) {
  const [mapJob, setMapJob] = useJob("graph", job);
  const [view, setView] = useState<"map" | "list">("map");
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<(Result & { query: string }) | null>(null);
  const [loading, startSearch] = useTransition();

  const search = (q: string, kind?: Kind) => {
    setQuery(q);
    startSearch(async () => setResult({ ...(await queryGraph(q, kind)), query: q }));
  };

  // Clicking an entity in the Map drills into the existing search, in the List view.
  const onEntity = (name: string, kind?: string) => {
    setView("list");
    search(name, kind as Kind | undefined);
  };

  return (
    <div className="space-y-6">
      <div role="tablist" className="inline-flex rounded-lg bg-muted p-0.5 text-sm">
        {(["map", "list"] as const).map((id) => (
          <button
            key={id}
            role="tab"
            aria-selected={view === id}
            onClick={() => setView(id)}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-3 py-1.5 capitalize",
              view === id ? "bg-card font-medium shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {id === "map" ? <Network className="size-4" /> : <Search className="size-4" />}
            {id}
          </button>
        ))}
      </div>

      {view === "map" ? (
        <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
          <div className="aspect-[16/10] w-full">
            {graph.nodes.length ? (
              <NetworkGraph data={graph} onEntity={onEntity} />
            ) : (
              <div className="flex size-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
                Nothing mapped yet — map more of your network to see the graph.
              </div>
            )}
          </div>
        </div>
      ) : (
        <ListView
          top={top}
          query={query}
          setQuery={setQuery}
          search={search}
          result={result}
          setResult={setResult}
          loading={loading}
        />
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed p-4 text-sm">
        <div className="text-muted-foreground">
          {mapJob.state === "running" ? (
            <span className="flex items-center gap-2 text-brand">
              <Spinner className="size-3.5" /> {mapJob.message ?? "Mapping more of your network…"}
            </span>
          ) : (
            <>
              <span className="font-medium text-foreground">{stats.mapped}</span> of {stats.totalPeople} people mapped. Map more to
              deepen the graph.
            </>
          )}
        </div>
        <div className="flex gap-2">
          {[200, 500].map((n) => (
            <Button key={n} size="sm" variant="secondary" disabled={mapJob.state === "running"} onClick={async () => setMapJob(await mapMoreNetwork(n))}>
              <Sparkles /> Map {n} more
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}

function ListView({
  top,
  query,
  setQuery,
  search,
  result,
  setResult,
  loading,
}: {
  top: Record<Kind, Entity[]>;
  query: string;
  setQuery: (q: string) => void;
  search: (q: string, kind?: Kind) => void;
  result: (Result & { query: string }) | null;
  setResult: (r: null) => void;
  loading: boolean;
}) {
  return (
    <div className="space-y-6">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (query.trim()) search(query.trim());
        }}
      >
        <div className="relative flex-1">
          <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Who do I know at… Stripe? working on climate? who went to Minerva?"
            className="bg-card pl-9"
          />
        </div>
        <Button type="submit" disabled={loading || !query.trim()}>
          {loading ? <Spinner /> : "Search"}
        </Button>
      </form>

      {result ? (
        <ResultPanel result={result} onClear={() => setResult(null)} />
      ) : (
        <>
          {ORDER.map((kind) => {
            const items = top[kind];
            if (!items?.length) return null;
            const Icon = KIND_META[kind].icon;
            return (
              <section key={kind}>
                <h2 className="mb-2 flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
                  <Icon className="size-4" /> {KIND_META[kind].label}
                </h2>
                <div className="flex flex-wrap gap-2">
                  {items.map((e) => (
                    <button
                      key={e.id}
                      onClick={() => search(e.name, kind)}
                      className="inline-flex items-center gap-1.5 rounded-full border bg-card px-3 py-1.5 text-sm shadow-sm transition-colors hover:border-brand/50 hover:bg-brand-soft"
                    >
                      {e.name}
                      <span className="rounded-full bg-muted px-1.5 text-xs tabular-nums text-muted-foreground">{e.count}</span>
                    </button>
                  ))}
                </div>
              </section>
            );
          })}
        </>
      )}
    </div>
  );
}

function ResultPanel({ result, onClear }: { result: Result & { query: string }; onClear: () => void }) {
  // One row per person; collapse their multiple links to the matched entities into one line.
  const byPerson = new Map<number, { name: string; tracked: boolean; links: string[] }>();
  for (const p of result.people) {
    const row = byPerson.get(p.personId) ?? { name: p.name, tracked: p.tracked, links: [] };
    row.links.push(`${LINK_VERB[p.predicate] ?? p.predicate} ${p.entity}`);
    byPerson.set(p.personId, row);
  }
  const rows = [...byPerson.entries()];

  return (
    <section>
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {rows.length > 0 ? (
            <>
              <span className="font-medium text-foreground">{rows.length}</span> in your network ·{" "}
              {result.entities.map((e) => e.name).join(", ")}
            </>
          ) : (
            <>Nothing in the mapped graph for “{result.query}”. Try mapping more, or a different term.</>
          )}
        </p>
        <Button size="sm" variant="ghost" onClick={onClear}>
          <X /> Clear
        </Button>
      </div>
      <ul className="divide-y overflow-hidden rounded-xl border bg-card shadow-sm">
        {rows.map(([id, r]) => (
          <li key={id}>
            <Link href={`/people/${id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/50">
              <Avatar name={r.name} size="sm" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{r.name}</span>
                  {r.tracked && <span className="rounded-full bg-brand-soft px-1.5 text-xs text-brand">inner circle</span>}
                </div>
                <p className="truncate text-sm text-muted-foreground">{[...new Set(r.links)].join(" · ")}</p>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

const LINK_VERB: Record<string, string> = {
  works_at: "at",
  studied_at: "studied at",
  based_in: "in",
  interested_in: "works on",
  attended: "did",
};
