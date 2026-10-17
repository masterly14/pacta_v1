/**
 * Purpose: show every payment decision with its rules, reasons and policy version, and (for
 *   administrators) a simulator that runs fictitious invoices through the real decision flow.
 * Runs in: server (React Server Component; data streamed inside <Suspense>).
 * Triggered by: GET /platform/audit and refresh() after a simulator run.
 * Receives → Returns: request → rendered HTML inside the platform shell.
 * Talks to: ensureWorkspaceFromSession, PlatformSection, features/decisions (server,
 *   components/simulator), contracts/money#formatMinor, shadcn Card, Table, Badge.
 */
import type { Metadata } from "next";
import { Suspense } from "react";
import { PlatformSection } from "@/components/platform/section";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatMinor } from "@/features/contracts/money";
import { DecisionSimulator } from "@/features/decisions/components/simulator";
import { listRecentDecisions } from "@/features/decisions/server";
import { ensureWorkspaceFromSession, OrganizationRequiredError } from "@/shared/auth/ensure-workspace";

export const metadata: Metadata = { title: "Auditoría" };

const DECISION = {
  approved: { label: "aprobada", variant: "default" },
  blocked: { label: "bloqueada", variant: "destructive" },
  requires_approval: { label: "requiere aprobación", variant: "secondary" },
} as const;
const RESULT_ICON = { pass: "✅", fail: "❌", unknown: "❔" } as const;
const SOURCE_LABEL = { automatic: "automática", human: "humana" } as const;

export default function AuditPage() {
  return (
    <PlatformSection
      title="Auditoría"
      description="Decisiones anteriores, con la regla, la evidencia y quién actuó. No se reescriben: cada reevaluación agrega una fila."
    >
      <div className="flex flex-col gap-6">
        <Suspense fallback={<p className="text-sm text-muted-foreground">Cargando decisiones…</p>}>
          <AuditData />
        </Suspense>
      </div>
    </PlatformSection>
  );
}

// La sesión y la BD son datos de ejecución: con cacheComponents deben leerse dentro de <Suspense>.
async function AuditData() {
  let workspace;
  try {
    workspace = await ensureWorkspaceFromSession();
  } catch (error) {
    if (!(error instanceof OrganizationRequiredError)) throw error;
    return (
      <p className="rounded-lg border px-3 py-2 text-sm text-muted-foreground">
        Las decisiones pertenecen a una organización. Elige o crea una con el selector de arriba.
      </p>
    );
  }
  const decisions = await listRecentDecisions(workspace.organization.id);
  const isAdmin = workspace.membership.role === "admin";

  return (
    <>
      {isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle>Simulador · datos ficticios</CardTitle>
            <CardDescription>
              Mientras no existan facturas reales, cada botón crea una factura ficticia y la evalúa con el mismo
              motor que usará el pipeline de correo. La decisión se guarda de verdad (es un pago simulado) y aparece
              abajo y, si escala, en Aprobaciones. Requiere los datos demo de Políticas. Repetir un escenario el
              mismo día lo marca además como duplicado sospechoso (mismo proveedor, monto y fecha), y la autorización
              mensual de Papelería cubre solo la primera factura aprobada de cada mes.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <DecisionSimulator />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Decisiones</CardTitle>
          <CardDescription>Las 50 más recientes. Abre una fila para ver las 10 reglas evaluadas.</CardDescription>
        </CardHeader>
        <CardContent>
          {decisions.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aún no hay decisiones registradas.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Factura</TableHead>
                  <TableHead>Monto</TableHead>
                  <TableHead>Decisión</TableHead>
                  <TableHead>Motivos</TableHead>
                  <TableHead>Política</TableHead>
                  <TableHead>Fuente</TableHead>
                  <TableHead>Fecha (UTC)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {decisions.map((d) => (
                  <TableRow key={d.decisionId} className="align-top">
                    <TableCell className="max-w-72 whitespace-normal">
                      <div className="font-medium">{d.supplierName ?? "Proveedor sin confirmar"}</div>
                      <div className="text-xs text-muted-foreground">{d.invoiceNumber ?? "sin número"}</div>
                      <details className="mt-1 text-xs">
                        <summary className="cursor-pointer text-muted-foreground">Reglas</summary>
                        <p className="mt-1 text-muted-foreground">{d.explanation}</p>
                        <ul className="mt-1 flex flex-col gap-1">
                          {d.rulesEvaluated.map((rule) => (
                            <li key={rule.ruleId}>
                              {RESULT_ICON[rule.result]} <span className="font-mono">{rule.ruleId}</span>
                              {rule.result !== "pass" && <span className="text-muted-foreground"> · {rule.explanation}</span>}
                            </li>
                          ))}
                        </ul>
                      </details>
                    </TableCell>
                    <TableCell>
                      {d.amountMinor === null || d.currency === null ? "—" : formatMinor(d.amountMinor, d.currency)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={DECISION[d.decision].variant}>{DECISION[d.decision].label}</Badge>
                    </TableCell>
                    <TableCell className="max-w-56 whitespace-normal">
                      <div className="flex flex-wrap gap-1">
                        {d.reasonCodes.map((code) => (
                          <Badge key={code} variant="outline" className="font-mono text-[10px]">
                            {code}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell>{d.policyVersion === null ? "—" : `v${d.policyVersion}`}</TableCell>
                    <TableCell>{SOURCE_LABEL[d.decisionSource]}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{d.evaluatedAt.slice(0, 16).replace("T", " ")}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  );
}
