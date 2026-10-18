/**
 * Purpose: resolve an approval request as a person: re-evaluate the invoice against today's
 *   policy and budget, record a new human decision (hard blocks still win), close the request
 *   and optionally create a recurring authorization for future invoices.
 * Runs in: server (Node) only.
 * Triggered by: actions.ts (Approve / Reject on /platform/approvals).
 * Receives → Returns: (PolicyActor, ResolveApprovalInput) → { ok, message } | { ok: false, error }.
 * Talks to: db — Organization (row lock), ApprovalRequest, PaymentDecision, PaymentAuthorization,
 *   AuditEvent; decisions (load-facts, engine/decide); policies/permissions#checkCanAuthorize.
 */
import { randomUUID } from "node:crypto";
import { Prisma, type PaymentDecision as PaymentDecisionRow } from "@prisma/client";
import { db } from "@/lib/db";
import { decide } from "@/features/decisions/engine/decide";
import { loadEngineFacts } from "@/features/decisions/load-facts";
import { notifyDecision } from "@/features/notifications/dispatch";
import { checkCanAuthorize, type PolicyActor } from "@/features/policies/permissions";
import { InvoiceContextSchema } from "@/shared/schemas/invoice-context";
import {
  PaymentDecisionSchema,
  type DecisionEvidenceReference,
  type PaymentDecision,
  type ReasonCode,
  type RuleEvaluation,
} from "@/shared/schemas/payment-decision";
import type { ResolveApprovalInput } from "./schemas";

export type ResolveResult = { ok: true; message: string } | { ok: false; error: string };

type Tx = Prisma.TransactionClient;

const TRANSACTION_OPTIONS = { maxWait: 10_000, timeout: 20_000 } as const;

function denied(error: string): ResolveResult {
  return { ok: false, error };
}

function toDbDate(calendarDate: string): Date {
  return new Date(`${calendarDate}T00:00:00.000Z`);
}

function withComment(text: string, comment: string | null): string {
  return comment === null ? text : `${text} Comentario: ${comment}`;
}

// Motivos que explican la intervención humana (sin el código exclusivo de aprobación automática).
function humanReasonCodes(rules: readonly RuleEvaluation[], fallback: readonly ReasonCode[]): ReasonCode[] {
  const codes = new Set<ReasonCode>();
  for (const rule of rules) if (rule.result !== "cumple" && rule.reasonCode !== null) codes.add(rule.reasonCode);
  for (const code of fallback) if (code !== "REGLAS_AUTOAPROBACION_CUMPLIDAS") codes.add(code);
  codes.add("REQUIERE_APROBACION_HUMANA");
  return [...codes];
}

function humanDecision(fields: {
  decisionId: string;
  trigger: PaymentDecisionRow;
  decision: "aprobada" | "bloqueada";
  policyVersion: number | null;
  reasonCodes: ReasonCode[];
  explanation: string;
  rulesEvaluated: RuleEvaluation[];
  matchedPolicyIds: string[];
  evidenceReferences: DecisionEvidenceReference[];
  approvalRequestId: string;
  actorId: string;
  now: Date;
}): PaymentDecision {
  return PaymentDecisionSchema.parse({
    schemaVersion: 1,
    decisionId: fields.decisionId,
    invoiceId: fields.trigger.invoiceId,
    organizationId: fields.trigger.organizationId,
    evaluatedAt: fields.now.toISOString().replace(/\.\d{3}Z$/, "Z"),
    policyVersion: fields.policyVersion,
    decision: fields.decision,
    reasonCodes: fields.reasonCodes,
    explanation: fields.explanation,
    rulesEvaluated: fields.rulesEvaluated,
    matchedPolicyIds: fields.matchedPolicyIds,
    evidenceReferences: [...fields.evidenceReferences, { type: "approval_request", id: fields.approvalRequestId, description: null }],
    traceId: null,
    approvalRequestId: fields.approvalRequestId,
    approvedBy: fields.actorId,
    decisionSource: "humana",
    isSimulated: true,
  });
}

// Nueva fila de decisión (solo inserción) con los datos de la factura de la decisión que escaló.
function insertHumanDecision(tx: Tx, trigger: PaymentDecisionRow, decision: PaymentDecision, authorizationId: string | null) {
  return tx.paymentDecision.create({
    data: {
      id: decision.decisionId,
      organizationId: trigger.organizationId,
      invoiceId: trigger.invoiceId,
      supplierId: trigger.supplierId,
      invoiceNumber: trigger.invoiceNumber,
      amountMinor: trigger.amountMinor,
      currency: trigger.currency,
      invoiceDate: trigger.invoiceDate,
      decision: decision.decision,
      decisionSource: "humana",
      reasonCodes: decision.reasonCodes,
      rulesEvaluated: decision.rulesEvaluated as Prisma.InputJsonValue,
      payload: decision as Prisma.InputJsonValue,
      policyVersion: decision.policyVersion,
      actorId: decision.approvedBy,
      approvalRequestId: decision.approvalRequestId,
      authorizationId,
      invoiceContext: trigger.invoiceContext ?? Prisma.DbNull,
      evaluatedAt: new Date(decision.evaluatedAt),
    },
  });
}

function audit(tx: Tx, actor: PolicyActor, entityType: string, entityId: string, eventType: string, payload: Prisma.InputJsonValue) {
  return tx.auditEvent.create({
    data: { organizationId: actor.organizationId, entityType, entityId, eventType, actorId: actor.userId, payload },
  });
}

export async function resolveApprovalRequest(actor: PolicyActor, input: ResolveApprovalInput): Promise<ResolveResult> {
  const permission = actor.permission;
  if (permission === null || !permission.canApprove || permission.approvalLimitMinor === null) {
    return denied("Necesitas permiso de aprobación para resolver solicitudes.");
  }
  if (input.authorization !== null) {
    const denial = checkCanAuthorize(actor, input.authorization.maxAmountMinor);
    if (denial !== null) return denied(denial);
  }
  const approvalLimitMinor = permission.approvalLimitMinor;

  try {
    const result = await db.$transaction(async (tx): Promise<ResolveResult> => {
      await tx.$queryRaw`SELECT id FROM organizations WHERE id = ${actor.organizationId} FOR UPDATE`;

      const request = await tx.approvalRequest.findFirst({
        where: { id: input.approvalRequestId, organizationId: actor.organizationId },
        include: { decision: true },
      });
      if (request === null) return denied("Solicitud no encontrada.");
      if (request.status !== "pendiente") return denied("Esta solicitud ya fue resuelta.");
      const trigger = request.decision;
      const triggerPayload = PaymentDecisionSchema.parse(trigger.payload);
      const now = new Date();
      const decisionId = randomUUID();

      // Rechazar: no hace falta revalidar; queda bloqueada por decisión humana.
      if (input.action === "reject") {
        const decision = humanDecision({
          decisionId,
          trigger,
          decision: "bloqueada",
          policyVersion: trigger.policyVersion,
          reasonCodes: humanReasonCodes(triggerPayload.rulesEvaluated, triggerPayload.reasonCodes),
          explanation: withComment("Rechazada por una persona.", input.comment),
          rulesEvaluated: triggerPayload.rulesEvaluated,
          matchedPolicyIds: triggerPayload.matchedPolicyIds,
          evidenceReferences: triggerPayload.evidenceReferences,
          approvalRequestId: request.id,
          actorId: actor.userId,
          now,
        });
        await insertHumanDecision(tx, trigger, decision, null);
        await tx.approvalRequest.update({
          where: { id: request.id },
          data: { status: "rechazada", resolvedAt: now, resolvedBy: actor.userId, comment: input.comment },
        });
        await audit(tx, actor, "approval_request", request.id, "solicitud_aprobacion.rechazada", { decisionId, comment: input.comment });
        return { ok: true, message: "Factura rechazada." };
      }

      // Aprobar: siempre se revalida con la política, autorizaciones y presupuesto de hoy.
      const parsedContext = InvoiceContextSchema.safeParse(trigger.invoiceContext);
      if (!parsedContext.success) {
        return denied("Esta solicitud no guarda los datos de la factura: vuelve a evaluarla para poder aprobarla.");
      }
      const invoice = parsedContext.data;
      if (invoice.amountMinor === null || invoice.currency === null) {
        return denied("No se puede aprobar una factura sin monto o moneda.");
      }
      if (invoice.amountMinor > approvalLimitMinor) {
        return denied("El monto supera tu límite de aprobación.");
      }

      const facts = await loadEngineFacts(tx, invoice, { now, decisionId });
      if (facts.policy === null) return denied("No hay una política vigente: no se puede aprobar.");
      if (invoice.currency !== facts.policy.currency) {
        return denied(`No se puede aprobar en ${invoice.currency}: el presupuesto está en ${facts.policy.currency} y no hay tasa de cambio verificada.`);
      }

      // La autorización nueva debe cubrir esta factura; si no, no se crea nada.
      const auth = input.authorization;
      if (auth !== null) {
        const coverDate = invoice.invoiceDate ?? now.toISOString().slice(0, 10);
        if (invoice.supplierId === null) return denied("No se puede autorizar un proveedor sin confirmar.");
        if (auth.beneficiaryAccountRef !== invoice.beneficiaryAccountReference) {
          return denied("La cuenta de la autorización debe ser la de esta factura.");
        }
        if (invoice.amountMinor > auth.maxAmountMinor) return denied("El monto máximo de la autorización no cubre esta factura.");
        if (coverDate < auth.validFrom || coverDate > auth.validUntil) {
          return denied("La vigencia de la autorización debe incluir la fecha de esta factura.");
        }
      }

      const engine = decide(invoice, facts);

      // Un bloqueo absoluto (duplicado, sin presupuesto) gana incluso a la aprobación humana.
      if (engine.decision === "bloqueada") {
        const decision = humanDecision({
          decisionId,
          trigger,
          decision: "bloqueada",
          policyVersion: engine.policyVersion,
          reasonCodes: humanReasonCodes(engine.rulesEvaluated, engine.reasonCodes),
          explanation: withComment(`Aprobación rechazada al revalidar: ${engine.explanation}`, input.comment),
          rulesEvaluated: engine.rulesEvaluated,
          matchedPolicyIds: engine.matchedPolicyIds,
          evidenceReferences: engine.evidenceReferences,
          approvalRequestId: request.id,
          actorId: actor.userId,
          now,
        });
        await insertHumanDecision(tx, trigger, decision, null);
        await tx.approvalRequest.update({
          where: { id: request.id },
          data: { status: "rechazada", resolvedAt: now, resolvedBy: actor.userId, comment: input.comment },
        });
        await audit(tx, actor, "approval_request", request.id, "solicitud_aprobacion.bloqueada_en_revalidacion", { decisionId, reasonCodes: engine.reasonCodes });
        // La solicitud sí se resolvió (como bloqueada): resultado completado, no error de entrada.
        const reasons = engine.reasonCodes.filter((c) => c !== "REQUIERE_APROBACION_HUMANA").join(", ");
        return { ok: true, message: `🔴 No se aprobó: al revalidar, la factura quedó bloqueada (${reasons}).` };
      }

      let authorizationId: string | null = null;
      if (auth !== null && invoice.supplierId !== null) {
        const created = await tx.paymentAuthorization.create({
          data: {
            organizationId: actor.organizationId,
            supplierId: invoice.supplierId,
            beneficiaryAccountRef: auth.beneficiaryAccountRef,
            currency: facts.policy.currency,
            maxAmountMinor: auth.maxAmountMinor,
            scope: "recurring",
            frequency: auth.frequency,
            validFrom: toDbDate(auth.validFrom),
            validUntil: toDbDate(auth.validUntil),
            authorizedBy: actor.userId,
            sourceApprovalRequestId: request.id,
          },
        });
        authorizationId = created.id;
        await audit(tx, actor, "payment_authorization", created.id, "payment_authorization.created", {
          supplierId: invoice.supplierId,
          beneficiaryAccountRef: auth.beneficiaryAccountRef,
          maxAmountMinor: auth.maxAmountMinor,
          frequency: auth.frequency,
          validFrom: auth.validFrom,
          validUntil: auth.validUntil,
          sourceApprovalRequestId: request.id,
        });
      }

      const decision = humanDecision({
        decisionId,
        trigger,
        decision: "aprobada",
        policyVersion: engine.policyVersion,
        reasonCodes: humanReasonCodes(engine.rulesEvaluated, []),
        explanation: withComment("Aprobada por una persona tras revalidar las reglas vigentes. Pago simulado.", input.comment),
        rulesEvaluated: engine.rulesEvaluated,
        matchedPolicyIds: engine.matchedPolicyIds,
        evidenceReferences: engine.evidenceReferences,
        approvalRequestId: request.id,
        actorId: actor.userId,
        now,
      });
      // Si se creó una autorización, esta aprobación consume su periodo actual.
      await insertHumanDecision(tx, trigger, decision, authorizationId);
      await tx.approvalRequest.update({
        where: { id: request.id },
        data: { status: "aprobada", resolvedAt: now, resolvedBy: actor.userId, comment: input.comment },
      });
      await audit(tx, actor, "approval_request", request.id, "solicitud_aprobacion.aprobada", { decisionId, authorizationId, comment: input.comment });
      return {
        ok: true,
        message: authorizationId === null ? "Factura aprobada (pago simulado)." : "Factura aprobada y autorización recurrente creada.",
      };
    }, TRANSACTION_OPTIONS);

    // Tras el commit: avisar de la decisión humana por los canales configurados (best-effort, nunca altera el resultado).
    if (result.ok) {
      const resolution = await db.paymentDecision.findFirst({
        where: { organizationId: actor.organizationId, approvalRequestId: input.approvalRequestId },
        orderBy: { evaluatedAt: "desc" },
        select: { id: true },
      });
      if (resolution !== null) await notifyDecision(resolution.id);
    }
    return result;
  } catch (error) {
    // Índice único parcial: la factura ya tiene una aprobación (no se aprueba dos veces).
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return denied("Esta factura ya está aprobada.");
    }
    throw error;
  }
}
