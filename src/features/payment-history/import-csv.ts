/**
 * Purpose: import a fictional bank CSV into bank_transactions and list what the organization already has.
 * Runs in: server (Node).
 * Triggered by: the upload action on /platform/payment-history, and that page for the table.
 * Receives → Returns: (admin actor, file bytes) → a Spanish summary; organizationId → recent movements
 *   and recurrence suggestions. A suggestion never authorizes a payment.
 * Talks to: db — BankImportBatch, BankTransaction, AuditEvent; parse-bank-csv.ts;
 *   supplier association (exact matches only) and the recurrence store.
 */
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { nanoid } from "nanoid";
import { db } from "@/lib/db";
import { checkCanGrantPermissions, type PolicyActor } from "@/features/policies/permissions";
import { parseBankCsv, type ParsedBankRow } from "./parse-bank-csv";
import { getRecurrenceSuggestions } from "./recurrence/recurrence-service";
import { MAX_FILE_BYTES } from "./schemas/csv-fields";
import type { RecurrenceSuggestion } from "./schemas/history-queries";
import { associateTransactions } from "./suppliers/association-service";
import { createPrismaAssociationStore, createPrismaRecurrenceStore } from "./suppliers/prisma-store";

export type ImportOutcome = { ok: true; message: string } | { ok: false; error: string };

const CADENCE_LABEL = { weekly: "semanal", monthly: "mensual", quarterly: "trimestral", yearly: "anual" } as const;

function fingerprint(organizationId: string, row: ParsedBankRow): string {
  return createHash("sha256")
    .update([organizationId, row.postedOn, String(row.amountMinor), row.currency, row.description, row.externalRef ?? ""].join("|"))
    .digest("hex");
}

function fileNameOf(name: string): string {
  const base = name.split(/[/\\]/).pop()?.trim() || "extracto.csv";
  return base.slice(0, 255);
}

function rejectionText(rejected: { rowNumber: number; message: string }[]): string {
  if (rejected.length === 0) return "";
  const sample = rejected
    .slice(0, 5)
    .map((row) => `fila ${row.rowNumber}: ${row.message}`)
    .join("; ");
  const extra = rejected.length > 5 ? ` y ${rejected.length - 5} más` : "";
  return ` ${rejected.length} rechazadas (${sample}${extra}).`;
}

export async function importBankCsv(actor: PolicyActor, file: { name: string; bytes: Uint8Array }): Promise<ImportOutcome> {
  const denial = checkCanGrantPermissions(actor);
  if (denial !== null) return { ok: false, error: denial };
  if (file.bytes.byteLength === 0) return { ok: false, error: "El archivo está vacío." };
  if (file.bytes.byteLength > MAX_FILE_BYTES) return { ok: false, error: "El archivo supera 4 MB." };

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(file.bytes);
  } catch {
    return { ok: false, error: "El archivo debe estar en UTF-8." };
  }

  const parsed = parseBankCsv(text);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  if (parsed.rows.length === 0) {
    return { ok: false, error: `No hay filas válidas.${rejectionText(parsed.rejected)}` };
  }

  const seenFingerprints = new Set<string>();
  const seenRefs = new Set<string>();
  const unique: Array<ParsedBankRow & { fingerprint: string }> = [];
  let repeatedInFile = 0;
  for (const row of parsed.rows) {
    const digest = fingerprint(actor.organizationId, row);
    if (seenFingerprints.has(digest) || (row.externalRef !== null && seenRefs.has(row.externalRef))) {
      repeatedInFile++;
      continue;
    }
    seenFingerprints.add(digest);
    if (row.externalRef !== null) seenRefs.add(row.externalRef);
    unique.push({ ...row, fingerprint: digest });
  }

  const organizationId = actor.organizationId;
  const inserted = await db.$transaction(async (tx) => {
    const existing = await tx.bankTransaction.findMany({
      where: {
        organizationId,
        OR: [
          { fingerprint: { in: unique.map((row) => row.fingerprint) } },
          ...([...seenRefs].length > 0 ? [{ externalRef: { in: [...seenRefs] } }] : []),
        ],
      },
      select: { fingerprint: true, externalRef: true },
    });
    const knownFingerprints = new Set(existing.map((row) => row.fingerprint));
    const knownRefs = new Set(existing.map((row) => row.externalRef).filter((ref): ref is string => ref !== null));
    const fresh = unique.filter(
      (row) => !knownFingerprints.has(row.fingerprint) && (row.externalRef === null || !knownRefs.has(row.externalRef)),
    );
    if (fresh.length === 0) return { batchId: null as string | null, accepted: 0, duplicates: unique.length };

    const batchId = `batch_${nanoid()}`;
    await tx.bankImportBatch.create({
      data: {
        id: batchId,
        organizationId,
        fileName: fileNameOf(file.name),
        rowCount: fresh.length,
        importedBy: actor.userId,
      },
    });
    await tx.bankTransaction.createMany({
      data: fresh.map((row) => ({
        id: `btxn_${nanoid()}`,
        organizationId,
        importBatchId: batchId,
        postedOn: new Date(`${row.postedOn}T00:00:00.000Z`),
        amountMinor: row.amountMinor,
        currency: row.currency,
        description: row.description,
        externalRef: row.externalRef,
        fingerprint: row.fingerprint,
      })),
    });
    await tx.auditEvent.create({
      data: {
        organizationId,
        entityType: "bank_import_batch",
        entityId: batchId,
        eventType: "bank_import.created",
        actorId: actor.userId,
        payload: {
          fileName: fileNameOf(file.name),
          rowsAccepted: fresh.length,
          rowsDuplicate: unique.length - fresh.length + repeatedInFile,
          rowsRejected: parsed.rejected.length,
        } satisfies Prisma.InputJsonValue,
      },
    });
    return { batchId, accepted: fresh.length, duplicates: unique.length - fresh.length };
  }, { timeout: 20_000 });

  if (inserted.batchId === null) {
    return {
      ok: true,
      message: `Nada nuevo: las ${inserted.duplicates + repeatedInFile} filas válidas ya estaban importadas.${rejectionText(parsed.rejected)}`,
    };
  }

  const linked = await linkExactSuppliers(organizationId, inserted.batchId);
  const suggestions = await listRecurrenceSuggestions(organizationId);
  const suggestionText =
    suggestions.length === 0
      ? " Ninguna recurrencia sugerida todavía."
      : ` Recurrencias sugeridas (no autorizan): ${suggestions
          .map((item) => `${item.counterpartyNormalized} · ${CADENCE_LABEL[item.cadence]} · ${item.occurrences}`)
          .join(", ")}.`;

  return {
    ok: true,
    message:
      `Se guardaron ${inserted.accepted} movimientos.` +
      (inserted.duplicates + repeatedInFile > 0 ? ` ${inserted.duplicates + repeatedInFile} repetidos se omitieron.` : "") +
      rejectionText(parsed.rejected) +
      ` Vinculados a un proveedor existente: ${linked}.` +
      suggestionText,
  };
}

async function linkExactSuppliers(organizationId: string, importBatchId: string): Promise<number> {
  const result = await associateTransactions(
    createPrismaAssociationStore(),
    { organizationId, actor: null },
    { importBatchId, autoCreate: false },
  );
  if (!result.ok) return 0;
  return result.report.linked.reduce((total, link) => total + link.count, 0);
}

export async function listImportedMovements(organizationId: string) {
  return db.bankTransaction.findMany({
    where: { organizationId },
    orderBy: [{ postedOn: "desc" }, { id: "desc" }],
    take: 50,
    include: { supplier: { select: { name: true } } },
  });
}

export async function listRecurrenceSuggestions(organizationId: string): Promise<RecurrenceSuggestion[]> {
  const result = await getRecurrenceSuggestions(createPrismaRecurrenceStore(), { organizationId, now: new Date() });
  return result.ok ? result.suggestions : [];
}
