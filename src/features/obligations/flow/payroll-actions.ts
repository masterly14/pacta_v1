"use server";
/**
 * Purpose: server actions del flujo de nómina: leen un escenario del simulador de Buk (fixtures en
 *   disco, solo servidor), aplican las reglas que fijó la persona y corren el motor determinista.
 *   Nada se guarda y no se mueve dinero: `approved` significa aprobado para pago simulado.
 * Runs in: servidor (server actions de Next.js).
 * Triggered by: el flujo de nómina en /obligations/payroll (evaluar, reevaluar, revalidar antes de pagar).
 * Receives → Returns: { scenario, stageIndex, reglas } → PayrollEvaluation serializable.
 * Talks to: ensureWorkspaceFromSession, fixtures/buk (manifest, scenario), decisions/engine/obligations/payroll.
 */
import { z } from "zod";
import { decidePayrollRun, type PayrollRunResult } from "@/features/decisions/engine/obligations/payroll";
import { ensureWorkspaceFromSession } from "@/shared/auth/ensure-workspace";
import { ObligationTemplateSchema } from "@/shared/schemas/obligation-config";
import { listScenarios, loadManifest } from "../fixtures/buk/manifest";
import { openScenario } from "../fixtures/buk/scenario";

const DEMO_USER = "usuario_demo";
// Antes de cualquier evaluación de los escenarios: la activación ya estaba hecha.
const ACTIVATED_AT = "2026-10-01T00:00:00Z";

export type PayrollScenarioInfo = { name: string; description: string; period: string };

export type PayrollLineView = {
  lineId: string;
  counterpartyRef: string;
  displayName: string;
  lineType: string;
  amountMinor: number | null;
  beneficiaryAccountReference: string | null;
  lastConfirmedBeneficiaryReference: string | null;
  pendingSignals: number;
};

export type PayrollEvaluation = {
  scenario: PayrollScenarioInfo & { organization: string };
  stages: { stage: string; asOf: string; description: string }[];
  stageIndex: number;
  defaults: { active: boolean; tolerancePercent: number; evidenceMaxAgeDays: number };
  template: { obligationId: string; version: number; status: string; currency: string; runCapMinor: number; varianceToleranceBps: number; evidenceMaxAgeDays: number };
  evidence: { capturedAt: string | null; fundsAvailableMinor: number | null; fundsReservedMinor: number | null; expectedCount: number };
  lines: PayrollLineView[];
  result: PayrollRunResult;
};

export type PayrollEvaluationState = { ok: true; evaluation: PayrollEvaluation } | { ok: false; error: string };

const InputSchema = z.strictObject({
  scenario: z.string().min(1).max(80),
  stageIndex: z.int().min(0).max(10),
  // null = usar lo que trae el escenario
  rules: z
    .strictObject({
      active: z.boolean(),
      tolerancePercent: z.number().min(0).max(100),
      evidenceMaxAgeDays: z.int().min(0).max(30),
    })
    .nullable(),
});

export async function listPayrollScenarios(): Promise<PayrollScenarioInfo[]> {
  await ensureWorkspaceFromSession();
  return listScenarios().map((name) => {
    const manifest = loadManifest(name);
    return { name, description: manifest.description, period: manifest.period.month };
  });
}

export async function evaluatePayrollAction(raw: unknown): Promise<PayrollEvaluationState> {
  const parsed = InputSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Solicitud inválida." };
  const { scenario, stageIndex, rules } = parsed.data;
  try {
    await ensureWorkspaceFromSession();
    // Solo nombres del catálogo: el nombre llega del cliente y se usa para leer archivos.
    if (!listScenarios().includes(scenario)) return { ok: false, error: "Escenario desconocido." };
    const manifest = loadManifest(scenario);
    const stage = manifest.evaluations[stageIndex];
    if (!stage) return { ok: false, error: "Evaluación desconocida." };

    const opened = await openScenario(scenario);
    const base = opened.template;
    const defaults = { active: base.status === "active" && base.activatedAt !== null, tolerancePercent: base.varianceToleranceBps / 100, evidenceMaxAgeDays: base.evidenceMaxAgeDays };
    const chosen = rules ?? defaults;
    const templateInput = {
      ...base,
      status: chosen.active ? "active" : "draft",
      activatedBy: chosen.active ? (base.activatedBy ?? DEMO_USER) : null,
      activatedAt: chosen.active ? (base.activatedAt ?? ACTIVATED_AT) : null,
      varianceToleranceBps: Math.round(chosen.tolerancePercent * 100),
      evidenceMaxAgeDays: chosen.evidenceMaxAgeDays,
    };
    const template = ObligationTemplateSchema.parse(templateInput);

    const built = opened.source.occurrence(template, stage.asOf);
    const result = decidePayrollRun({ template, occurrence: built.occurrence, lines: built.lines, dataset: built.dataset });
    return {
      ok: true,
      evaluation: {
        scenario: { name: scenario, description: manifest.description, period: manifest.period.month, organization: template.organizationId },
        stages: manifest.evaluations,
        stageIndex,
        defaults,
        template: {
          obligationId: template.obligationId,
          version: template.version,
          status: template.status,
          currency: template.currency,
          runCapMinor: template.runCapMinor,
          varianceToleranceBps: template.varianceToleranceBps,
          evidenceMaxAgeDays: template.evidenceMaxAgeDays,
        },
        evidence: {
          capturedAt: built.occurrence.evidenceCapturedAt,
          fundsAvailableMinor: built.occurrence.fundsAvailableMinor,
          fundsReservedMinor: built.occurrence.fundsReservedMinor,
          expectedCount: built.occurrence.expectedCounterparties.length,
        },
        lines: built.lines.map((line) => ({
          lineId: line.lineId,
          counterpartyRef: line.counterpartyRef,
          displayName: line.displayName,
          lineType: line.lineType,
          amountMinor: line.amountMinor,
          beneficiaryAccountReference: line.beneficiaryAccountReference,
          lastConfirmedBeneficiaryReference: line.lastConfirmedBeneficiaryReference,
          pendingSignals: line.signals.filter((s) => s.status === "proposed" || s.status === "verified").length,
        })),
        result,
      },
    };
  } catch (error) {
    console.error("[obligations/payroll] falló la evaluación", error);
    return { ok: false, error: "No se pudo evaluar la nómina. Intenta de nuevo." };
  }
}
