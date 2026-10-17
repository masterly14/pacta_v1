/**
 * Purpose: evaluate an invoice end to end (load facts → deterministic engine → persist the
 *   decision, its approval request and audit event) and read decisions for the dashboard.
 * Runs in: server (Node) only.
 * Triggered by: A's invoice pipeline (once it exists) and, for now, the fixture simulator
 *   action; the /platform/audit and /platform/approvals pages for reads.
 * Receives → Returns: evaluateInvoice(InvoiceContext) → PaymentDecision (throws on invalid
 *   input or database errors; never approves by default); list* (organizationId) → rows.
 * Talks to: db (src/lib/db.ts) — Organization (row lock), PaymentDecision, ApprovalRequest,
 *   AuditEvent; ./load-facts.ts; ./engine/decide.ts. No AI.
 */
import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { InvoiceContextSchema } from "@/shared/schemas/invoice-context";
import { PaymentDecisionSchema, type PaymentDecision } from "@/shared/schemas/payment-decision";
import { decide } from "./engine/decide";
import { loadEngineFacts } from "./load-facts";

// Neon responde por red: margen para las consultas secuenciales y la espera del bloqueo.
const TRANSACTION_OPTIONS = { maxWait: 10_000, timeout: 20_000 } as const;

function toDbDate(calendarDate: string): Date {
  return new Date(`${calendarDate}T00:00:00.000Z`);
}

// La autorización que cubrió una aprobación es la evidencia de la regla de límite.
function coveringAuthorizationId(decision: PaymentDecision): string | null {
  if (decision.decision !== "approved") return null;
  const rule = decision.rulesEvaluated.find((r) => r.ruleId === "within_authorization_limit");
  return rule?.evidenceReferences.find((e) => e.type === "payment_authorization")?.id ?? null;
}

/**
 * Evalúa una factura y guarda el resultado. Idempotente: una factura ya aprobada devuelve
 * esa decisión sin crear otra. Las decisiones de una organización se serializan con un
 * bloqueo de fila, así dos facturas no consumen el mismo presupuesto.
 */
export async function evaluateInvoice(input: unknown): Promise<PaymentDecision> {
  const invoice = InvoiceContextSchema.parse(input);
  const organizationId = invoice.organizationId;

  return db.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM organizations WHERE id = ${organizationId} FOR UPDATE`;
    if (locked.length === 0) {
      throw new Error(`Organización ${organizationId} no existe`);
    }

    const alreadyApproved = await tx.paymentDecision.findFirst({
      where: { organizationId, invoiceId: invoice.invoiceId, decision: "approved" },
      select: { payload: true },
    });
    if (alreadyApproved !== null) {
      return PaymentDecisionSchema.parse(alreadyApproved.payload);
    }

    const facts = await loadEngineFacts(tx, invoice, { now: new Date(), decisionId: randomUUID() });
    const decision = decide(invoice, facts);

    await tx.paymentDecision.create({
      data: {
        id: decision.decisionId,
        organizationId,
        invoiceId: invoice.invoiceId,
        supplierId: invoice.supplierId,
        invoiceNumber: invoice.invoiceNumber,
        amountMinor: invoice.amountMinor,
        currency: invoice.currency,
        invoiceDate: invoice.invoiceDate === null ? null : toDbDate(invoice.invoiceDate),
        decision: decision.decision,
        decisionSource: "automatic",
        reasonCodes: decision.reasonCodes,
        rulesEvaluated: decision.rulesEvaluated as Prisma.InputJsonValue,
        payload: decision as Prisma.InputJsonValue,
        policyVersion: decision.policyVersion,
        authorizationId: coveringAuthorizationId(decision),
        invoiceContext: invoice as Prisma.InputJsonValue,
        evaluatedAt: new Date(decision.evaluatedAt),
      },
    });

    const pending = await tx.approvalRequest.findFirst({
      where: { organizationId, invoiceId: invoice.invoiceId, status: "pending" },
      select: { id: true },
    });
    if (decision.decision === "requires_approval" && pending === null) {
      await tx.approvalRequest.create({
        data: { organizationId, invoiceId: invoice.invoiceId, decisionId: decision.decisionId },
      });
    }
    // Una reevaluación que ya no necesita persona (aprobada o bloqueada) cierra la solicitud.
    if (decision.decision !== "requires_approval" && pending !== null) {
      await tx.approvalRequest.update({ where: { id: pending.id }, data: { status: "cancelled", resolvedAt: new Date() } });
    }

    await tx.auditEvent.create({
      data: {
        organizationId,
        entityType: "payment_decision",
        entityId: decision.decisionId,
        eventType: "payment_decision.created",
        actorId: null,
        payload: {
          invoiceId: invoice.invoiceId,
          decision: decision.decision,
          reasonCodes: decision.reasonCodes,
          policyVersion: decision.policyVersion,
        },
      },
    });

    return decision;
  }, TRANSACTION_OPTIONS);
}

// ---------------------------------------------------------------------------
// Lecturas para el dashboard
// ---------------------------------------------------------------------------

export async function listRecentDecisions(organizationId: string, take = 50) {
  const rows = await db.paymentDecision.findMany({
    where: { organizationId },
    orderBy: { evaluatedAt: "desc" },
    take,
    include: { supplier: { select: { name: true } } },
  });
  return rows.map((row) => {
    const payload = PaymentDecisionSchema.parse(row.payload);
    return {
      decisionId: row.id,
      invoiceId: row.invoiceId,
      invoiceNumber: row.invoiceNumber,
      supplierName: row.supplier?.name ?? null,
      amountMinor: row.amountMinor,
      currency: row.currency,
      decision: row.decision,
      decisionSource: row.decisionSource,
      policyVersion: row.policyVersion,
      evaluatedAt: row.evaluatedAt.toISOString(),
      reasonCodes: payload.reasonCodes,
      explanation: payload.explanation,
      rulesEvaluated: payload.rulesEvaluated,
    };
  });
}

export async function listPendingApprovals(organizationId: string) {
  const rows = await db.approvalRequest.findMany({
    where: { organizationId, status: "pending" },
    orderBy: { requestedAt: "asc" },
    include: { decision: { include: { supplier: { select: { name: true } } } } },
  });
  return rows.map((row) => {
    const payload = PaymentDecisionSchema.parse(row.decision.payload);
    // Solicitudes anteriores a guardar el contexto no se pueden revalidar al aprobar.
    const context = row.decision.invoiceContext === null ? null : InvoiceContextSchema.safeParse(row.decision.invoiceContext);
    const invoice = context?.success ? context.data : null;
    return {
      approvalRequestId: row.id,
      invoiceId: row.invoiceId,
      invoiceNumber: row.decision.invoiceNumber,
      supplierName: row.decision.supplier?.name ?? null,
      amountMinor: row.decision.amountMinor,
      currency: row.decision.currency,
      requestedAt: row.requestedAt.toISOString(),
      reasonCodes: payload.reasonCodes,
      explanation: payload.explanation,
      hasInvoiceContext: invoice !== null,
      beneficiaryAccountReference: invoice?.beneficiaryAccountReference ?? null,
      invoiceDate: invoice?.invoiceDate ?? null,
    };
  });
}

// Opciones para el formulario "Factura de prueba".
export async function listSupplierOptions(organizationId: string) {
  return db.supplier.findMany({ where: { organizationId }, orderBy: { name: "asc" }, select: { id: true, name: true } });
}

export type RecentDecision = Awaited<ReturnType<typeof listRecentDecisions>>[number];
export type PendingApproval = Awaited<ReturnType<typeof listPendingApprovals>>[number];
