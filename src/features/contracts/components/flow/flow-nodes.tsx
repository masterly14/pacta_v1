"use client";
/**
 * Purpose: tarjetas de nodo para el canvas (un tipo visual por tipo de nodo del grafo), con sus
 *   puntos de conexión, resumen, y el estado de validación o de la última simulación.
 * Runs in: browser (componentes de @xyflow/react).
 * Triggered by: <ReactFlow nodeTypes={flowNodeTypes}> en el editor y el visor.
 * Receives → Returns: props de nodo de React Flow → tarjeta con Handles.
 * Talks to: ./flow-model.ts, lucide-react, @xyflow/react (Handle, Position).
 */
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { CalendarClock, CircleStop, Coins, Flag, GitBranch, Landmark, Play, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { FlowNodeType } from "../../flow/schema";
import { NODE_META, nodeSummary, type NodeStatus, type RfNode } from "./flow-model";

const ICON: Record<FlowNodeType, LucideIcon> = {
  start: Play,
  amount: Coins,
  beneficiary: Landmark,
  condition: GitBranch,
  milestone: Flag,
  paymentTerms: CalendarClock,
  end: CircleStop,
};

const STATUS_RING: Record<NodeStatus, string> = {
  idle: "",
  pass: "ring-2 ring-emerald-500/70",
  fail: "ring-2 ring-destructive/80",
  unknown: "ring-2 ring-amber-500/80",
};

const STATUS_TEXT: Record<Exclude<NodeStatus, "idle">, string> = {
  pass: "Cumple",
  fail: "No cumple",
  unknown: "Sin datos",
};

const handleClass = "!size-2.5 !border-2 !border-background !bg-muted-foreground";

function FlowNodeCard({ type, node }: { type: FlowNodeType; node: NodeProps<RfNode> }) {
  const Icon = ICON[type];
  const { payload, status, issue } = node.data;
  return (
    <div
      className={cn(
        "w-56 rounded-xl border bg-card text-card-foreground shadow-sm",
        node.selected && "border-ring ring-2 ring-ring/40",
        STATUS_RING[status],
        issue !== null && status === "idle" && "border-destructive/70",
      )}
    >
      {type !== "start" && <Handle type="target" position={Position.Left} className={handleClass} />}
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <Icon className="size-4 text-muted-foreground" aria-hidden />
        <span className="text-sm font-medium">{NODE_META[type].label}</span>
        {status !== "idle" && (
          <span className="ml-auto text-[0.7rem] text-muted-foreground">{STATUS_TEXT[status]}</span>
        )}
      </div>
      <div className="px-3 py-2 text-xs text-muted-foreground">
        {nodeSummary({ type, data: payload } as Parameters<typeof nodeSummary>[0])}
      </div>
      {issue !== null && <div className="border-t px-3 py-1.5 text-[0.7rem] text-destructive">{issue}</div>}
      {type === "condition" ? (
        <>
          <Handle id="true" type="source" position={Position.Right} style={{ top: "35%" }} className={handleClass} />
          <Handle id="false" type="source" position={Position.Right} style={{ top: "75%" }} className={handleClass} />
          <span className="pointer-events-none absolute -right-6 top-[35%] -translate-y-1/2 text-[0.65rem] text-muted-foreground">Sí</span>
          <span className="pointer-events-none absolute -right-6 top-[75%] -translate-y-1/2 text-[0.65rem] text-muted-foreground">No</span>
        </>
      ) : (
        type !== "end" && <Handle id="default" type="source" position={Position.Right} className={handleClass} />
      )}
    </div>
  );
}

const make = (type: FlowNodeType) =>
  function Node(props: NodeProps<RfNode>) {
    return <FlowNodeCard type={type} node={props} />;
  };

// Definido a nivel de módulo: React Flow exige un objeto estable entre renders.
export const flowNodeTypes = {
  start: make("start"),
  amount: make("amount"),
  beneficiary: make("beneficiary"),
  condition: make("condition"),
  milestone: make("milestone"),
  paymentTerms: make("paymentTerms"),
  end: make("end"),
};

export { ICON as NODE_ICON };
