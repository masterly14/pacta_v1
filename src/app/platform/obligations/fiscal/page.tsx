/**
 * Purpose: preview of the fiscal obligation over the simulated accounting source: pick a demo
 *   scenario and a date, see the T-7 / T-3 alerts and each tax line's decision with its rules.
 *   Everything is fixture data evaluated in memory; nothing is stored and no money moves.
 * Runs in: server (React Server Component; URL params read inside <Suspense>).
 * Triggered by: GET /platform/obligations/fiscal[?scenario=fiscal-limpio|fiscal-anomalias&date=YYYY-MM-DD].
 *   Not in the global navigation yet (preview before OB-05).
 * Receives → Returns: request → rendered HTML inside the platform shell.
 * Talks to: features/obligations/fiscal (fixture-source, labels), decisions/engine/obligations/fiscal
 *   (decideFiscalRun, fiscalAlerts), contracts/money#formatMinor, shadcn Card, Table, Badge.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { PlatformSection } from "@/components/platform/section";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatMinor } from "@/features/contracts/money";
import { decideFiscalRun, fiscalAlerts } from "@/features/decisions/engine/obligations/fiscal";
import { FISCAL_SCENARIO_NAMES, loadFiscalScenario, type FiscalScenarioName } from "@/features/obligations/fiscal/fixture-source";
import { FISCAL_OUTCOME, FISCAL_REASON, FISCAL_RULE, FISCAL_TYPE } from "@/features/obligations/fiscal/labels";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Impuestos (vista previa)" };

// Fechas del reloj de demo: aviso temprano, aviso urgente y vencido. 14:00 UTC = mañana en Bogotá.
const DATES = [
  { date: "2026-11-03", label: "3 nov · T-7" },
  { date: "2026-11-07", label: "7 nov · T-3" },
  { date: "2026-11-11", label: "11 nov · vencido" },
] as const;
const DEFAULT_DATE = "2026-11-07";

const SCENARIO_LABEL: Record<FiscalScenarioName, string> = {
  "fiscal-limpio": "Escenario limpio",
  "fiscal-anomalias": "Escenario con anomalías",
};

type SearchParams = Promise<{ scenario?: string | string[]; date?: string | string[] }>;

export default function FiscalPreviewPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <PlatformSection
      title="Impuestos · vista previa"
      description="Pacta lee el borrador de tu contabilidad (simulada), lo cruza con la liquidación confirmada y avisa antes del vencimiento. No calcula impuestos ni mueve dinero: aprobada significa aprobada para pago simulado."
    >
      <div className="flex flex-col gap-6">
        <Suspense fallback={<p className="text-sm text-muted-foreground">Cargando escenario…</p>}>
          <FiscalPreview searchParams={searchParams} />
        </Suspense>
      </div>
    </PlatformSection>
  );
}

async function FiscalPreview({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  // Un valor desconocido en la URL vuelve al valor por defecto, no a un error.
  const scenarioName = FISCAL_SCENARIO_NAMES.find((n) => n === params.scenario) ?? "fiscal-anomalias";
  const date = DATES.find((d) => d.date === params.date)?.date ?? DEFAULT_DATE;
  const asOf = `${date}T14:00:00Z`;

  const scenario = loadFiscalScenario(scenarioName);
  const { template, snapshot, settlements, run } = scenario;
  const currency = snapshot.currency;
  const alerts = fiscalAlerts({ template, snapshot, run, asOf });
  const beforeSnapshot = Date.parse(asOf) < Date.parse(snapshot.capturedAt);
  const result = beforeSnapshot ? null : decideFiscalRun({ template, snapshot, settlements, run, asOf });
  const href = (s: string, d: string) => `/platform/obligations/fiscal?scenario=${s}&date=${d}`;

  return (
    <>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">Datos simulados</Badge>
          <span className="text-sm text-muted-foreground">{scenario.description}</span>
        </div>
        <nav className="flex flex-wrap gap-2" aria-label="Escenario">
          {FISCAL_SCENARIO_NAMES.map((n) => (
            <FilterLink key={n} href={href(n, date)} active={n === scenarioName} label={SCENARIO_LABEL[n]} />
          ))}
        </nav>
        <nav className="flex flex-wrap gap-2" aria-label="Fecha del reloj de demo">
          {DATES.map((d) => (
            <FilterLink key={d.date} href={href(scenarioName, d.date)} active={d.date === date} label={d.label} />
          ))}
        </nav>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Plantilla «Impuestos»" value={template.status === "active" ? `Activa · v${template.version}` : template.status} />
        <Stat label="Fondos libres" value={formatMinor(Math.max(run.fundsAvailableMinor - run.fundsReservedMinor, 0), currency)} />
        <Stat label="Tolerancia · tope de corrida" value={`${template.varianceToleranceBps / 100} % · ${formatMinor(template.runCapMinor, currency)}`} />
        <Stat label="Contabilidad capturada" value={snapshot.capturedAt.slice(0, 10)} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Avisos al {date}</CardTitle>
          <CardDescription>
            Vencimientos en los próximos {template.earlyAlertDays} días. Un aviso informa; no aprueba ni bloquea.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {alerts.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nada vence en la ventana de aviso.</p>
          ) : (
            alerts.map((a) => (
              <div
                key={`${a.fiscalType}:${a.periodStart}`}
                className={cn("rounded-lg border px-3 py-2 text-sm", a.reasonCodes.length > 0 && "border-destructive/40 bg-destructive/5")}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={a.level === "urgent" ? "destructive" : "secondary"}>{a.level === "urgent" ? `Urgente · T-${a.daysUntilDue}` : `T-${a.daysUntilDue}`}</Badge>
                  {a.reasonCodes.map((code) => (
                    <Badge key={code} variant="outline">{FISCAL_REASON[code]}</Badge>
                  ))}
                </div>
                <p className="mt-1">{a.message}</p>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Decisiones al {date}</CardTitle>
          <CardDescription>
            {result === null
              ? `La contabilidad simulada se capturó el ${snapshot.capturedAt.slice(0, 10)}: antes de esa fecha no hay evidencia con qué decidir.`
              : result.held
                ? "La corrida quedó retenida: el total aprobable supera los fondos libres."
                : "Cada impuesto pasa por las mismas reglas, en el mismo orden. Abre una fila para ver cada regla."}
          </CardDescription>
        </CardHeader>
        {result !== null && (
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Impuesto</TableHead>
                    <TableHead>Borrador contable</TableHead>
                    <TableHead>Liquidación</TableHead>
                    <TableHead>Vence</TableHead>
                    <TableHead>Resultado</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.lines.map((line) => {
                    const settlement = settlements.find((s) => s.fiscalType === line.fiscalType && s.periodStart === line.periodStart) ?? null;
                    const item = snapshot.items.find((i) => i.fiscalType === line.fiscalType && i.periodStart === line.periodStart);
                    return (
                      <TableRow key={line.lineId} className={line.decision === "blocked" ? "bg-destructive/5" : undefined}>
                        <TableCell className="align-top">
                          <div className="font-medium">{FISCAL_TYPE[line.fiscalType]}</div>
                          <div className="text-xs text-muted-foreground">{item?.displayName}</div>
                        </TableCell>
                        <TableCell className="align-top tabular-nums">{line.amountMinor === null ? "—" : formatMinor(line.amountMinor, currency)}</TableCell>
                        <TableCell className="align-top text-sm">
                          {settlement === null ? (
                            <span className="text-muted-foreground">Sin liquidación</span>
                          ) : (
                            <>
                              <div className="tabular-nums">{formatMinor(settlement.amountMinor, currency)}</div>
                              <div className="text-xs text-muted-foreground">
                                {settlement.status === "confirmed" ? "Confirmada" : "Propuesta"} · {settlement.source === "inbox" ? "por correo" : "manual"}
                              </div>
                            </>
                          )}
                        </TableCell>
                        <TableCell className="align-top text-sm">{line.dueDate}</TableCell>
                        <TableCell className="min-w-72 align-top">
                          <details>
                            <summary className="cursor-pointer list-none">
                              <div className="flex flex-wrap gap-1">
                                <Badge variant={FISCAL_OUTCOME[line.decision].variant}>{FISCAL_OUTCOME[line.decision].label}</Badge>
                                {line.decision !== "approved" &&
                                  line.reasonCodes
                                    .filter((code) => code !== "HUMAN_APPROVAL_REQUIRED")
                                    .map((code) => (
                                      <Badge key={code} variant="outline">{FISCAL_REASON[code]}</Badge>
                                    ))}
                              </div>
                              <p className="mt-1 whitespace-normal text-xs text-muted-foreground">{line.explanation}</p>
                            </summary>
                            <ul className="mt-2 flex flex-col gap-1 border-t pt-2 text-xs">
                              {line.rulesEvaluated.map((rule) => (
                                <li key={rule.ruleId} className="flex gap-2 whitespace-normal">
                                  <span aria-hidden>{rule.result === "pass" ? "✓" : rule.result === "fail" ? "✗" : "?"}</span>
                                  <span>
                                    <span className="font-medium">{FISCAL_RULE[rule.ruleId] ?? rule.ruleId}</span>
                                    <span className="text-muted-foreground"> · {rule.explanation}</span>
                                  </span>
                                </li>
                              ))}
                            </ul>
                          </details>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        )}
      </Card>
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-base">{value}</CardTitle>
      </CardHeader>
    </Card>
  );
}

function FilterLink({ href, active, label }: { href: string; active: boolean; label: string }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn("rounded-full border px-3 py-1 text-sm", active ? "bg-muted font-medium" : "text-muted-foreground hover:bg-muted/70")}
    >
      {label}
    </Link>
  );
}
