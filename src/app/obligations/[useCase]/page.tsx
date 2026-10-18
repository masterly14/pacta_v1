/**
 * Purpose: flujo de una obligación a pantalla completa, fuera del shell de la plataforma (sin
 *   sidebar): nómina (recursos humanos, Buk simulado) o impuestos (contabilidad simulada). Todo
 *   son datos ficticios y el pago es simulado.
 * Runs in: server (React Server Component; datos dentro de <Suspense>).
 * Triggered by: GET /obligations/payroll y /obligations/fiscal (el proxy exige sesión; aquí se
 *   vuelve a exigir una organización).
 * Receives → Returns: request → el lienzo de React Flow del caso de uso elegido.
 * Talks to: ensureWorkspaceFromSession, features/obligations/flow (payroll-actions, components).
 */
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { buttonVariants } from "@/components/ui/button";
import { FiscalFlowLoader, PayrollFlowLoader } from "@/features/obligations/flow/components/process-loader";
import { listPayrollScenarios } from "@/features/obligations/flow/payroll-actions";
import { cn } from "@/lib/utils";
import { ensureWorkspaceFromSession, OrganizationRequiredError } from "@/shared/auth/ensure-workspace";

export const metadata: Metadata = { title: "Flujo de obligación" };

const BACK = "/platform/obligations";

export default function ObligationFlowPage({ params }: { params: Promise<{ useCase: string }> }) {
  return (
    <main className="h-dvh w-full bg-white text-foreground">
      <Suspense fallback={<div aria-busy="true" aria-label="Cargando flujo" className="h-dvh animate-pulse bg-muted/30" />}>
        <FlowData params={params} />
      </Suspense>
    </main>
  );
}

async function FlowData({ params }: { params: Promise<{ useCase: string }> }) {
  const { useCase } = await params;
  if (useCase !== "payroll" && useCase !== "fiscal") notFound();

  try {
    await ensureWorkspaceFromSession();
  } catch (error) {
    if (!(error instanceof OrganizationRequiredError)) throw error;
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="max-w-md text-sm text-muted-foreground">Las obligaciones pertenecen a una organización. Elige o crea una desde la plataforma.</p>
        <Link href={BACK} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
          Volver
        </Link>
      </div>
    );
  }

  if (useCase === "fiscal") return <FiscalFlowLoader backHref={BACK} />;
  return <PayrollFlowLoader scenarios={await listPayrollScenarios()} backHref={BACK} />;
}
