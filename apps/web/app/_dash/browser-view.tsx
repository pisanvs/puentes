"use client";

import { ArrowLeft, RotateCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { startBrowser } from "./actions";

type Tab = { index: number; url: string; title: string; active: boolean };

// KeyboardEvent.key values Playwright accepts verbatim; everything else is sent as inserted text.
const NAMED_KEYS = new Set([
  "Enter", "Backspace", "Tab", "Escape", "Delete", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
  "Home", "End", "PageUp", "PageDown",
]);

/**
 * Live view of bridgr's own browser (the daemon). Frames stream in over its WebSocket and your
 * mouse, wheel and keys are relayed back, so you can sign in to your accounts without leaving the app.
 * It drives bridgr's browser instance, not your everyday Chrome.
 */
export function BrowserView() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const [status, setStatus] = useState<"starting" | "live" | "error">("starting");
  const [error, setError] = useState<string | null>(null);
  const [tabs, setTabs] = useState<Tab[]>([]);
  const activeTab = tabs.find((t) => t.active);

  const send = useCallback((msg: object) => {
    const ws = socketRef.current;
    if (ws?.readyState === ws?.OPEN) ws?.send(JSON.stringify(msg));
  }, []);

  useEffect(() => {
    let cancelled = false;
    let ws: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout>;

    // Reconnect on drop (e.g. the browser daemon restarting) so the view is self-healing.
    const connect = async () => {
      if (cancelled) return;
      let viewUrl: string;
      try {
        ({ viewUrl } = await startBrowser());
      } catch (e) {
        if (cancelled) return;
        setStatus("error");
        setError((e as Error).message);
        retry = setTimeout(connect, 2000);
        return;
      }
      if (cancelled) return;

      ws = new WebSocket(viewUrl);
      socketRef.current = ws;
      ws.onopen = () => !cancelled && (setStatus("live"), setError(null));
      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data as string);
        if (msg.type === "tabs") return setTabs(msg.tabs);
        if (msg.type === "frame") drawFrame(canvasRef.current, msg.data, msg.width, msg.height);
      };
      ws.onclose = () => {
        if (cancelled) return;
        setStatus("starting");
        retry = setTimeout(connect, 1500);
      };
      ws.onerror = () => ws?.close();
    };
    connect();

    return () => {
      cancelled = true;
      clearTimeout(retry);
      ws?.close();
      socketRef.current = null;
    };
  }, []);

  // Pointer position as a 0..1 fraction of the rendered canvas, which the daemon maps to the viewport.
  const pointAt = (e: React.PointerEvent | React.WheelEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return { x: (e.clientX - rect.left) / rect.width, y: (e.clientY - rect.top) / rect.height };
  };

  return (
    <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
      <div className="flex items-center gap-1 border-b bg-muted/40 px-2 py-1.5">
        <Button size="icon-xs" variant="ghost" onClick={() => send({ type: "back" })} aria-label="Back">
          <ArrowLeft />
        </Button>
        <Button size="icon-xs" variant="ghost" onClick={() => send({ type: "reload" })} aria-label="Reload">
          <RotateCw />
        </Button>
        <span className="mx-1 flex-1 truncate rounded bg-card px-2 py-1 text-xs text-muted-foreground">
          {activeTab?.url || "about:blank"}
        </span>
        {status === "live" && <span className="mr-1 inline-flex items-center gap-1 text-xs text-brand"><span className="size-1.5 rounded-full bg-brand" /> live</span>}
      </div>

      {tabs.length > 1 && (
        <div className="flex gap-1 overflow-x-auto border-b bg-muted/20 px-2 py-1">
          {tabs.map((t) => (
            <button
              key={t.index}
              onClick={() => send({ type: "tab", index: t.index })}
              className={`max-w-40 shrink-0 truncate rounded px-2 py-1 text-xs ${t.active ? "bg-card font-medium shadow-sm" : "text-muted-foreground hover:bg-card/60"}`}
            >
              {t.title || t.url || "Tab"}
            </button>
          ))}
        </div>
      )}

      <div className="relative aspect-[1280/860] w-full bg-black">
        <canvas
          ref={canvasRef}
          tabIndex={0}
          className="absolute inset-0 size-full cursor-default outline-none"
          onPointerMove={(e) => send({ type: "mouse", action: "move", ...pointAt(e) })}
          onPointerDown={(e) => {
            (e.currentTarget as HTMLCanvasElement).focus();
            send({ type: "mouse", action: "down", ...pointAt(e), button: e.button === 2 ? "right" : e.button === 1 ? "middle" : "left" });
          }}
          onPointerUp={(e) => send({ type: "mouse", action: "up", ...pointAt(e), button: e.button === 2 ? "right" : e.button === 1 ? "middle" : "left" })}
          onContextMenu={(e) => e.preventDefault()}
          onWheel={(e) => send({ type: "wheel", ...pointAt(e), dx: e.deltaX, dy: e.deltaY })}
          onKeyDown={(e) => {
            // Let the page handle input; mirror it to the real browser.
            if (e.key === "Enter" || e.key === "Tab" || e.key === "Backspace") e.preventDefault();
            const mods = [e.metaKey && "Meta", e.ctrlKey && "Control", e.altKey && "Alt", e.shiftKey && "Shift"].filter(Boolean) as string[];
            if (NAMED_KEYS.has(e.key) || mods.length) send({ type: "key", key: e.key.length === 1 ? e.key : e.key, modifiers: mods });
            else if (e.key.length === 1) send({ type: "text", text: e.key });
          }}
          onPaste={(e) => {
            e.preventDefault();
            send({ type: "text", text: e.clipboardData.getData("text") });
          }}
        />
        {status !== "live" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/80 text-center text-sm text-white">
            {status === "starting" ? (
              <>
                <Spinner /> Starting the browser…
              </>
            ) : (
              <p className="max-w-sm text-red-300">{error ?? "The browser view isn't available."}</p>
            )}
          </div>
        )}
      </div>
      <p className="border-t px-3 py-2 text-xs text-muted-foreground">
        This is bridgr's own browser. Sign in here and it stays signed in. Click the canvas, then type.
      </p>
    </div>
  );
}

let pending: string | null = null;
let drawing = false;
function drawFrame(canvas: HTMLCanvasElement | null, dataB64: string, width: number, height: number) {
  if (!canvas) return;
  pending = dataB64;
  if (drawing) return;
  drawing = true;
  const img = new Image();
  img.onload = () => {
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    canvas.getContext("2d")?.drawImage(img, 0, 0, width, height);
    drawing = false;
    // A newer frame arrived while decoding: draw it so we don't fall behind.
    if (pending && pending !== dataB64) drawFrame(canvas, pending, width, height);
    else pending = null;
  };
  img.onerror = () => (drawing = false);
  img.src = `data:image/jpeg;base64,${dataB64}`;
}
