"use client";
/**
 * Purpose: cargar el editor y el visor de flujos solo en el navegador (React Flow necesita DOM),
 *   dejando fuera de las páginas de servidor el peso de la librería.
 * Runs in: browser.
 * Triggered by: las páginas /platform/contracts/[id] y /contracts/[id]/flow.
 * Receives → Returns: las mismas props que FlowEditor / FlowViewer → componente cargado en diferido.
 * Talks to: next/dynamic, ./flow-editor, ./flow-viewer.
 */
import dynamic from "next/dynamic";

const Loading = () => <div aria-busy="true" className="h-[420px] animate-pulse rounded-xl bg-muted/30" />;
const LoadingFull = () => <div aria-busy="true" className="h-dvh animate-pulse bg-muted/30" />;

export const FlowEditorLoader = dynamic(() => import("./flow-editor").then((m) => m.FlowEditor), { ssr: false, loading: LoadingFull });
export const FlowViewerLoader = dynamic(() => import("./flow-viewer").then((m) => m.FlowViewer), { ssr: false, loading: Loading });
