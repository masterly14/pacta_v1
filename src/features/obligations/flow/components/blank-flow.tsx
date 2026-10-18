"use client";
/**
 * Purpose: flujo proactivo "en blanco": un lienzo de React Flow sin pasos, con una paleta de
 *   pasos de obligación (fuente de datos, reglas, reloj, evaluar, aprobar, pagar) que se añaden,
 *   se mueven y se conectan. Borrador local: aún no se guarda ni se ejecuta.
 * Runs in: browser (cargado sin SSR desde process-loader.tsx).
 * Triggered by: /obligations/blank (opción "Iniciar en blanco" al crear un contrato proactivo).
 * Receives → Returns: backHref → el lienzo editable y su panel.
 * Talks to: @xyflow/react, ./process-canvas (tarjeta de paso), next/link, shadcn Button, Input, Label.
 */
import "@xyflow/react/dist/style.css";
import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
} from "@xyflow/react";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useCallback, useMemo, useRef, useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { processNodeTypes, type ProcessStep, type StepIcon } from "./process-canvas";

const KINDS: { icon: StepIcon; title: string; summary: string }[] = [
  { icon: "source", title: "Fuente de datos", summary: "De dónde salen los datos" },
  { icon: "rules", title: "Reglas", summary: "Qué debe cumplirse" },
  { icon: "clock", title: "Reloj", summary: "Cuándo se evalúa" },
  { icon: "proposal", title: "Propuesta", summary: "Lo que propone Pacta" },
  { icon: "settlements", title: "Confirmación", summary: "Una persona confirma" },
  { icon: "evaluate", title: "Evaluar", summary: "El motor decide" },
  { icon: "approvals", title: "Aprobaciones", summary: "Una persona resuelve" },
  { icon: "payment", title: "Pago", summary: "Se registra el pago" },
];

type BlankData = { step: ProcessStep; selected: boolean; [key: string]: unknown };
type BlankNode = Node<BlankData, "step">;

export function BlankFlow({ backHref }: { backHref: string }) {
  return (
    <ReactFlowProvider>
      <Editor backHref={backHref} />
    </ReactFlowProvider>
  );
}

function Editor({ backHref }: { backHref: string }) {
  const [nodes, setNodes] = useState<BlankNode[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const nextId = useRef(1);

  const onNodesChange = useCallback((changes: NodeChange<BlankNode>[]) => setNodes((ns) => applyNodeChanges(changes, ns)), []);
  const onEdgesChange = useCallback((changes: EdgeChange[]) => setEdges((es) => applyEdgeChanges(changes, es)), []);
  const onConnect = useCallback((c: Connection) => {
    if (c.source === c.target) return;
    // Cada paso tiene una sola salida: conectar de nuevo reemplaza la anterior.
    setEdges((es) => addEdge({ ...c, type: "smoothstep" }, es.filter((e) => e.source !== c.source)));
  }, []);

  function add(kind: (typeof KINDS)[number]) {
    const id = `paso_${nextId.current++}`;
    const index = nodes.length;
    setNodes((ns) => [
      ...ns.map((n) => ({ ...n, selected: false })),
      {
        id,
        type: "step",
        position: { x: 200 + (index % 3) * 300, y: 120 + Math.floor(index / 3) * 190 },
        selected: true,
        data: { step: { id, title: kind.title, summary: kind.summary, status: "idle", icon: kind.icon, x: 0, y: 0 }, selected: true },
      },
    ]);
  }

  const selected = nodes.find((n) => n.selected) ?? null;
  const update = (patch: Partial<Pick<ProcessStep, "title" | "summary">>) =>
    setNodes((ns) => ns.map((n) => (n.id === selected?.id ? { ...n, data: { ...n.data, step: { ...n.data.step, ...patch } } } : n)));

  // La tarjeta marca el paso elegido con `data.selected`.
  const shown = useMemo(() => nodes.map((n) => ({ ...n, data: { ...n.data, selected: n.selected === true } })), [nodes]);
  const overlay = "pointer-events-auto bg-background shadow-lg shadow-black/10";

  return (
    <div className="relative h-dvh w-full overflow-hidden bg-white">
      <div className="absolute inset-0">
        <ReactFlow
          nodes={shown}
          edges={edges}
          nodeTypes={processNodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          deleteKeyCode={["Backspace", "Delete"]}
          snapToGrid
          snapGrid={[20, 20]}
          colorMode="light"
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={24} color="#e5e7eb" />
          <Controls showInteractive={false} position="bottom-left" className="!shadow-lg !shadow-black/10" />
        </ReactFlow>
      </div>

      <header className="pointer-events-none absolute inset-x-0 top-0 flex items-center gap-2 p-3 sm:p-4">
        <div className={`${overlay} flex items-center gap-2 rounded-xl py-1.5 pr-3 pl-1.5`}>
          <Link href={backHref} className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}>
            <ArrowLeft aria-hidden /> Volver
          </Link>
          <span className="text-sm font-semibold">Flujo en blanco</span>
        </div>
      </header>

      <aside aria-label="Pasos disponibles" className={`${overlay} absolute top-16 right-3 left-3 flex flex-row gap-1 overflow-x-auto rounded-xl p-1.5 sm:top-20 sm:right-auto sm:left-4 sm:flex-col sm:overflow-visible`}>
        {KINDS.map((kind) => (
          <Button key={kind.icon} variant="ghost" size="sm" className="justify-start" onClick={() => add(kind)}>
            <span className="whitespace-nowrap">{kind.title}</span>
          </Button>
        ))}
      </aside>

      <section aria-label="Panel del paso" className={`${overlay} absolute right-3 bottom-3 left-3 flex max-h-[40vh] flex-col gap-3 overflow-y-auto rounded-xl p-3 sm:top-20 sm:right-4 sm:bottom-auto sm:left-auto sm:max-h-[calc(100dvh-6.5rem)] sm:w-80`}>
        {selected === null ? (
          <div className="flex flex-col gap-2 text-sm text-muted-foreground">
            <p className="font-medium text-foreground">{nodes.length === 0 ? "Empieza añadiendo un paso" : "Selecciona un paso"}</p>
            <p>Añade pasos desde la lista, arrástralos y conecta la salida de uno con la entrada del siguiente. Con Retroceso o Supr se elimina el paso elegido.</p>
            <p className="text-xs">Es un borrador local: todavía no se guarda ni se ejecuta.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="step-title">Nombre del paso</Label>
              <Input id="step-title" value={selected.data.step.title} maxLength={60} onChange={(e) => update({ title: e.target.value })} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="step-summary">Descripción</Label>
              <Input id="step-summary" value={selected.data.step.summary} maxLength={100} onChange={(e) => update({ summary: e.target.value })} />
            </div>
            <Button variant="outline" size="sm" onClick={() => setNodes((ns) => ns.filter((n) => n.id !== selected.id))}>
              Eliminar paso
            </Button>
          </div>
        )}
      </section>
    </div>
  );
}
