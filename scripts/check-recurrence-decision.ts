/**
 * Comprueba la conexión historial → decisión contra la base de desarrollo y revierte todo.
 * Inserta un lote y movimientos ficticios, llama a loadEngineFacts + decide, y hace rollback.
 *
 *   node --env-file=.env.local ./node_modules/vite-node/vite-node.mjs --config vitest.config.ts scripts/check-recurrence-decision.ts
 */
import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { decide } from "@/features/decisions/engine/decide";
import { loadEngineFacts } from "@/features/decisions/load-facts";
import { InvoiceContextSchema, type InvoiceContext } from "@/shared/schemas/invoice-context";

const ROLLBACK = "ROLLBACK_CHECK";

function fingerprint(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function invoice(organizationId: string, supplierId: string): InvoiceContext {
  return InvoiceContextSchema.parse({
    schemaVersion: 1,
    invoiceId: "inv_recur_check",
    organizationId,
    invoiceNumber: "DEMO-REC-1",
    source: "dashboard",
    sourceAccountId: null,
    sourceMessageId: null,
    documentId: null,
    documentType: "manual_entry",
    receivedAt: "2026-10-17T12:00:00Z",
    supplierId,
    name: "Nube Hosting Demo",
    email: "facturas@nube-hosting-demo.test",
    subject: "Factura de hosting",
    body: "Factura ficticia para probar la recurrencia.",
    supplierMatchStatus: "matched",
    beneficiaryAccountReference: "****1234",
    amountMinor: 2000,
    currency: "USD",
    description: "Hosting mensual",
    invoiceDate: "2026-10-05",
    dueDate: "2026-10-20",
    contractMatch: null,
    missingFields: [],
    extractionWarnings: [],
    evidence: [],
  });
}

async function main() {
  const org = await db.organization.findFirst({ select: { id: true }, orderBy: { createdAt: "asc" } });
  if (!org) throw new Error("No hay organización en la base");
  const organizationId = org.id;

  const supplierId = "sup_recur_check";
  const batchId = "batch_recur_check";
  const now = new Date("2026-10-17T12:00:00Z");
  const context = invoice(organizationId, supplierId);

  const report: Record<string, unknown> = {};

  try {
    await db.$transaction(
      async (tx) => {
      await tx.supplier.create({
        data: {
          id: supplierId,
          organizationId,
          name: "Nube Hosting Demo",
          normalizedName: "nube hosting demo recur check",
        },
      });
      await tx.bankImportBatch.create({
        data: {
          id: batchId,
          organizationId,
          fileName: "demo-recurrence.csv",
          rowCount: 3,
          importedBy: "recur-check",
        },
      });

      async function seed(label: string, dates: string[]) {
        await tx.bankTransaction.deleteMany({ where: { importBatchId: batchId } });
        await tx.bankTransaction.createMany({
          data: dates.map((postedOn, index) => ({
            id: `btxn_recur_${label}_${index}`,
            organizationId,
            importBatchId: batchId,
            supplierId,
            postedOn: new Date(`${postedOn}T00:00:00.000Z`),
            amountMinor: -2000,
            currency: "USD",
            description: "PAGO HOSTING DEMO",
            externalRef: `demo-recur-${label}-${index}`,
            fingerprint: fingerprint(`${label}|${postedOn}|${index}`),
          })),
        });

        const facts = await loadEngineFacts(tx, context, { now, decisionId: `dec_${label}` });
        const decision = decide(context, facts);
        report[label] = {
          recurrenceSuggested: facts.recurrenceSuggested,
          decision: decision.decision,
          reasonCodes: decision.reasonCodes,
        };
      }

      await seed("monthly", ["2026-01-15", "2026-02-14", "2026-03-16"]);
      await seed("irregular", ["2026-01-01", "2026-01-05", "2026-06-01"]);

      const monthly = report.monthly as { recurrenceSuggested: boolean; decision: string; reasonCodes: string[] };
      const irregular = report.irregular as { recurrenceSuggested: boolean; decision: string; reasonCodes: string[] };
      if (!monthly.recurrenceSuggested || !monthly.reasonCodes.includes("RECURRENCE_NOT_AUTHORIZED")) {
        throw new Error(`Mensual no escaló por recurrencia: ${JSON.stringify(report.monthly)}`);
      }
      if (irregular.recurrenceSuggested || irregular.reasonCodes.includes("RECURRENCE_NOT_AUTHORIZED")) {
        throw new Error(`Irregular se tomó como recurrencia: ${JSON.stringify(report.irregular)}`);
      }
      if (!irregular.reasonCodes.includes("SUPPLIER_NOT_AUTHORIZED")) {
        throw new Error(`Irregular no escaló por falta de autorización: ${JSON.stringify(report.irregular)}`);
      }
      if (monthly.decision === "approved" || irregular.decision === "approved") {
        throw new Error("El historial no puede aprobar");
      }

      throw new Error(ROLLBACK);
    },
      { timeout: 20_000 },
    );
  } catch (error) {
    if (!(error instanceof Error) || error.message !== ROLLBACK) throw error;
  }

  const [movements, supplier] = await Promise.all([
    db.bankTransaction.count({ where: { importBatchId: batchId } }),
    db.supplier.count({ where: { id: supplierId } }),
  ]);
  if (movements !== 0 || supplier !== 0) {
    throw new Error(`El rollback no limpió la base (movimientos=${movements}, proveedor=${supplier})`);
  }

  console.log(JSON.stringify({ organizationId: org.id, rolledBack: true, report }, null, 2));
  await db.$disconnect();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
