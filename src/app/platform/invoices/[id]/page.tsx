/**
 * Purpose: invoice detail (A-09): extracted data with evidence, missing fields and warnings,
 *   supplier and contract resolution, the original document and every payment decision.
 * Runs in: server (React Server Component; data streamed inside <Suspense>).
 * Triggered by: GET /platform/invoices/[id] (from the inbox).
 * Receives → Returns: route params → rendered HTML inside the platform shell (404-style message
 *   when the invoice does not exist in the active organization).
 * Talks to: ensureWorkspaceFromSession, PlatformSection, features/invoices (queries, components),
 *   contracts/money#formatMinor, shadcn Card, Badge.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { PlatformSection } from "@/components/platform/section";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatMinor } from "@/features/contracts/money";
import { RetryInvoiceButton } from "@/features/invoices/components/invoice-forms";
import { getInvoiceDetail, type InvoiceDetail } from "@/features/invoices/queries";
import { ensureWorkspaceFromSession, OrganizationRequiredError } from "@/shared/auth/ensure-workspace";

export const metadata: Metadata = { title: "Factura" };
export const maxDuration = 60;

const DECISION = {
  approved: { label: "aprobada (pago simulado)", variant: "default" },
  blocked: { label: "bloqueada", variant: "destructive" },
  requires_approval: { label: "requiere aprobación", variant: "secondary" },
} as const;
const RESULT_ICON = { pass: "✅", fail: "❌", unknown: "❔" } as const;
const MATCH = { matched: "confirmado", ambiguous: "ambiguo (lo confirma una persona)", not_found: "no reconocido" } as const;
const CONTRACT = { matched: "coincide", mismatch: "con diferencias", ambiguous: "ambiguo", not_found: "sin contrato" } as const;

export default function InvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <PlatformSection
      title="Factura"
      description="Lo que la IA leyó (con su evidencia), cómo se identificó al proveedor y qué decidió el motor de reglas."
    >
      <div className="flex flex-col gap-6">
        <Link href="/platform/invoices" className="text-sm font-medium underline-offset-4 hover:underline">
          ← Volver a facturas
        </Link>
        <Suspense fallback={<p className="text-sm text-muted-foreground">Cargando factura…</p>}>
          <InvoiceData params={params} />
        </Suspense>
      </div>
    </PlatformSection>
  );
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm">{value ?? "—"}</dd>
    </div>
  );
}

async function InvoiceData({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let workspace;
  try {
    workspace = await ensureWorkspaceFromSession();
  } catch (error) {
    if (!(error instanceof OrganizationRequiredError)) throw error;
    return <p className="rounded-lg border px-3 py-2 text-sm text-muted-foreground">Elige una organización con el selector de arriba.</p>;
  }
  const invoice = await getInvoiceDetail(workspace.organization.id, id);
  if (invoice === null) {
    return (
      <p className="text-sm text-muted-foreground">
        No hay una factura con el identificador <span className="font-mono text-foreground">{id}</span> en esta organización.
      </p>
    );
  }
  return <InvoiceView invoice={invoice} />;
}

function InvoiceView({ invoice }: { invoice: InvoiceDetail }) {
  const ctx = invoice.context;
  const latest = invoice.decisions[0] ?? null;

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Decisión</CardTitle>
          <CardDescription>
            {latest === null
              ? invoice.extractionStatus === "failed"
                ? "La lectura con IA falló: no hay decisión y nunca se aprueba por defecto."
                : "Aún sin decisión."
              : `${latest.decisionSource === "human" ? "Resuelta por una persona" : "Automática"} · ${latest.evaluatedAt.slice(0, 16).replace("T", " ")} UTC · política v${latest.policyVersion ?? "—"}`}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {invoice.extractionStatus === "failed" && (
            <div className="flex flex-col gap-2">
              <p className="text-sm text-destructive">{invoice.extractionError}</p>
              {invoice.source === "email" && <RetryInvoiceButton invoiceId={invoice.id} />}
            </div>
          )}
          {latest !== null && (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={DECISION[latest.decision].variant}>{DECISION[latest.decision].label}</Badge>
                {latest.reasonCodes.map((code) => (
                  <Badge key={code} variant="outline" className="font-mono text-[10px]">
                    {code}
                  </Badge>
                ))}
                {invoice.hasPendingApproval && (
                  <Link href="/platform/approvals" className="text-sm font-medium underline-offset-4 hover:underline">
                    Resolver en Aprobaciones →
                  </Link>
                )}
              </div>
              <p className="text-sm text-muted-foreground">{latest.explanation}</p>
              <ul className="flex flex-col gap-1 text-xs">
                {latest.rulesEvaluated.map((rule) => (
                  <li key={rule.ruleId}>
                    {RESULT_ICON[rule.result]} <span className="font-mono">{rule.ruleId}</span>
                    {rule.result !== "pass" && <span className="text-muted-foreground"> · {rule.explanation}</span>}
                  </li>
                ))}
              </ul>
            </>
          )}
        </CardContent>
      </Card>

      {ctx !== null && (
        <Card>
          <CardHeader>
            <CardTitle>Datos extraídos</CardTitle>
            <CardDescription>Afirmaciones leídas por la IA y validadas por código. Lo que no consta queda vacío, no se inventa.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <dl className="grid gap-3 sm:grid-cols-3">
              <Fact label="Proveedor" value={invoice.supplierName ?? ctx.name} />
              <Fact label="Identificación" value={MATCH[ctx.supplierMatchStatus]} />
              <Fact label="Número" value={ctx.invoiceNumber} />
              <Fact label="Monto" value={ctx.amountMinor === null || ctx.currency === null ? null : formatMinor(ctx.amountMinor, ctx.currency)} />
              <Fact label="Cuenta beneficiaria" value={ctx.beneficiaryAccountReference} />
              <Fact label="Fecha / vencimiento" value={`${ctx.invoiceDate ?? "—"} / ${ctx.dueDate ?? "—"}`} />
              <Fact label="Origen" value={ctx.source === "email" ? `correo de ${ctx.email ?? "remitente desconocido"}` : "carga manual"} />
              <Fact label="Asunto" value={ctx.subject} />
              <Fact label="Contrato" value={ctx.contractMatch === null ? "no comparado" : CONTRACT[ctx.contractMatch.matchStatus]} />
            </dl>
            {invoice.hasOriginal && (
              <a href={`/api/invoices/${invoice.id}/document`} target="_blank" rel="noreferrer" className="text-sm font-medium underline-offset-4 hover:underline">
                Ver original ↗
              </a>
            )}
            {ctx.contractMatch !== null && ctx.contractMatch.discrepancies.length > 0 && (
              <div>
                <h3 className="text-sm font-medium">Diferencias con el contrato</h3>
                <ul className="mt-1 list-disc pl-5 text-sm text-muted-foreground">
                  {ctx.contractMatch.discrepancies.map((d, i) => (
                    <li key={i}>{d.description}</li>
                  ))}
                </ul>
              </div>
            )}
            {ctx.missingFields.length > 0 && (
              <div className="flex flex-wrap items-center gap-1">
                <span className="text-sm font-medium">Faltan:</span>
                {ctx.missingFields.map((f) => (
                  <Badge key={f} variant="outline" className="font-mono text-[10px]">
                    {f}
                  </Badge>
                ))}
              </div>
            )}
            {ctx.extractionWarnings.length > 0 && (
              <div>
                <h3 className="text-sm font-medium">Advertencias de lectura</h3>
                <ul className="mt-1 list-disc pl-5 text-sm text-muted-foreground">
                  {ctx.extractionWarnings.map((w, i) => (
                    <li key={i}>
                      <span className="font-mono text-xs">{w.code}</span> · {w.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {ctx.evidence.length > 0 && (
              <div>
                <h3 className="text-sm font-medium">Evidencia (fragmentos encontrados en el documento)</h3>
                <ul className="mt-1 flex flex-col gap-1 text-sm">
                  {ctx.evidence.map((e) => (
                    <li key={e.evidenceId}>
                      <span className="font-mono text-xs text-muted-foreground">{e.field ?? "—"}</span> · “{e.excerpt}”
                      {e.page !== null && <span className="text-xs text-muted-foreground"> (pág. {e.page})</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {invoice.decisions.length > 1 && (
        <Card>
          <CardHeader>
            <CardTitle>Historial de decisiones</CardTitle>
            <CardDescription>No se reescriben: cada evaluación o resolución agrega una.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-1 text-sm">
              {invoice.decisions.map((d) => (
                <li key={d.decisionId}>
                  {d.evaluatedAt.slice(0, 16).replace("T", " ")} · {DECISION[d.decision].label} · {d.decisionSource === "human" ? "persona" : "automática"}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </>
  );
}
