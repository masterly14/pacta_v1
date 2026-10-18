/**
 * Prueba de humo del Core proactivo contra Postgres, SIN dejar rastro: todo corre dentro de UNA transacción que se
 * revierte al final (las decisiones y los pagos son de solo inserción, así que no habría cómo limpiarlos después).
 * Crea una organización temporal, activa una plantilla, avanza el reloj de demo de marzo de 2026, comprueba el tick, la
 * idempotencia, el índice único de fases, el trigger de solo inserción y la aprobación humana, y revierte.
 *
 *   node --env-file=.env ./node_modules/vite-node/vite-node.mjs --config vitest.config.ts scripts/smoke-obligations-db.ts
 */
import { db } from "@/lib/db";
import { OBLIGATION_BASE } from "@/features/obligations/fixtures/buk/builders";
import { replayLedger } from "@/features/obligations/fixtures/buk/ledger";
import { HISTORY_RESOLUTIONS } from "@/features/obligations/fixtures/buk/resolutions";
import { resolveObligationLine } from "@/features/obligations/lines";
import { createRuntimeOverTransaction } from "@/features/obligations/prisma-store";
import { openFixturePayroll } from "@/features/obligations/runner";
import { DEFAULT_SCHEDULE } from "@/features/obligations/schedule/calendar";
import { buildPayrollTemplate, payrollObligationIdOf } from "@/features/obligations/server";
import { runTick } from "@/features/obligations/tick";
import type { PolicyActor } from "@/features/policies/permissions";

class Rollback extends Error {}

const checks: string[] = [];
function expect(condition: boolean, label: string) {
  if (!condition) throw new Error(`✘ ${label}`);
  checks.push(`✔ ${label}`);
}

const ORG = `org_smoke_${Date.now()}`;
const before = await db.paymentObligation.count();

try {
  await db.$transaction(
    async (tx) => {
      await tx.organization.create({ data: { id: ORG, name: "Org de humo (se revierte)" } });
      const runtime = createRuntimeOverTransaction(tx);
      const obligationId = payrollObligationIdOf(ORG);
      await runtime.store.insertObligation({
        organizationId: ORG,
        obligationId,
        version: 1,
        kind: "payroll",
        status: "active",
        template: buildPayrollTemplate({ organizationId: ORG, obligationId, version: 1, status: "active", activatedBy: "usr_smoke", activatedAt: "2025-09-01T14:00:00Z" }),
        settings: { schedule: DEFAULT_SCHEDULE, source: { provider: "buk_fixture", scenario: "aprendizaje-trimestral" } },
        createdBy: "usr_smoke",
        activatedBy: "usr_smoke",
        activatedAt: "2025-09-01T14:00:00Z",
      });
      const ledger = await replayLedger({ template: OBLIGATION_BASE, from: "2025-10", to: "2026-02", resolutions: HISTORY_RESOLUTIONS.filter((r) => r.month <= "2026-02") });
      for (const [counterpartyRef, confirmed] of Object.entries(ledger.confirmed)) {
        await runtime.store.upsertConfirmation({ organizationId: ORG, obligationId, counterpartyRef, beneficiaryReference: confirmed.beneficiaryReference, amountMinor: confirmed.amountMinor!, confirmedPeriod: "2026-02-01" });
      }

      const probe = await runTick({ runtime, organizationId: ORG, now: "2026-03-24T14:00:00Z", openFacts: openFixturePayroll });
      const probeFailed = probe.entries.find((e) => e.outcome === "failed");
      if (probeFailed) throw new Error(`Fase ${probeFailed.phase} falló: ${probeFailed.detail}`);
      // Avance día a día (como advanceDemoClock) pero parando en el primer fallo: un tick atrapa los errores de cada fase y,
      // dentro de esta transacción única, un error de SQL dejaría todo abortado sin decir por qué.
      const reports = [probe];
      for (let day = new Date("2026-03-25T14:00:00Z"); day <= new Date("2026-03-31T14:00:00Z"); day = new Date(day.getTime() + 86_400_000)) {
        const report = await runTick({ runtime, organizationId: ORG, now: day.toISOString().replace(".000Z", "Z"), openFacts: openFixturePayroll });
        const bad = report.entries.find((e) => e.outcome === "failed");
        if (bad) throw new Error(`${report.now} fase ${bad.phase} falló: ${bad.detail}`);
        reports.push(report);
      }
      const entries = reports.flatMap((r) => r.entries);
      expect(entries.filter((e) => e.outcome === "failed").length === 0, "ningún tick falló");
      expect(entries.filter((e) => e.outcome === "ran").map((e) => e.phase).sort().join(",") === "alert_early,alert_urgent,execute,prepare", "se ejecutaron las 4 fases de marzo una vez");

      const occurrence = (await runtime.store.getOccurrence(ORG, obligationId, "2026-03-01"))!;
      expect(occurrence.status === "in_approval", "la corrida de marzo quedó con una excepción por resolver");
      const payments = await runtime.store.listPayments(ORG, occurrence.id);
      expect(payments.length === 11 && payments.every((p) => p.amountMinor > 0 && p.currency === "COP"), "11 pagos simulados con importe y moneda");
      const pending = await runtime.store.listRequests(ORG, "pending", 10);
      expect(pending.length === 1, "una solicitud pendiente (bonificación de 1002)");

      const again = await runTick({ runtime, organizationId: ORG, now: "2026-03-31T14:00:00Z", openFacts: openFixturePayroll });
      expect(again.entries.every((e) => e.outcome === "skipped"), "repetir el tick no hace nada (índice único de fases)");
      expect((await runtime.store.listPayments(ORG, occurrence.id)).length === 11, "repetir el tick no duplica pagos");

      // Garantías de la BD: solo inserción
      await tx.$executeRawUnsafe("SAVEPOINT guard");
      let blocked = false;
      try {
        await tx.$executeRawUnsafe(`UPDATE obligation_line_decisions SET comment = 'x' WHERE organization_id = '${ORG}'`);
      } catch {
        blocked = true;
      }
      await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT guard");
      expect(blocked, "el trigger rechaza editar una decisión");

      const actor: PolicyActor = { userId: "usr_smoke", organizationId: ORG, role: "admin", permission: { canApprove: true, approvalLimitMinor: 1_000_000_000, canManagePolicies: true } };
      const resolved = await resolveObligationLine({ runtime, actor, input: { requestId: pending[0]!.id, action: "approve", comment: "Bonificación trimestral por metas." }, now: "2026-03-31T20:00:00Z", policyCurrency: "USD", openFacts: openFixturePayroll });
      expect(resolved.ok && resolved.outcome === "approved", "la aprobación humana se registra");
      expect((await runtime.store.listPayments(ORG, occurrence.id)).length === 12, "la línea aprobada se paga (simulado) una sola vez");
      const final = (await runtime.store.getOccurrence(ORG, obligationId, "2026-03-01"))!;
      expect(final.status === "simulated_executed", "la corrida queda ejecutada (simulada)");
      const confirmations = await runtime.store.confirmations(ORG, obligationId);
      expect((confirmations["buk:employee:1002"]?.amountMinor ?? 0) > 700_000_000, "lo confirmado de 1002 incluye la bonificación aprobada");

      throw new Rollback();
    },
    { maxWait: 20_000, timeout: 280_000 },
  );
} catch (error) {
  if (!(error instanceof Rollback)) {
    console.error(String(error instanceof Error ? error.message : error));
    console.log(checks.join("\n"));
    await db.$disconnect();
    process.exit(1);
  }
}

const after = await db.paymentObligation.count();
const leftover = await db.organization.count({ where: { id: ORG } });
expect(before === after && leftover === 0, "nada quedó guardado: la transacción se revirtió");
console.log(checks.join("\n"));
await db.$disconnect();
