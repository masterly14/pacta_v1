/**
 * Recorrido completo sobre el almacén en memoria: reloj de demo → tick idempotente → corrida preparada → avisos →
 * ejecución simulada → aprobación humana con revalidación. Cada caso trampa del plan tiene su prueba.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { PolicyActor } from "@/features/policies/permissions";
import { OBLIGATION_BASE } from "./fixtures/buk/builders";
import { replayLedger } from "./fixtures/buk/ledger";
import { HISTORY_RESOLUTIONS } from "./fixtures/buk/resolutions";
import { advanceDemoClock, readClock, setDemoClockDate } from "./clock";
import { resolveObligationLine } from "./lines";
import { createMemoryRuntime } from "./memory-store";
import { openFixturePayroll, type PayrollFacts, type PayrollFactsOpener } from "./runner";
import { DEFAULT_SCHEDULE } from "./schedule/calendar";
import { runTick } from "./tick";

const ORG = "org_flow_test";
const SCENARIO = "aprendizaje-trimestral";

const admin: PolicyActor = { userId: "usr_admin", organizationId: ORG, role: "admin", permission: { canApprove: true, approvalLimitMinor: 1_000_000_000, canManagePolicies: true } };
const member: PolicyActor = { userId: "usr_member", organizationId: ORG, role: "member", permission: { canApprove: true, approvalLimitMinor: 1_000_000_000, canManagePolicies: false } };
const noPermission: PolicyActor = { userId: "usr_nobody", organizationId: ORG, role: "member", permission: null };

async function setup(options: { active?: boolean } = {}) {
  const runtime = createMemoryRuntime();
  const template = { ...OBLIGATION_BASE, organizationId: ORG, evidenceMaxAgeDays: 2 };
  const draft = options.active === false;
  const obligation = await runtime.store.insertObligation({
    organizationId: ORG,
    obligationId: template.obligationId,
    version: 1,
    kind: "payroll",
    status: draft ? "draft" : "active",
    template: draft ? { ...template, status: "draft", activatedBy: null, activatedAt: null } : template,
    settings: { schedule: DEFAULT_SCHEDULE, source: { provider: "buk_fixture", scenario: SCENARIO } },
    createdBy: "usr_admin",
    activatedBy: draft ? null : "usr_admin",
    activatedAt: draft ? null : "2025-09-01T14:00:00Z",
  });
  // Lo confirmado hasta febrero, derivado del libro de decisiones (no escrito a mano)
  const ledger = await replayLedger({ template: OBLIGATION_BASE, from: "2025-10", to: "2026-02", resolutions: HISTORY_RESOLUTIONS.filter((r) => r.month <= "2026-02") });
  for (const [counterpartyRef, confirmed] of Object.entries(ledger.confirmed)) {
    await runtime.store.upsertConfirmation({ organizationId: ORG, obligationId: template.obligationId, counterpartyRef, beneficiaryReference: confirmed.beneficiaryReference, amountMinor: confirmed.amountMinor!, confirmedPeriod: "2026-02-01" });
  }
  return { runtime, obligation };
}

const tickInput = (runtime: ReturnType<typeof createMemoryRuntime>, openFacts: PayrollFactsOpener = openFixturePayroll) => ({ runtime, organizationId: ORG, openFacts });
const start = (date: string) => ({ now: `${date}T14:00:00Z`, mode: "demo" as const });

/** Envuelve la fuente para alterar los hechos de un instante concreto (una novedad, un retiro). */
const withFacts = (mutate: (facts: PayrollFacts, asOf: string) => void): PayrollFactsOpener => async (input) => {
  const facts = await openFixturePayroll(input);
  mutate(facts, input.asOf);
  return facts;
};

const proposedSignal = { signalId: "buk-webhook:job_termination:1002:test", kind: "employment_event" as const, status: "proposed" as const };

async function marchRun() {
  const ctx = await setup();
  const { reports } = await advanceDemoClock({ ...tickInput(ctx.runtime), to: "2026-03-31", by: "usr_admin", start: start("2026-03-10") });
  return { ...ctx, reports };
}

describe("tick y reloj de demo", () => {
  let ctx: Awaited<ReturnType<typeof marchRun>>;
  beforeEach(async () => {
    ctx = await marchRun();
  });

  it("recorre el calendario día a día: prepara a T-7, avisa a T-3 y ejecuta el día del vencimiento", async () => {
    const claims = (await ctx.runtime.store.listPhaseClaims(ORG, OBLIGATION_BASE.obligationId)).map((c) => `${c.periodStart}:${c.phase}:${c.asOf.slice(0, 10)}`);
    expect(claims).toEqual(
      expect.arrayContaining([
        "2026-03-01:prepare:2026-03-24",
        "2026-03-01:alert_early:2026-03-24",
        "2026-03-01:alert_urgent:2026-03-28",
        "2026-03-01:execute:2026-03-31",
      ]),
    );
  });

  it("la corrida de marzo paga lo limpio y deja la bonificación de 1002 para una persona", async () => {
    const occurrence = (await ctx.runtime.store.getOccurrence(ORG, OBLIGATION_BASE.obligationId, "2026-03-01"))!;
    expect(occurrence.status).toBe("in_approval");
    const payments = await ctx.runtime.store.listPayments(ORG, occurrence.id);
    expect(payments).toHaveLength(11);
    expect(payments.every((p) => p.currency === "COP" && p.amountMinor > 0)).toBe(true);
    const pending = await ctx.runtime.store.listRequests(ORG, "pending", 50);
    expect(pending).toHaveLength(1);
    const decision = (await ctx.runtime.store.getDecision(ORG, pending[0]!.decisionId))!;
    expect(decision.counterpartyRef).toBe("buk:employee:1002");
    expect(decision.reasonCodes).toContain("VARIANCE_EXCEEDED");
    expect(decision.rules.length).toBeGreaterThan(8); // todas las reglas con su explicación
  });

  it("repetir el tick no duplica nada: fases, decisiones, solicitudes ni pagos", async () => {
    const before = { decisions: ctx.runtime.store.decisions.length, requests: ctx.runtime.store.requests.length, payments: ctx.runtime.store.payments.length, claims: ctx.runtime.store.claims.length };
    const again = await runTick({ ...tickInput(ctx.runtime), now: "2026-03-31T14:00:00Z" });
    expect(again.entries.every((e) => e.outcome === "skipped")).toBe(true);
    expect({ decisions: ctx.runtime.store.decisions.length, requests: ctx.runtime.store.requests.length, payments: ctx.runtime.store.payments.length, claims: ctx.runtime.store.claims.length }).toEqual(before);
  });

  it("el avance del reloj es idempotente y nunca retrocede", async () => {
    await expect(advanceDemoClock({ ...tickInput(ctx.runtime), to: "2026-03-20", by: "usr_admin", start: start("2026-03-31") })).rejects.toThrow(/solo avanza/);
    expect(await ctx.runtime.store.getDemoClock(ORG)).toBe("2026-03-31T14:00:00Z");
  });

  it("dos ticks simultáneos reclaman cada fase una sola vez", async () => {
    const fresh = await setup();
    const [a, b] = await Promise.all([runTick({ ...tickInput(fresh.runtime), now: "2026-03-31T14:00:00Z" }), runTick({ ...tickInput(fresh.runtime), now: "2026-03-31T14:00:00Z" })]);
    const ran = [...a.entries, ...b.entries].filter((e) => e.outcome === "ran" && e.periodStart === "2026-03-01");
    expect(new Set(ran.map((e) => e.phase)).size).toBe(ran.length);
    expect(fresh.runtime.store.payments.length).toBe(11);
  });
});

describe("seguridad del tick", () => {
  it("una plantilla en borrador no genera ocurrencias ni pagos", async () => {
    const ctx = await setup({ active: false });
    const report = await runTick({ ...tickInput(ctx.runtime), now: "2026-03-31T14:00:00Z" });
    expect(report.entries).toEqual([]);
    expect(ctx.runtime.store.occurrences).toHaveLength(0);
  });

  it("si la lectura de RR. HH. falla, no se paga, la fase queda libre y el siguiente tick la repite", async () => {
    const ctx = await setup();
    const broken: PayrollFactsOpener = async () => {
      throw new Error("RR. HH. no responde");
    };
    const failed = await runTick({ ...tickInput(ctx.runtime, broken), now: "2026-03-31T14:00:00Z" });
    expect(failed.entries.some((e) => e.outcome === "failed" && e.detail === "RR. HH. no responde")).toBe(true);
    expect(ctx.runtime.store.payments).toHaveLength(0);
    // la transacción de preparar y la de ejecutar revirtieron: ninguna quedó reclamada (solo los avisos, que no leen RR. HH.)
    expect(ctx.runtime.store.claims.map((c) => c.phase).sort()).toEqual(["alert_early", "alert_urgent"]);
    expect(ctx.runtime.store.audits.some((a) => a.eventType === "obligation_run.failed")).toBe(true);
    const recovered = await runTick({ ...tickInput(ctx.runtime), now: "2026-03-31T14:00:00Z" });
    expect(recovered.entries.some((e) => e.outcome === "ran")).toBe(true);
    expect(ctx.runtime.store.payments).toHaveLength(11);
  });

  it("una novedad que llega entre preparar y ejecutar revierte lo aprobado: esa línea no se paga", async () => {
    const ctx = await setup();
    const withSignal = withFacts((facts, asOf) => {
      if (asOf >= "2026-03-30") {
        const line = facts.lines.find((l) => l.counterpartyRef === "buk:employee:1003" && l.lineType === "salary")!;
        line.signals = [...line.signals, proposedSignal];
      }
    });
    await advanceDemoClock({ ...tickInput(ctx.runtime, withSignal), to: "2026-03-31", by: "usr_admin", start: start("2026-03-10") });
    const occurrence = (await ctx.runtime.store.getOccurrence(ORG, OBLIGATION_BASE.obligationId, "2026-03-01"))!;
    const paid = (await ctx.runtime.store.listPayments(ORG, occurrence.id)).map((p) => p.lineId);
    expect(paid.some((id) => id.includes("buk-liquidacion-") && paid.length === 10)).toBe(true);
    const decisions = await ctx.runtime.store.latestDecisions(ORG, occurrence.id);
    const line1003 = decisions.find((d) => d.counterpartyRef === "buk:employee:1003")!;
    expect(line1003.decision).toBe("requires_approval");
    expect(line1003.reasonCodes).toContain("SIGNAL_PENDING_REVIEW");
    expect(ctx.runtime.store.payments).toHaveLength(10);
  });

  it("el reloj de demo solo rige con las herramientas de prueba activas", async () => {
    const ctx = await setup();
    await setDemoClockDate(ctx.runtime.store, ORG, "2026-03-05", "usr_admin");
    expect((await readClock(ctx.runtime.store, ORG, { demoEnabled: true })).mode).toBe("demo");
    const system = await readClock(ctx.runtime.store, ORG, { demoEnabled: false, systemNow: () => new Date("2027-01-02T10:00:00.000Z") });
    expect(system).toEqual({ now: "2027-01-02T10:00:00Z", mode: "system" });
  });
});

describe("aprobación humana de una línea", () => {
  const resolve = async (ctx: Awaited<ReturnType<typeof marchRun>>, actor: PolicyActor, action: "approve" | "reject", openFacts: PayrollFactsOpener = openFixturePayroll, comment: string | null = "Bonificación trimestral por metas, autorizada.") => {
    const [request] = await ctx.runtime.store.listRequests(ORG, "pending", 10);
    return resolveObligationLine({ runtime: ctx.runtime, actor, input: { requestId: request!.id, action, comment }, now: "2026-03-31T20:00:00Z", policyCurrency: "USD", openFacts });
  };

  it("sin permiso de aprobación o con un usuario sin fila de permisos, se rechaza", async () => {
    const ctx = await marchRun();
    expect(await resolve(ctx, noPermission, "approve")).toMatchObject({ ok: false });
    expect(ctx.runtime.store.requests.filter((r) => r.status === "pending")).toHaveLength(1);
  });

  it("en otra moneda que la de la política solo un administrador aprueba (no se convierte moneda)", async () => {
    const ctx = await marchRun();
    const denied = await resolve(ctx, member, "approve");
    expect(denied).toMatchObject({ ok: false });
    expect((denied as { error: string }).error).toMatch(/administrador/);
    expect(await resolve(ctx, admin, "approve")).toMatchObject({ ok: true, outcome: "approved" });
  });

  it("aprobar reevalúa, registra la decisión humana con el comentario y, vencida la fecha, paga en simulación", async () => {
    const ctx = await marchRun();
    const result = await resolve(ctx, admin, "approve");
    expect(result).toMatchObject({ ok: true, outcome: "approved" });
    const occurrence = (await ctx.runtime.store.getOccurrence(ORG, OBLIGATION_BASE.obligationId, "2026-03-01"))!;
    expect(occurrence.status).toBe("simulated_executed");
    expect(await ctx.runtime.store.listPayments(ORG, occurrence.id)).toHaveLength(12);
    const history = await ctx.runtime.store.decisionHistory(ORG, occurrence.id, ctx.runtime.store.requests[0]!.lineId);
    const human = history.at(-1)!;
    expect(human).toMatchObject({ decisionSource: "human", decision: "approved", actorId: "usr_admin", comment: "Bonificación trimestral por metas, autorizada." });
    expect(ctx.runtime.store.audits.some((a) => a.eventType === "obligation_line.approved")).toBe(true);
    // el monto confirmado de 1002 ya incluye la bonificación aprobada
    expect((await ctx.runtime.store.confirmations(ORG, OBLIGATION_BASE.obligationId))["buk:employee:1002"]!.amountMinor).toBeGreaterThan(700_000_000);
  });

  it("resolver dos veces la misma solicitud falla y no paga dos veces", async () => {
    const ctx = await marchRun();
    const [request] = await ctx.runtime.store.listRequests(ORG, "pending", 10);
    const args = { runtime: ctx.runtime, actor: admin, input: { requestId: request!.id, action: "approve" as const, comment: null }, now: "2026-03-31T20:00:00Z", policyCurrency: "USD", openFacts: openFixturePayroll };
    expect(await resolveObligationLine(args)).toMatchObject({ ok: true });
    expect(await resolveObligationLine(args)).toMatchObject({ ok: false });
    expect(ctx.runtime.store.payments).toHaveLength(12);
  });

  it("rechazar cierra la línea: no se paga y reevaluar no la reabre", async () => {
    const ctx = await marchRun();
    expect(await resolve(ctx, admin, "reject")).toMatchObject({ ok: true, outcome: "rejected" });
    await runTick({ ...tickInput(ctx.runtime), now: "2026-04-01T14:00:00Z" });
    expect(ctx.runtime.store.payments).toHaveLength(11);
    const [lineId] = [ctx.runtime.store.requests[0]!.lineId];
    const occurrence = (await ctx.runtime.store.getOccurrence(ORG, OBLIGATION_BASE.obligationId, "2026-03-01"))!;
    expect((await ctx.runtime.store.latestDecisions(ORG, occurrence.id)).find((d) => d.lineId === lineId)).toMatchObject({ decisionSource: "human", decision: "blocked" });
  });

  it("un bloqueo absoluto al revalidar prevalece sobre la aprobación humana", async () => {
    const ctx = await marchRun();
    const retired = withFacts((facts) => {
      const employee = facts.dataset.employees.find((e) => e.counterpartyRef === "buk:employee:1002")!;
      employee.status = "terminated";
    });
    const result = await resolve(ctx, admin, "approve", retired);
    expect(result).toMatchObject({ ok: true, outcome: "blocked_on_revalidation" });
    expect(ctx.runtime.store.payments).toHaveLength(11);
    expect(ctx.runtime.store.requests[0]!.status).toBe("rejected");
  });

  it("la aprobación humana no cubre un motivo nuevo: otra novedad antes de pagar exige otra aprobación", async () => {
    const ctx = await setup();
    await advanceDemoClock({ ...tickInput(ctx.runtime), to: "2026-03-26", by: "usr_admin", start: start("2026-03-10") });
    const [request] = await ctx.runtime.store.listRequests(ORG, "pending", 10);
    expect(await resolveObligationLine({ runtime: ctx.runtime, actor: admin, input: { requestId: request!.id, action: "approve", comment: "ok" }, now: "2026-03-26T20:00:00Z", policyCurrency: "USD", openFacts: openFixturePayroll })).toMatchObject({ ok: true });
    const withSignal = withFacts((facts, asOf) => {
      if (asOf >= "2026-03-30") facts.lines.find((l) => l.counterpartyRef === "buk:employee:1002" && l.lineType === "salary")!.signals = [proposedSignal];
    });
    await advanceDemoClock({ ...tickInput(ctx.runtime, withSignal), to: "2026-03-31", by: "usr_admin", start: start("2026-03-26") });
    const occurrence = (await ctx.runtime.store.getOccurrence(ORG, OBLIGATION_BASE.obligationId, "2026-03-01"))!;
    expect(await ctx.runtime.store.listPayments(ORG, occurrence.id)).toHaveLength(11); // 1002 quedó sin pagar
    expect(await ctx.runtime.store.listRequests(ORG, "pending", 10)).toHaveLength(1); // y vuelve a la bandeja
  });
});
