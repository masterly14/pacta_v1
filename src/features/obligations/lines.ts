/**
 * Purpose: aprobación humana de una línea de nómina que escaló. Una persona autenticada con permiso aprueba o rechaza; la
 *   aprobación NO salta las reglas: se reevalúa con la evidencia vigente y un bloqueo absoluto gana. Lo que la persona
 *   aprueba queda atado a los motivos que vio: un motivo nuevo antes de pagar exige otra aprobación (runner.ts).
 * Runs in: servidor (acción de la bandeja) y pruebas.
 * Receives → Returns: { actor, solicitud, acción, comentario, reloj } → resultado legible, sin lanzar por casos de negocio.
 * Talks to: runner (evaluar, ejecutar), store, policies/permissions (PolicyActor).
 * Seguridad: solo usuarios autenticados con `canApprove`; el límite del aprobador solo se compara en su misma moneda y,
 *   si la moneda es otra, se exige rol de administrador (nunca se convierte moneda).
 */
import { z } from "zod";
import type { PolicyActor } from "@/features/policies/permissions";
import { evaluateOccurrence, executeOccurrence, type LearnedProvider, type PayrollFactsOpener, type RunDeps } from "./runner";
import type { ScheduledDue } from "./schedule/dates";
import type { ObligationStore, StoreRuntime } from "./store";

export const ResolveLineInputSchema = z.strictObject({
  requestId: z.string().trim().min(1).max(200),
  action: z.enum(["approve", "reject"]),
  comment: z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? null : v), z.string().trim().max(1000).nullable()),
});
export type ResolveLineInput = z.infer<typeof ResolveLineInputSchema>;

export type ResolveLineResult = { ok: true; outcome: "approved" | "rejected" | "blocked_on_revalidation"; message: string } | { ok: false; error: string };

export type ResolveLineContext = {
  runtime: StoreRuntime;
  actor: PolicyActor;
  input: ResolveLineInput;
  /** Instante lógico (reloj de demo o del sistema). */
  now: string;
  /** Moneda de la política de pagos de la organización: en ella se interpreta `approvalLimitMinor`. */
  policyCurrency: string | null;
  openFacts: PayrollFactsOpener;
  learned?: LearnedProvider;
};

const deny = (error: string): ResolveLineResult => ({ ok: false, error });

export async function resolveObligationLine(ctx: ResolveLineContext): Promise<ResolveLineResult> {
  const { actor } = ctx;
  const parsed = ResolveLineInputSchema.safeParse(ctx.input);
  if (!parsed.success) return deny("La resolución no es válida.");
  const input = parsed.data;
  if (!actor.permission?.canApprove) return deny("Necesitas permiso de aprobación para resolver pagos.");

  try {
    return await ctx.runtime.transaction(actor.organizationId, async (store) => {
      const request = await store.getRequest(actor.organizationId, input.requestId);
      if (!request || request.status !== "pending") return deny("La solicitud no existe o ya fue resuelta.");
      const decision = await store.getDecision(actor.organizationId, request.decisionId);
      const occurrence = await store.getOccurrenceById(actor.organizationId, request.occurrenceId);
      if (!decision || !occurrence) return deny("No se encontró la decisión que escaló.");
      const obligation = await store.getObligation(actor.organizationId, occurrence.obligationId, occurrence.obligationVersion);
      if (!obligation) return deny("No se encontró la plantilla de la obligación.");

      // Límite del aprobador: solo comparable en la moneda de la política; si es otra, se exige un administrador.
      let limitNote: string | null = null;
      if (input.action === "approve") {
        if (decision.amountMinor === null || decision.currency === null) return deny("La línea no tiene importe ni moneda: una persona no puede aprobar un dato desconocido.");
        if (ctx.policyCurrency !== null && decision.currency === ctx.policyCurrency) {
          const limit = actor.permission?.approvalLimitMinor ?? null;
          if (limit === null) return deny("Tu permiso de aprobación no tiene un límite definido.");
          if (decision.amountMinor > limit) return deny("El monto de la línea supera tu límite de aprobación.");
        } else if (actor.role !== "admin") {
          return deny(`El límite de aprobación no es comparable con ${decision.currency}: solo un administrador aprueba pagos en otra moneda.`);
        } else {
          limitNote = "limit_not_comparable_admin";
        }
      }

      const due: ScheduledDue = { periodStart: occurrence.periodStart, periodEnd: occurrence.periodEnd, nominalDueDate: occurrence.dueDate, dueDate: occurrence.dueDate };
      const deps: RunDeps = { store, openFacts: ctx.openFacts, learned: ctx.learned };

      const record = async (kind: "approved" | "blocked", reasonCodes: string[], rules: typeof decision.rules, comment: string | null, evidenceSha: string) => {
        await store.insertDecision({
          organizationId: actor.organizationId,
          occurrenceId: occurrence.id,
          lineId: decision.lineId,
          counterpartyRef: decision.counterpartyRef,
          displayName: decision.displayName,
          lineType: decision.lineType,
          amountMinor: decision.amountMinor,
          currency: decision.currency,
          decision: kind,
          decisionSource: "human",
          reasonCodes,
          rules,
          decisionKey: `human:${request.id}`,
          evidenceSha,
          actorId: actor.userId,
          comment,
          evaluatedAt: ctx.now,
        });
      };

      if (input.action === "reject") {
        await record("blocked", decision.reasonCodes, decision.rules, input.comment, decision.evidenceSha);
        await store.resolveRequest(actor.organizationId, request.id, { status: "rejected", by: actor.userId, comment: input.comment, at: ctx.now });
        await store.audit({ organizationId: actor.organizationId, entityType: "obligation_line", entityId: decision.lineId, eventType: "obligation_line.rejected", actorId: actor.userId, payload: { requestId: request.id, occurrenceId: occurrence.id, comment: input.comment } });
        return { ok: true, outcome: "rejected", message: "Línea rechazada: no se pagará." } as ResolveLineResult;
      }

      // Aprobar = reevaluar con la evidencia de ahora. Un bloqueo absoluto prevalece sobre la aprobación humana.
      const evaluation = await evaluateOccurrence(deps, obligation, due, ctx.now);
      const fresh = evaluation.result.lines.find((line) => line.lineId === decision.lineId);
      if (!fresh) return deny("La línea ya no existe en la evaluación vigente.");
      if (fresh.decision === "blocked") {
        await record("blocked", fresh.reasonCodes, fresh.rules, `Bloqueada al revalidar: ${fresh.reasonCodes.join(", ")}.${input.comment ? ` Comentario: ${input.comment}` : ""}`, evaluation.evidenceShaByLine.get(fresh.lineId)!);
        await store.resolveRequest(actor.organizationId, request.id, { status: "rejected", by: actor.userId, comment: input.comment, at: ctx.now });
        await store.audit({ organizationId: actor.organizationId, entityType: "obligation_line", entityId: decision.lineId, eventType: "obligation_line.blocked_on_revalidation", actorId: actor.userId, payload: { requestId: request.id, reasonCodes: fresh.reasonCodes } });
        return { ok: true, outcome: "blocked_on_revalidation", message: "Al revalidar, la línea quedó bloqueada y no se puede aprobar." };
      }
      await record("approved", fresh.reasonCodes, fresh.rules, input.comment, evaluation.evidenceShaByLine.get(fresh.lineId)!);
      await store.resolveRequest(actor.organizationId, request.id, { status: "approved", by: actor.userId, comment: input.comment, at: ctx.now });
      await store.audit({
        organizationId: actor.organizationId,
        entityType: "obligation_line",
        entityId: decision.lineId,
        eventType: "obligation_line.approved",
        actorId: actor.userId,
        payload: { requestId: request.id, occurrenceId: occurrence.id, reasonCodes: fresh.reasonCodes, comment: input.comment, limitNote },
      });

      // Si el pago de la corrida ya venció, esta línea se paga (en simulación) ahora; si no, lo hace la fase `execute`.
      const claims = await store.listPhaseClaims(actor.organizationId, obligation.obligationId);
      const executeClaimed = claims.some((claim) => claim.periodStart === occurrence.periodStart && claim.phase === "execute");
      if (executeClaimed) await executeOccurrence(deps, obligation, due, ctx.now);
      return { ok: true, outcome: "approved", message: executeClaimed ? "Línea aprobada y registrada como pago simulado." : "Línea aprobada: se paga (en simulación) el día del vencimiento." };
    });
  } catch (error) {
    // Fail-closed: ante cualquier error la transacción revierte y no se aprueba nada.
    return deny(error instanceof Error ? `No se pudo resolver: ${error.message}` : "No se pudo resolver la solicitud.");
  }
}

export type { ObligationStore };
