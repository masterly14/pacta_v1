"use client";
/**
 * Purpose: editor visual del flujo de pago de un contrato (canvas de @xyflow/react con paleta,
 *   propiedades, validación en vivo y simulador). Guarda borradores y activa versiones; un
 *   flujo es evidencia, nunca autoriza un pago.
 * Runs in: browser (cargado con next/dynamic, sin SSR, desde flow-editor-loader.tsx).
 * Triggered by: /contracts/[id]/flow.
 * Receives → Returns: props del contrato y su grafo inicial → UI; muta vía saveFlowDraftAction y
 *   activateFlowAction (el servidor vuelve a validar y exige rol de administrador).
 * Talks to: @xyflow/react, next/link, ../../flow/{validate,template,actions,evaluate}, ./flow-model,
 *   ./flow-nodes, ./node-inspector, ./simulator-panel, sonner, next/navigation.
 */
import "@xyflow/react/dist/style.css";
import {
  Background,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type NodeChange,
  applyEdgeChanges,
  applyNodeChanges,
} from "@xyflow/react";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { activateFlowAction, saveFlowDraftAction } from "../../flow/actions";
import type { FlowEvaluation } from "../../flow/evaluate";
import type { ContractFlowGraph, FlowNode, FlowNodeType } from "../../flow/schema";
import { summarizeGraph } from "../../flow/template";
import { validateFlow } from "../../flow/validate";
import { formatMinor } from "../../money";
import { defaultData, newId, NODE_META, NODE_ORDER, toGraphJson, toRf, toRfEdge, type NodeStatus, type RfNode } from "./flow-model";
import { flowNodeTypes, NODE_ICON } from "./flow-nodes";
import { NodeInspector } from "./node-inspector";
import { SimulatorPanel } from "./simulator-panel";

type Tab = "props" | "validation" | "test";

export type FlowEditorProps = {
  contractId: string;
  supplierName: string;
  initialGraph: ContractFlowGraph;
  baseSha256: string | null; // hash del borrador cargado; null si se parte de la versión activa
  activeVersion: number | null;
  today: string;
};

export function FlowEditor(props: FlowEditorProps) {
  return (
    <ReactFlowProvider>
      <Editor {...props} />
    </ReactFlowProvider>
  );
}

function Editor({ contractId, supplierName, initialGraph, baseSha256, activeVersion, today }: FlowEditorProps) {
  const router = useRouter();
  const { screenToFlowPosition } = useReactFlow();
  const canvasRef = useRef<HTMLDivElement>(null);
  const initial = useMemo(() => toRf(initialGraph), [initialGraph]);
  const [nodes, setNodes] = useState<RfNode[]>(initial.nodes);
  const [edges, setEdges] = useState<Edge[]>(initial.edges);
  const [tab, setTab] = useState<Tab>("props");
  const [savedSha, setSavedSha] = useState<string | null>(baseSha256);
  const [savedJson, setSavedJson] = useState<string | null>(JSON.stringify(toGraphJson(initial.nodes, initial.edges)));
  const [trace, setTrace] = useState<{ json: string; evaluation: FlowEvaluation } | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const graphJson = useMemo(() => toGraphJson(nodes, edges), [nodes, edges]);
  const serialized = useMemo(() => JSON.stringify(graphJson), [graphJson]);
  const validation = useMemo(() => validateFlow(graphJson), [graphJson]);
  const dirty = serialized !== savedJson;
  const issues = useMemo(() => (validation.ok ? [] : validation.errors), [validation]);
  const issueByNode = useMemo(() => {
    const map = new Map<string, string>();
    for (const i of issues) if (i.nodeId !== null && !map.has(i.nodeId)) map.set(i.nodeId, i.message);
    return map;
  }, [issues]);

  // La traza solo se muestra mientras el grafo no haya cambiado desde que se simuló.
  const traceStatus = useMemo(() => {
    const map = new Map<string, NodeStatus>();
    if (trace === null || trace.json !== serialized) return map;
    const rank: Record<NodeStatus, number> = { idle: 0, pass: 1, unknown: 2, fail: 3 };
    for (const step of trace.evaluation.trace) {
      const prev = map.get(step.nodeId) ?? "idle";
      if (rank[step.result] >= rank[prev]) map.set(step.nodeId, step.result);
    }
    return map;
  }, [trace, serialized]);

  const displayNodes = useMemo(
    () => nodes.map((n) => ({ ...n, data: { ...n.data, status: traceStatus.get(n.id) ?? "idle", issue: issueByNode.get(n.id) ?? null } })),
    [nodes, traceStatus, issueByNode],
  );

  const onNodesChange = useCallback((changes: NodeChange<RfNode>[]) => setNodes((ns) => applyNodeChanges(changes, ns)), []);
  const onEdgesChange = useCallback((changes: EdgeChange[]) => setEdges((es) => applyEdgeChanges(changes, es)), []);

  const onConnect = useCallback((c: Connection) => {
    if (c.source === c.target) return;
    const handle = (c.sourceHandle ?? "default") as "default" | "true" | "false";
    setEdges((es) => [
      // Cada salida admite una sola arista: conectar de nuevo reemplaza la anterior.
      ...es.filter((e) => !(e.source === c.source && (e.sourceHandle ?? "default") === handle)),
      toRfEdge({ id: newId("e"), source: c.source, target: c.target, sourceHandle: handle }),
    ]);
  }, []);

  function addNode(type: FlowNodeType) {
    const rect = canvasRef.current?.getBoundingClientRect();
    const center = rect ? screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }) : { x: 0, y: 0 };
    const jitter = (nodes.length % 5) * 24;
    const lastCurrency = nodes.flatMap((n) => (n.type === "amount" ? [(n.data.payload as { currency: string }).currency] : []))[0] ?? "USD";
    const id = newId(type);
    setNodes((ns) => [
      ...ns.map((n) => ({ ...n, selected: false })),
      {
        id,
        type,
        position: { x: center.x - 112 + jitter, y: center.y - 40 + jitter },
        data: { payload: defaultData(type, { currency: lastCurrency, today }), status: "idle", issue: null },
        selected: true,
      },
    ]);
    setTab("props");
  }

  const selected = nodes.find((n) => n.selected) ?? null;
  const setSelectedData = (data: FlowNode["data"]) =>
    setNodes((ns) => ns.map((n) => (n.id === selected?.id ? { ...n, data: { ...n.data, payload: data } } : n)));
  const hasStart = nodes.some((n) => n.type === "start");

  function save() {
    startTransition(async () => {
      const result = await saveFlowDraftAction(contractId, graphJson, savedSha);
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      setSavedSha(result.graphSha256);
      setSavedJson(serialized);
      toast.success(result.message);
    });
  }

  function activate() {
    if (savedSha === null) return;
    startTransition(async () => {
      const result = await activateFlowAction(contractId, savedSha);
      setConfirmOpen(false);
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      toast.success(result.message);
      router.push(`/platform/contracts/${contractId}`);
    });
  }

  const summary = validation.ok ? summarizeGraph(validation.graph) : null;
  const tolerance = validation.ok
    ? validation.graph.nodes.flatMap((n) => (n.type === "amount" && n.data.mode === "fixed" && n.data.toleranceBps > 0 ? [n.data.toleranceBps / 100] : []))[0] ?? 0
    : 0;
  const activateBlock = !validation.ok
    ? "Corrige los errores de validación."
    : dirty || savedSha === null
      ? "Guarda el borrador antes de activar."
      : summary === null
        ? "El flujo necesita exactamente un nodo de monto."
        : null;
  const simBlock = validation.ok ? null : "Corrige los errores de validación para probar.";

  const overlay = "pointer-events-auto bg-background shadow-lg shadow-black/10";
  return (
    <div className="relative h-dvh w-full overflow-hidden bg-white">
      <div ref={canvasRef} className="absolute inset-0">
        <ReactFlow
          nodes={displayNodes}
          edges={edges}
          nodeTypes={flowNodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          fitView
          fitViewOptions={{ padding: 0.3, maxZoom: 1 }}
          snapToGrid
          snapGrid={[20, 20]}
          deleteKeyCode={["Backspace", "Delete"]}
          colorMode="light"
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={24} color="#e5e7eb" />
          <Controls showInteractive={false} position="bottom-left" className="!shadow-lg !shadow-black/10" />
        </ReactFlow>
      </div>

      {/* Barra superior: volver, contrato y acciones. */}
      <header className="pointer-events-none absolute inset-x-0 top-0 flex flex-wrap items-center gap-2 p-3 sm:p-4">
        <div className={`${overlay} flex items-center gap-2 rounded-xl py-1.5 pr-3 pl-1.5`}>
          <Link href={`/platform/contracts/${contractId}`} className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}>
            <ArrowLeft aria-hidden /> Volver
          </Link>
          <span className="text-sm font-semibold">{supplierName}</span>
          <Badge variant="secondary" className="hidden sm:inline-flex">{activeVersion === null ? "sin versión activa" : `activa: v${activeVersion}`}</Badge>
          <Badge variant={dirty ? "default" : "outline"}>{dirty ? "sin guardar" : savedSha === null ? "sin cambios" : "borrador guardado"}</Badge>
        </div>
        <div className={`${overlay} ml-auto flex gap-2 rounded-xl p-1.5`}>
          <Button variant="outline" size="sm" disabled={pending || !dirty || !validation.ok} onClick={save}>
            {pending ? "Guardando…" : "Guardar borrador"}
          </Button>
          <Button size="sm" disabled={pending || activateBlock !== null} onClick={() => setConfirmOpen(true)} title={activateBlock ?? undefined}>
            Activar versión
          </Button>
        </div>
      </header>

      {/* Paleta: vertical a la izquierda en pantallas medianas; en móvil, una fila bajo la barra. */}
      <aside
        aria-label="Paleta de nodos"
        className={`${overlay} absolute top-16 right-3 left-3 flex flex-row gap-1 overflow-x-auto rounded-xl p-1.5 sm:top-20 sm:right-auto sm:left-4 sm:flex-col sm:overflow-visible`}
      >
        {NODE_ORDER.map((type) => {
          const Icon = NODE_ICON[type];
          const disabled = type === "start" && hasStart;
          return (
            <Button key={type} variant="ghost" size="sm" className="justify-start" disabled={disabled} onClick={() => addNode(type)} title={NODE_META[type].description}>
              <Icon aria-hidden /> <span className="whitespace-nowrap">{NODE_META[type].label}</span>
            </Button>
          );
        })}
      </aside>

      {/* Panel derecho flotante; en móvil, una hoja inferior. */}
      <section
        aria-label="Panel del flujo"
        className={`${overlay} absolute right-3 bottom-3 left-3 flex max-h-[42vh] flex-col gap-3 overflow-y-auto rounded-xl p-3 sm:top-20 sm:right-4 sm:bottom-auto sm:left-auto sm:max-h-[calc(100dvh-6.5rem)] sm:w-80`}
      >
        <div role="tablist" className="flex gap-1">
          {([["props", "Propiedades"], ["validation", `Validación${issues.length > 0 ? ` (${issues.length})` : ""}`], ["test", "Probar"]] as const).map(([id, label]) => (
            <Button key={id} role="tab" aria-selected={tab === id} variant={tab === id ? "secondary" : "ghost"} size="sm" onClick={() => setTab(id)}>
              {label}
            </Button>
          ))}
        </div>

        {tab === "props" &&
          (selected === null ? (
            <p className="text-sm text-muted-foreground">Selecciona un nodo para editar sus propiedades, o añade uno desde la paleta. Conecta las salidas arrastrando entre los puntos.</p>
          ) : (
            <div className="flex flex-col gap-3">
              <p className="text-sm font-medium">{NODE_META[selected.type as FlowNodeType].label}</p>
              {/* key: al cambiar de nodo se reinician los campos locales (montos). */}
              <NodeInspector key={selected.id} type={selected.type as FlowNodeType} data={selected.data.payload} onChange={setSelectedData} />
              <Button variant="outline" size="sm" onClick={() => setNodes((ns) => ns.filter((n) => n.id !== selected.id))}>
                Eliminar nodo
              </Button>
            </div>
          ))}

        {tab === "validation" &&
          (issues.length === 0 ? (
            <p className="text-sm text-emerald-600" role="status">El flujo es válido.</p>
          ) : (
            <ul className="flex flex-col gap-2 text-sm">
              {issues.map((i, idx) => (
                <li key={idx}>
                  <button
                    type="button"
                    className="text-left text-destructive hover:underline disabled:no-underline"
                    disabled={i.nodeId === null}
                    onClick={() => i.nodeId !== null && setNodes((ns) => ns.map((n) => ({ ...n, selected: n.id === i.nodeId })))}
                  >
                    {i.message}
                  </button>
                </li>
              ))}
            </ul>
          ))}

        {tab === "test" && (
          <SimulatorPanel
            graph={graphJson}
            disabledReason={simBlock}
            today={today}
            onResult={(evaluation) => setTrace(evaluation === null ? null : { json: serialized, evaluation })}
          />
        )}
      </section>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Activar esta versión del flujo</DialogTitle>
            <DialogDescription>
              Desde ahora las facturas de {supplierName} se compararán con este flujo. Una versión activada no se edita: para cambiarla se crea otra.
            </DialogDescription>
          </DialogHeader>
          {summary !== null && (
            <ul className="flex flex-col gap-1 text-sm">
              <li>Monto: {formatMinor(summary.agreedAmountMinor, summary.currency)}{tolerance > 0 ? ` con tolerancia de ±${tolerance}%` : " (exacto)"}</li>
              <li>Vigencia: {summary.validFrom} → {summary.validTo ?? "sin fin"}</li>
              <li>Cuenta: {summary.beneficiaryAccountRef ?? "sin cuenta pactada"}</li>
            </ul>
          )}
          <p className="text-xs text-muted-foreground">Los datos de monto, tolerancia y cuenta los fija una persona autorizada; un contrato nunca autoriza un pago.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>Cancelar</Button>
            <Button disabled={pending} onClick={activate}>{pending ? "Activando…" : "Activar"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
