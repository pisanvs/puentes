"use client";

import type { GraphData, GraphLink, GraphNode } from "@agent/lib/graph/query";
import { warmthColor, warmthNorm } from "@agent/lib/warmth-curve";
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

// d3-force mutates nodes/links in place, adding x/y/vx/vy (nodes) and resolving source/target
// from ids to node objects (links). These sim types layer that on top of our serializable shapes.
type SimNode = GraphNode & SimulationNodeDatum;
type SimLink = SimulationLinkDatum<SimNode>;

// Five distinct hues for the entity kinds (OKLCH so they read in both themes).
const KIND_COLOR: Record<string, string> = {
  org: "oklch(0.62 0.17 264)", // indigo
  school: "oklch(0.64 0.15 150)", // green
  topic: "oklch(0.66 0.16 300)", // violet
  place: "oklch(0.70 0.14 70)", // amber
  event: "oklch(0.63 0.18 18)", // rose
};
const KIND_LABEL: Record<string, string> = {
  org: "Company",
  school: "School",
  topic: "Topic",
  place: "Place",
  event: "Event",
};

const personRadius = (n: GraphNode) => 4 + warmthNorm(n.warmth ?? 0) * 6; // 4–10
const entityRadius = (n: GraphNode) => 8 + Math.min(12, Math.sqrt(n.degree ?? 1) * 2);
const nodeRadius = (n: GraphNode) => (n.type === "person" ? personRadius(n) : entityRadius(n));

type Transform = { x: number; y: number; k: number };
type Tip = { node: SimNode; x: number; y: number } | null;

export function NetworkGraph({ data, onEntity }: { data: GraphData; onEntity?: (name: string, kind?: string) => void }) {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const nodesRef = useRef<SimNode[]>([]);
  const linksRef = useRef<SimLink[]>([]);
  const simRef = useRef<Simulation<SimNode, SimLink> | null>(null);
  const sizeRef = useRef({ w: 1, h: 1, dpr: 1 });
  const transformRef = useRef<Transform>({ x: 0, y: 0, k: 1 });

  // Interaction state kept in refs so handlers don't need to re-bind.
  const dragRef = useRef<{ node: SimNode; moved: boolean } | null>(null);
  const panRef = useRef<{ sx: number; sy: number; tx: number; ty: number } | null>(null);

  const [tip, setTip] = useState<Tip>(null);

  const draw = useRef(() => {});

  // Build the simulation whenever the data changes.
  useEffect(() => {
    const nodes: SimNode[] = data.nodes.map((n) => ({ ...n }));
    const links: SimLink[] = data.links.map((l: GraphLink) => ({ source: l.source, target: l.target }));
    nodesRef.current = nodes;
    linksRef.current = links;

    const { w, h } = sizeRef.current;
    const sim = forceSimulation<SimNode>(nodes)
      .force(
        "link",
        forceLink<SimNode, SimLink>(links)
          .id((d) => d.id)
          .distance(42)
          .strength(0.35),
      )
      .force("charge", forceManyBody<SimNode>().strength(-110))
      .force("center", forceCenter(w / 2, h / 2))
      .force(
        "collide",
        forceCollide<SimNode>().radius((d) => nodeRadius(d) + 4),
      )
      .alphaMin(0.02) // cool to a stop rather than running forever → saves CPU
      .on("tick", () => draw.current());
    simRef.current = sim;

    return () => {
      sim.stop();
      simRef.current = null;
    };
  }, [data]);

  // Canvas sizing (devicePixelRatio-aware) + the draw routine.
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    draw.current = () => {
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const { w, h, dpr } = sizeRef.current;
      const t = transformRef.current;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.translate(t.x, t.y);
      ctx.scale(t.k, t.k);

      // Foreground color follows the theme (canvas inherits the app's text color).
      const fg = getComputedStyle(canvas).color || "rgb(100,100,100)";

      // Edges: thin, low-opacity so clusters read.
      ctx.strokeStyle = fg;
      ctx.globalAlpha = 0.1;
      ctx.lineWidth = 1 / t.k;
      ctx.beginPath();
      for (const l of linksRef.current) {
        const s = l.source as SimNode;
        const tg = l.target as SimNode;
        if (s.x == null || tg.x == null) continue;
        ctx.moveTo(s.x, s.y ?? 0);
        ctx.lineTo(tg.x ?? 0, tg.y ?? 0);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;

      const hovered = dragRef.current?.node ?? tipNodeRef.current;
      const showPersonLabels = t.k > 1.8;

      for (const n of nodesRef.current) {
        if (n.x == null || n.y == null) continue;
        const r = nodeRadius(n);
        if (n.type === "person") {
          ctx.fillStyle = warmthColor(warmthNorm(n.warmth ?? 0));
          ctx.beginPath();
          ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
          ctx.fill();
          if (n.tracked) {
            // Inner-circle ring.
            ctx.strokeStyle = fg;
            ctx.globalAlpha = 0.85;
            ctx.lineWidth = 1.5 / t.k;
            ctx.beginPath();
            ctx.arc(n.x, n.y, r + 2.5 / t.k, 0, Math.PI * 2);
            ctx.stroke();
            ctx.globalAlpha = 1;
          }
        } else {
          // Entity: a diamond, colored by kind.
          ctx.fillStyle = KIND_COLOR[n.kind ?? ""] ?? fg;
          ctx.beginPath();
          ctx.moveTo(n.x, n.y - r);
          ctx.lineTo(n.x + r, n.y);
          ctx.lineTo(n.x, n.y + r);
          ctx.lineTo(n.x - r, n.y);
          ctx.closePath();
          ctx.fill();
        }
        if (n === hovered) {
          ctx.strokeStyle = fg;
          ctx.lineWidth = 2 / t.k;
          ctx.beginPath();
          ctx.arc(n.x, n.y, r + 3 / t.k, 0, Math.PI * 2);
          ctx.stroke();
        }
      }

      // Labels: entities always; people on zoom-in or hover.
      ctx.fillStyle = fg;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      for (const n of nodesRef.current) {
        if (n.x == null || n.y == null) continue;
        const isEntity = n.type === "entity";
        if (!isEntity && !showPersonLabels && n !== hovered) continue;
        ctx.globalAlpha = isEntity ? 0.92 : 0.72;
        ctx.font = `${isEntity ? 600 : 400} ${isEntity ? 11 : 10}px ui-sans-serif, system-ui, sans-serif`;
        ctx.fillText(n.label, n.x, n.y + nodeRadius(n) + 2);
      }
      ctx.globalAlpha = 1;
    };

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = container.clientWidth;
      const h = container.clientHeight;
      sizeRef.current = { w, h, dpr };
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      const sim = simRef.current;
      if (sim) {
        sim.force("center", forceCenter(w / 2, h / 2));
        sim.alpha(Math.max(sim.alpha(), 0.2)).restart();
      }
      draw.current();
    };

    const ro = new ResizeObserver(resize);
    ro.observe(container);
    resize();
    return () => ro.disconnect();
  }, []);

  // Keep the latest hovered node available to the draw loop without re-binding it.
  const tipNodeRef = useRef<SimNode | null>(null);
  tipNodeRef.current = tip?.node ?? null;

  const toWorld = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const t = transformRef.current;
    return { x: (clientX - rect.left - t.x) / t.k, y: (clientY - rect.top - t.y) / t.k };
  };

  const hitTest = (clientX: number, clientY: number): SimNode | null => {
    const { x, y } = toWorld(clientX, clientY);
    let best: SimNode | null = null;
    let bestD = Infinity;
    for (const n of nodesRef.current) {
      if (n.x == null || n.y == null) continue;
      const dx = n.x - x;
      const dy = n.y - y;
      const d = Math.hypot(dx, dy);
      const hit = nodeRadius(n) + 4;
      // Prefer entities (drawn on top) and the nearest within range.
      if (d <= hit && (d < bestD || (n.type === "entity" && best?.type === "person"))) {
        best = n;
        bestD = d;
      }
    }
    return best;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const node = hitTest(e.clientX, e.clientY);
    if (node) {
      dragRef.current = { node, moved: false };
      const { x, y } = toWorld(e.clientX, e.clientY);
      node.fx = x;
      node.fy = y;
      simRef.current?.alphaTarget(0.3).restart();
    } else {
      const t = transformRef.current;
      panRef.current = { sx: e.clientX, sy: e.clientY, tx: t.x, ty: t.y };
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (drag) {
      const { x, y } = toWorld(e.clientX, e.clientY);
      drag.node.fx = x;
      drag.node.fy = y;
      drag.moved = true;
      draw.current();
      return;
    }
    const pan = panRef.current;
    if (pan) {
      transformRef.current = { ...transformRef.current, x: pan.tx + (e.clientX - pan.sx), y: pan.ty + (e.clientY - pan.sy) };
      draw.current();
      return;
    }
    // Hover → tooltip.
    const node = hitTest(e.clientX, e.clientY);
    const rect = containerRef.current!.getBoundingClientRect();
    if (node) setTip({ node, x: e.clientX - rect.left, y: e.clientY - rect.top });
    else if (tipNodeRef.current) setTip(null);
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (drag) {
      drag.node.fx = null;
      drag.node.fy = null;
      simRef.current?.alphaTarget(0);
      if (!drag.moved) activate(drag.node);
      dragRef.current = null;
      draw.current();
      return;
    }
    panRef.current = null;
  };

  const activate = (n: SimNode) => {
    if (n.type === "person") router.push(`/people/${n.id.slice(1)}`);
    else onEntity?.(n.label, n.kind);
  };

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const t = transformRef.current;
    const rect = canvasRef.current!.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const factor = Math.exp(-e.deltaY * 0.0015);
    const k = Math.min(6, Math.max(0.3, t.k * factor));
    // Keep the point under the cursor fixed while zooming.
    transformRef.current = { k, x: px - ((px - t.x) / t.k) * k, y: py - ((py - t.y) / t.k) * k };
    draw.current();
  };

  return (
    <div ref={containerRef} className="relative size-full touch-none overflow-hidden">
      <canvas
        ref={canvasRef}
        className="size-full cursor-grab active:cursor-grabbing"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => setTip(null)}
        onWheel={onWheel}
      />
      {tip && (
        <div
          className="pointer-events-none absolute z-10 max-w-56 -translate-x-1/2 -translate-y-full rounded-md border bg-popover px-2.5 py-1.5 text-xs shadow-md"
          style={{ left: tip.x, top: tip.y - 10 }}
        >
          <div className="font-medium">{tip.node.label}</div>
          <div className="text-muted-foreground">
            {tip.node.type === "person"
              ? `${tip.node.tracked ? "inner circle · " : ""}warmth ${Math.round(warmthNorm(tip.node.warmth ?? 0) * 100)}%`
              : `${KIND_LABEL[tip.node.kind ?? ""] ?? tip.node.kind} · ${tip.node.degree ?? 0} people`}
          </div>
        </div>
      )}
      <div className="pointer-events-none absolute bottom-2 left-2 rounded-md bg-card/70 px-2 py-1 text-[11px] text-muted-foreground backdrop-blur-sm">
        Drag to move · scroll to zoom · click a node to open
      </div>
    </div>
  );
}
