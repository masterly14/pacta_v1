/**
 * Purpose: process one invoice end to end (A-03/A-12): AI extraction → supplier and contract
 *   resolution → persist in `invoices` → B's evaluateInvoice(). Idempotent per document group;
 *   any failure leaves a visible, retryable state and never an approval.
 * Runs in: server (Node).
 * Triggered by: process-email.ts (each invoice candidate of an email) and the manual upload action.
 * Receives → Returns: (ProcessInvoiceInput, { extract }) → ProcessResult.
 * Talks to: db (Invoice), extraction/extract-invoice.ts, ./resolve-identity.ts,
 *   decisions/server#evaluateInvoice.
 */
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { evaluateInvoice } from "@/features/decisions/server";
import { InvoiceContextSchema, type InvoiceContext } from "@/shared/schemas/invoice-context";
import type { PaymentDecision } from "@/shared/schemas/payment-decision";
import { extractInvoice, type ExtractDeps } from "../extraction/extract-invoice";
import type { SourceDocument } from "../extraction/read-document";
import type { ContextMeta, EmailMetadata } from "../extraction/to-invoice-context";
import { resolveIdentity } from "./resolve-identity";

export type ProcessInvoiceInput = {
  invoiceId: string;
  organizationId: string;
  source: "email" | "dashboard";
  documentGroupId: string | null;
  gmailInboundMessageId: string | null;
  primaryDocumentId: string | null;
  documents: SourceDocument[];
  metadata: EmailMetadata;
  meta: Pick<ContextMeta, "sourceAccountId" | "sourceMessageId" | "documentId" | "documentType" | "receivedAt">;
};

export type ProcessResult =
  | { ok: true; invoiceId: string; decision: PaymentDecision }
  | { ok: true; invoiceId: string; skipped: "already_decided" | "in_progress" }
  | { ok: false; invoiceId: string; stage: "extraction" | "decision"; error: string };

const MAX_ERROR_LENGTH = 500;

function toDbDate(calendarDate: string | null): Date | null {
  return calendarDate === null ? null : new Date(`${calendarDate}T00:00:00.000Z`);
}

function errorText(stage: string, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `${stage}: ${message}`.slice(0, MAX_ERROR_LENGTH);
}

// Crea la fila o la reutiliza. Devuelve el contexto ya extraído si solo falta la decisión.
type Claim =
  | { kind: "process"; invoiceId: string }
  | { kind: "evaluate"; invoiceId: string; context: InvoiceContext }
  | { kind: "skip"; invoiceId: string; reason: "already_decided" | "in_progress" };

async function claimInvoice(input: ProcessInvoiceInput): Promise<Claim> {
  const existing = input.documentGroupId === null
    ? await db.invoice.findUnique({ where: { id: input.invoiceId } })
    : await db.invoice.findUnique({ where: { documentGroupId: input.documentGroupId } });

  if (existing === null) {
    try {
      await db.invoice.create({
        data: {
          id: input.invoiceId,
          organizationId: input.organizationId,
          source: input.source,
          documentGroupId: input.documentGroupId,
          gmailInboundMessageId: input.gmailInboundMessageId,
          primaryDocumentId: input.primaryDocumentId,
          extractionStatus: "processing",
          receivedAt: new Date(input.meta.receivedAt),
        },
      });
      return { kind: "process", invoiceId: input.invoiceId };
    } catch (error) {
      // Otro proceso tomó el mismo grupo al mismo tiempo (índice único): no se duplica.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        return { kind: "skip", reason: "in_progress", invoiceId: input.invoiceId };
      }
      throw error;
    }
  }

  if (existing.organizationId !== input.organizationId) {
    throw new Error("La factura pertenece a otra organización");
  }
  if (existing.extractionStatus === "extracted" && existing.contextJson !== null) {
    const decided = await db.paymentDecision.findFirst({ where: { organizationId: existing.organizationId, invoiceId: existing.id }, select: { id: true } });
    if (decided !== null) return { kind: "skip", reason: "already_decided", invoiceId: existing.id };
    return { kind: "evaluate", invoiceId: existing.id, context: InvoiceContextSchema.parse(existing.contextJson) };
  }
  await db.invoice.update({ where: { id: existing.id }, data: { extractionStatus: "processing", extractionError: null } });
  return { kind: "process", invoiceId: existing.id };
}

export async function processInvoice(input: ProcessInvoiceInput, deps: { extract: ExtractDeps }): Promise<ProcessResult> {
  const claim = await claimInvoice(input);
  if (claim.kind === "skip") return { ok: true, invoiceId: claim.invoiceId, skipped: claim.reason };
  const invoiceId = claim.invoiceId;

  let context: InvoiceContext;
  if (claim.kind === "evaluate") {
    context = claim.context;
  } else {
    let extracted;
    try {
      extracted = await extractInvoice(
        {
          documents: input.documents,
          metadata: input.metadata,
          meta: { ...input.meta, invoiceId, organizationId: input.organizationId, source: input.source },
        },
        deps.extract,
      );
    } catch (error) {
      extracted = { ok: false as const, stage: "read" as const, error: error instanceof Error ? error.message : String(error) };
    }
    if (!extracted.ok) {
      const error = errorText(`extraction/${extracted.stage}`, extracted.error);
      await db.invoice.update({ where: { id: invoiceId }, data: { extractionStatus: "failed", extractionError: error } });
      // Sin datos de la factura en el log: solo identificadores y la etapa.
      console.error("[invoices/pipeline] extracción fallida", { invoiceId, stage: extracted.stage });
      return { ok: false, invoiceId, stage: "extraction", error };
    }

    // A-04: el proveedor y el contrato los resuelve código determinístico, no el modelo.
    const identity = await resolveIdentity(input.organizationId, extracted.context);
    context = InvoiceContextSchema.parse({ ...extracted.context, ...identity });

    await db.invoice.update({
      where: { id: invoiceId },
      data: {
        extractionStatus: "extracted",
        extractionError: null,
        supplierId: context.supplierId,
        supplierMatchStatus: context.supplierMatchStatus,
        name: context.name,
        invoiceNumber: context.invoiceNumber,
        amountMinor: context.amountMinor,
        currency: context.currency,
        invoiceDate: toDbDate(context.invoiceDate),
        dueDate: toDbDate(context.dueDate),
        contextJson: context as Prisma.InputJsonValue,
        processedAt: new Date(),
      },
    });
  }

  try {
    const decision = await evaluateInvoice(context);
    return { ok: true, invoiceId, decision };
  } catch (error) {
    // La factura queda `extracted` sin decisión: un reintento solo vuelve a evaluar.
    console.error("[invoices/pipeline] evaluación fallida", { invoiceId, error });
    return { ok: false, invoiceId, stage: "decision", error: errorText("decision", error) };
  }
}
