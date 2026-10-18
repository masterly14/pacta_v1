"use client";
/**
 * Purpose: cargar los flujos de obligaciones solo en el navegador (React Flow necesita DOM) y dejar
 *   fuera de las páginas de servidor el peso de la librería.
 * Runs in: browser.
 * Triggered by: /obligations/[useCase].
 * Receives → Returns: las mismas props que PayrollFlow / FiscalFlow → componente cargado en diferido.
 * Talks to: next/dynamic, ./fiscal-flow, ./payroll-persisted-flow, ./blank-flow.
 */
import dynamic from "next/dynamic";

const Loading = () => <div aria-busy="true" aria-label="Cargando flujo" className="h-dvh animate-pulse bg-muted/30" />;

export const FiscalFlowLoader = dynamic(() => import("./fiscal-flow").then((m) => m.FiscalFlow), { ssr: false, loading: Loading });
export const PayrollFlowLoader = dynamic(() => import("./payroll-persisted-flow").then((m) => m.PayrollPersistedFlow), { ssr: false, loading: Loading });
export const BlankFlowLoader = dynamic(() => import("./blank-flow").then((m) => m.BlankFlow), { ssr: false, loading: Loading });
