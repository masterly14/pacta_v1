/**
 * Purpose: guided demo of the fiscal obligation over the simulated accounting source:
 *   connect → set rules → see what Pacta proposes → confirm → evaluate → result.
 *   Browser-only simulation with fixture data; nothing is stored and no money moves.
 * Runs in: server (shell) + client (FiscalWorkflow holds the state).
 * Triggered by: GET /platform/obligations/fiscal. Not in the global navigation yet (preview before OB-05).
 * Receives → Returns: request → rendered HTML inside the platform shell.
 * Talks to: PlatformSection, features/obligations/fiscal/components/fiscal-workflow.
 */
import type { Metadata } from "next";
import { PlatformSection } from "@/components/platform/section";
import { FiscalWorkflow } from "@/features/obligations/fiscal/components/fiscal-workflow";

export const metadata: Metadata = { title: "Impuestos (simulación)" };

export default function FiscalWorkflowPage() {
  return (
    <PlatformSection
      title="Impuestos"
      description="Pacta lee lo que tu contabilidad dice que debes, aplica las reglas de tu empresa y te avisa antes del vencimiento. No calcula impuestos ni mueve dinero: aprobada significa aprobada para pago simulado."
    >
      <FiscalWorkflow />
    </PlatformSection>
  );
}
