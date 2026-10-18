"use client";
/**
 * Purpose: lienzo de React Flow a pantalla completa para un flujo de obligaciones (nómina o
 *   impuestos): cada paso del proceso es un nodo con su estado; al elegir un nodo se muestra su
 *   panel. Misma estética que el editor de contratos: claro, sin sidebar, paneles flotantes.
 * Runs in: browser (cargado sin SSR desde process-loader.tsx).
 * Triggered by: fiscal-flow.tsx y payroll-flow.tsx.
 * Receives → Returns: nodos (id, título, resumen, estado), aristas, selección y panel → UI.
 * Talks to: @xyflow/react, lucide-react, next/link, shadcn Badge, Button.
 */
import "@xyflow/react/dist/style.css";
import { Background, Controls, Handle, Position, ReactFlow, ReactFlowProvider, type Edge, type Node, type NodeProps } from "@xyflow/react";
import { ArrowLeft, Banknote, CalendarClock, ClipboardCheck, Database, FileCheck2, Lightbulb, ListChecks, Scale, ShieldCheck, Users, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type StepStatus = "idle" | "ready" | "done" | "attention" | "blocked";
export type StepIcon = "source" | "rules" | "clock" | "proposal" | "settlements" | "lines" | "evaluate" | "approvals" | "payment";

export type ProcessStep = {
  id: string;
  title: string;
  summary: string;
  status: StepStatus;
  icon: StepIcon;
  x: number;
  y: number;
};

const ICONS: Record<StepIcon, LucideIcon> = {
  source: Database,
  rules: ShieldCheck,
  clock: CalendarClock,
  proposal: Lightbulb,
  settlements: FileCheck2,
  lines: Users,
  evaluate: Scale,
  approvals: ClipboardCheck,
  payment: Banknote,
};

const STATUS: Record<StepStatus, { label: string; dot: string }> = {
  idle: { label: "Pendiente", dot: "bg-muted-foreground/40" },
  ready: { label: "Listo para ejecutar", dot: "bg-sky-500" },
  done: { label: "Completo", dot: "bg-emerald-500" },
  attention: { label: "Requiere atención", dot: "bg-amber-500" },
  blocked: { label: "Bloqueado", dot: "bg-destructive" },
};

type StepData = { step: ProcessStep; selected: boolean; [key: string]: unknown };
type StepNode = Node<StepData, "step">;

function StepCard({ data }: NodeProps<StepNode>) {
  const { step, selected } = data;
  const Icon = ICONS[step.icon] ?? ListChecks;
  return (
    <div className={cn("w-60 rounded-xl bg-card text-card-foreground shadow-md shadow-black/10 ring-1 ring-black/5", selected && "ring-2 ring-ring")}>
      <Handle type="target" position={Position.Left} className="!size-2.5 !border-2 !border-background !bg-muted-foreground" />
      <div className="flex items-center gap-2 px-3 pt-2.5">
        <Icon className="size-4 text-muted-foreground" aria-hidden />
        <span className="text-sm font-medium">{step.title}</span>
      </div>
      <p className="px-3 pt-1 pb-2 text-xs text-muted-foreground">{step.summary}</p>
      <div className="flex items-center gap-1.5 border-t px-3 py-1.5 text-[0.7rem] text-muted-foreground">
        <span className={cn("size-2 rounded-full", STATUS[step.status].dot)} aria-hidden />
        {STATUS[step.status].label}
      </div>
      <Handle type="source" position={Position.Right} className="!size-2.5 !border-2 !border-background !bg-muted-foreground" />
    </div>
  );
}

const nodeTypes = { step: StepCard };
export { nodeTypes as processNodeTypes };

export type ProcessCanvasProps = {
  title: string;
  steps: ProcessStep[];
  edges: { id: string; source: string; target: string }[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  controls?: React.ReactNode; // arriba a la derecha (escenario, reloj…)
  panelTitle: string;
  panel: React.ReactNode;
  backHref: string;
};

export function ProcessCanvas(props: ProcessCanvasProps) {
  return (
    <ReactFlowProvider>
      <Canvas {...props} />
    </ReactFlowProvider>
  );
}

function Canvas({ title, steps, edges, selectedId, onSelect, controls, panelTitle, panel, backHref }: ProcessCanvasProps) {
  const nodes = useMemo<StepNode[]>(
    () => steps.map((step) => ({ id: step.id, type: "step", position: { x: step.x, y: step.y }, data: { step, selected: step.id === selectedId }, draggable: false })),
    [steps, selectedId],
  );
  const statusOf = useMemo(() => new Map(steps.map((s) => [s.id, s.status])), [steps]);
  const rfEdges = useMemo<Edge[]>(() => edges.map((e) => ({ ...e, type: "smoothstep", animated: statusOf.get(e.source) === "done" && statusOf.get(e.target) !== "done" })), [edges, statusOf]);
  const overlay = "pointer-events-auto bg-background shadow-lg shadow-black/10";

  return (
    <div className="relative h-dvh w-full overflow-hidden bg-white">
      <div className="absolute inset-0 sm:right-[27rem]">
        <ReactFlow
          nodes={nodes}
          edges={rfEdges}
          nodeTypes={nodeTypes}
          nodesConnectable={false}
          nodesDraggable={false}
          onNodeClick={(_, node) => onSelect(node.id)}
          onPaneClick={() => onSelect(null)}
          fitView
          fitViewOptions={{ padding: 0.25, maxZoom: 1 }}
          colorMode="light"
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={24} color="#e5e7eb" />
          <Controls showInteractive={false} position="bottom-left" className="!shadow-lg !shadow-black/10" />
        </ReactFlow>
      </div>

      <header className="pointer-events-none absolute inset-x-0 top-0 flex flex-wrap items-center gap-2 p-3 sm:p-4">
        <div className={`${overlay} flex items-center gap-2 rounded-xl py-1.5 pr-3 pl-1.5`}>
          <Link href={backHref} className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}>
            <ArrowLeft aria-hidden /> Volver
          </Link>
          <span className="text-sm font-semibold">{title}</span>
        </div>
        {controls !== undefined && <div className={`${overlay} ml-auto flex flex-wrap items-center gap-2 rounded-xl p-1.5`}>{controls}</div>}
      </header>

      <section
        aria-label={panelTitle}
        className={`${overlay} absolute right-3 bottom-3 left-3 flex max-h-[50vh] flex-col gap-3 overflow-y-auto rounded-xl p-3 sm:top-20 sm:right-4 sm:bottom-4 sm:left-auto sm:max-h-none sm:w-[26rem]`}
      >
        <h2 className="text-sm font-semibold">{panelTitle}</h2>
        {panel}
      </section>
    </div>
  );
}
