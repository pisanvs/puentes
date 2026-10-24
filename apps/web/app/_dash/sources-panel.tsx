"use client";

import type { JobStatus } from "@agent/lib/jobs";
import { ChevronUp } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { BrowserView } from "./browser-view";
import { SourceCard } from "./source-card";

type Account = { handle: string | null; connectedAt: number | null; importedAt: number | null; importedCount: number | null } | null;
type Source = { platform: "x" | "linkedin" | "bluesky" | "instagram"; account: Account; connectJob: JobStatus | null; importJob: JobStatus };

export function SourcesPanel({ sources }: { sources: Source[] }) {
  // Show the live browser when a sign-in is already underway, or once the owner starts one.
  const [showBrowser, setShowBrowser] = useState(() => sources.some((s) => s.connectJob?.state === "running"));

  return (
    <div className="space-y-3">
      {sources.map((s) => (
        <SourceCard key={s.platform} {...s} onSignIn={() => setShowBrowser(true)} />
      ))}

      {showBrowser && (
        <div className="space-y-2 pt-1">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">bridgr's browser</p>
            <Button size="sm" variant="ghost" onClick={() => setShowBrowser(false)}>
              <ChevronUp /> Hide
            </Button>
          </div>
          <BrowserView />
        </div>
      )}
    </div>
  );
}
