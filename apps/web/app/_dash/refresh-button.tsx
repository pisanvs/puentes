"use client";

import { ChevronDown, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { type PipelineStatus, pipelineStatus, startRefresh } from "./actions";

export const REFRESHED_EVENT = "puentes:refreshed";

function ago(ms?: number) {
  if (!ms) return "never";
  const min = Math.round((Date.now() - ms) / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const h = Math.round(min / 60);
  return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

export function RefreshButton({ initial, compact }: { initial: PipelineStatus; compact?: boolean }) {
  const router = useRouter();
  const [status, setStatus] = useState(initial);
  const running = status.state === "running";

  // While a run is going, poll its status file; when it lands, re-render with fresh data.
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(async () => {
      const next = await pipelineStatus();
      if (next.state !== "running") {
        setStatus(next);
        router.refresh();
        window.dispatchEvent(new Event(REFRESHED_EVENT));
      }
    }, 2000);
    return () => clearInterval(timer);
  }, [running, router]);

  const run = async (collect: boolean) => setStatus(await startRefresh(collect));

  if (compact)
    return (
      <Button variant="ghost" size="icon-sm" disabled={running} onClick={() => run(false)} aria-label="Refresh">
        <RefreshCw className={cn(running && "animate-spin")} />
      </Button>
    );

  return (
    <div className="rounded-xl border bg-card p-3 text-sm shadow-sm">
      <div className="flex">
        <Button size="sm" className="flex-1 rounded-r-none" disabled={running} onClick={() => run(false)}>
          <RefreshCw className={cn(running && "animate-spin")} />
          {running ? "Refreshing…" : "Re-rank"}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" className="rounded-l-none border-l border-primary-foreground/20 px-2" disabled={running} aria-label="More refresh options">
              <ChevronDown />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => run(true)}>Scrape socials, then re-rank</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => run(false)}>Re-rank only (fast)</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <p className={cn("mt-2 text-xs", status.state === "failed" ? "text-destructive" : "text-muted-foreground")}>
        {running
          ? (status.message ?? "Working in the background. You can keep going.")
          : status.state === "failed"
            ? `Last run failed: ${status.error ?? "see .puentes/logs/pipeline.log"}`
            : `Updated ${ago(status.finishedAt)}`}
      </p>
    </div>
  );
}
