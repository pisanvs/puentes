"use client";

import type { JobStatus } from "@agent/lib/jobs";
import { Check, Download, LogIn } from "lucide-react";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { connectPlatform, importFollowing, setBlueskyHandle } from "./actions";
import { useJob } from "./use-job";

type Platform = "x" | "linkedin" | "bluesky" | "instagram";
type Account = { handle: string | null; connectedAt: number | null; importedAt: number | null; importedCount: number | null } | null;

const META: Record<Platform, { name: string; mark: string; what: string; profile: (h: string) => string }> = {
  x: { name: "X", mark: "𝕏", what: "accounts you follow", profile: (h) => `https://x.com/${h}` },
  linkedin: { name: "LinkedIn", mark: "in", what: "connections", profile: (h) => `https://www.linkedin.com/in/${h}/` },
  bluesky: { name: "Bluesky", mark: "🦋", what: "accounts you follow", profile: (h) => `https://bsky.app/profile/${h}` },
  instagram: { name: "Instagram", mark: "📷", what: "accounts you follow", profile: (h) => `https://instagram.com/${h}` },
};

const ago = (ms: number | null) => {
  if (!ms) return null;
  const min = Math.round((Date.now() - ms) / 60_000);
  return min < 1 ? "just now" : min < 60 ? `${min}m ago` : min < 1440 ? `${Math.round(min / 60)}h ago` : `${Math.round(min / 1440)}d ago`;
};

function JobLine({ status, idle }: { status: JobStatus; idle?: string }) {
  if (status.state === "running")
    return (
      <p className="flex items-center gap-2 text-sm text-brand">
        <Spinner className="size-3.5" /> {status.message ?? "Working…"}
      </p>
    );
  if (status.state === "failed") return <p className="text-sm text-destructive">{status.error}</p>;
  return idle ? <p className="text-sm text-muted-foreground">{idle}</p> : null;
}

export function SourceCard({
  platform,
  account,
  connectJob,
  importJob,
  onSignIn,
}: {
  platform: Platform;
  account: Account;
  connectJob: JobStatus | null;
  importJob: JobStatus;
  onSignIn?: () => void;
}) {
  const meta = META[platform];
  const [connect, setConnect] = useJob(`connect-${platform}`, connectJob ?? { state: "idle" });
  const [imp, setImp] = useJob(`import-${platform}`, importJob);
  const [handle, setHandle] = useState(account?.handle ?? "");
  const [pending, startTransition] = useTransition();

  const connected = platform === "bluesky" ? !!account?.handle : !!account?.connectedAt;
  const busy = connect.state === "running" || imp.state === "running";
  const result = imp.state === "done" ? (imp.result as { imported?: number; created?: number; linked?: number } | undefined) : undefined;

  return (
    <section className="rounded-xl border bg-card p-4 shadow-sm md:p-5">
      <div className="flex flex-wrap items-center gap-3">
        <span className="inline-flex size-10 items-center justify-center rounded-lg bg-muted text-base font-semibold">{meta.mark}</span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{meta.name}</p>
          <p className="text-sm text-muted-foreground">
            {connected && account?.handle ? (
              <>
                <Check className="mr-1 inline size-3.5 text-brand" />
                <a href={meta.profile(account.handle)} target="_blank" rel="noreferrer" className="hover:underline">
                  {platform === "linkedin" ? account.handle : `@${account.handle}`}
                </a>
              </>
            ) : connected ? (
              "Signed in"
            ) : (
              "Not connected"
            )}
            {account?.importedAt && ` · ${account.importedCount ?? 0} ${meta.what} imported ${ago(account.importedAt)}`}
          </p>
        </div>

        <div className="flex gap-2">
          {platform !== "bluesky" && (
            <Button
              size="sm"
              variant={connected ? "ghost" : "default"}
              disabled={busy}
              onClick={async () => {
                onSignIn?.();
                setConnect(await connectPlatform(platform));
              }}
            >
              <LogIn /> {connected ? "Re-sign in" : "Sign in"}
            </Button>
          )}
          {connected && (
            <Button
              size="sm"
              className={cn(!account?.importedAt && "bg-brand text-white hover:bg-brand/90 dark:text-black")}
              variant={account?.importedAt ? "secondary" : "default"}
              disabled={busy}
              onClick={async () => setImp(await importFollowing(platform))}
            >
              <Download /> {account?.importedAt ? "Re-import" : `Import ${meta.what}`}
            </Button>
          )}
        </div>
      </div>

      {platform === "bluesky" && (
        <form
          className="mt-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (handle.trim()) startTransition(() => setBlueskyHandle(handle));
          }}
        >
          <Input value={handle} onChange={(e) => setHandle(e.target.value)} placeholder="yourname.bsky.social" className="bg-card" />
          <Button type="submit" size="sm" variant="secondary" className="h-9" disabled={pending || !handle.trim() || handle === account?.handle}>
            Save
          </Button>
        </form>
      )}

      <div className="mt-3 space-y-1 empty:hidden">
        {connect.state === "running" && <JobLine status={connect} />}
        {connect.state === "failed" && <JobLine status={connect} />}
        {imp.state !== "idle" && (
          <JobLine
            status={imp}
            idle={result ? `Imported ${result.imported}: ${result.created} new, ${result.linked} matched to people you already had.` : undefined}
          />
        )}
      </div>
    </section>
  );
}
