"use client";
/**
 * Purpose: vista de solo lectura del flujo de una versión (activa o histórica) del contrato.
 * Runs in: browser (cargado con next/dynamic, sin SSR, desde flow-loaders.tsx).
 * Triggered by: /platform/contracts/[id] y la lista de versiones.
 * Receives → Returns: ContractFlowGraph → canvas sin edición, con los mismos nodos que el editor.
 * Talks to: @xyflow/react, ./flow-model, ./flow-nodes.
 */
import "@xyflow/react/dist/style.css";
import { Background, Controls, ReactFlow } from "@xyflow/react";
import { useMemo } from "react";
import type { ContractFlowGraph } from "../../flow/schema";
import { toRf } from "./flow-model";
import { flowNodeTypes } from "./flow-nodes";

export function FlowViewer({ graph }: { graph: ContractFlowGraph }) {
  const { nodes, edges } = useMemo(() => toRf(graph), [graph]);
  return (
    <div className="h-[420px] overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-black/5">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={flowNodeTypes}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        fitView
        fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
        colorMode="light"
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={20} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
