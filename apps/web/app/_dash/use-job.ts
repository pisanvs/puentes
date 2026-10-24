"use client";

import type { JobStatus } from "@agent/lib/jobs";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { jobStatus } from "./actions";

/** Track a background job: poll while it runs, re-render the page with fresh data when it lands. */
export function useJob(name: string, initial: JobStatus) {
  const router = useRouter();
  const [status, setStatus] = useState(initial);
  const running = status.state === "running";

  // Sync on content, not identity: callers may pass a fresh `{ state: "idle" }` every render.
  const initialKey = JSON.stringify(initial);
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on content above
  useEffect(() => setStatus(initial), [initialKey]);

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(async () => {
      const next = await jobStatus(name);
      setStatus(next);
      if (next.state !== "running") router.refresh();
    }, 1500);
    return () => clearInterval(timer);
  }, [running, name, router]);

  return [status, setStatus] as const;
}
