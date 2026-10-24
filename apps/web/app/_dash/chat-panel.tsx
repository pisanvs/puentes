"use client";

import { MessageSquarePlus, Sparkles, X } from "lucide-react";
import { useEffect, useState } from "react";
import { AgentChat } from "@/app/_components/agent-chat";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const SESSION_KEY = "bridgr:chat-session";

const SUGGESTIONS = [
  "Who's around that I should meet?",
  "Catch me up on my network",
  "I want to log my day",
  "What do you know about me?",
] as const;

/**
 * The agent, one keystroke away on every page: the same bridgr agent that runs on WhatsApp and MCP,
 * with every tool, in a side panel. The conversation survives navigation and reloads.
 */
export function ChatPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [sessionId, setSessionId] = useState<string | undefined>();
  const [ready, setReady] = useState(false);
  const [generation, setGeneration] = useState(0);

  // Resume the last conversation (best-effort — storage can be unavailable).
  useEffect(() => {
    try {
      setSessionId(localStorage.getItem(SESSION_KEY) ?? undefined);
    } catch {}
    setReady(true);
  }, []);

  const remember = (id: string) => {
    try {
      localStorage.setItem(SESSION_KEY, id);
    } catch {}
  };
  const newChat = () => {
    try {
      localStorage.removeItem(SESSION_KEY);
    } catch {}
    setSessionId(undefined);
    setGeneration((g) => g + 1);
  };

  return (
    <aside
      aria-label="Ask bridgr"
      aria-hidden={!open}
      inert={!open}
      className={cn(
        "fixed inset-y-0 right-0 z-40 flex w-full flex-col border-l bg-background shadow-2xl transition-transform duration-200 sm:w-[440px]",
        open ? "translate-x-0" : "translate-x-full",
      )}
    >
      <header className="flex items-center gap-2 border-b px-4 py-3">
        <span className="inline-flex size-6 items-center justify-center rounded-md bg-brand text-white dark:text-black">
          <Sparkles className="size-3.5" />
        </span>
        <p className="font-semibold">Ask bridgr</p>
        <span className="hidden text-xs text-muted-foreground sm:inline">same agent as your WhatsApp</span>
        <Button size="sm" variant="ghost" className="ml-auto h-7 text-xs" onClick={newChat}>
          <MessageSquarePlus /> New chat
        </Button>
        <Button size="icon-sm" variant="ghost" onClick={onClose} aria-label="Close chat">
          <X />
        </Button>
      </header>
      <div className="min-h-0 flex-1">
        {ready ? <AgentChat key={generation} embedded sessionId={sessionId} onSession={remember} suggestions={SUGGESTIONS} /> : null}
      </div>
    </aside>
  );
}
