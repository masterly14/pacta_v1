/**
 * Purpose: fictitious invoice scenarios for the decision simulator, built as InvoiceContext
 *   (the exact contract A's pipeline will send) against the organization's demo suppliers.
 * Runs in: server (Node).
 * Triggered by: ../actions.ts#simulateInvoiceAction until A's real invoices exist.
 * Receives → Returns: (scenario id, organizationId) → InvoiceContext | an error message.
 * Talks to: db (Supplier, PaymentDecision read only), contracts/server.ts#findContractMatch, ./scenarios.ts.
 */
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { findContractMatch } from "@/features/contracts/server";
import { InvoiceContextSchema, type InvoiceContext } from "@/shared/schemas/invoice-context";
import type { DemoScenarioId } from "./scenarios";

const SUPPLIERS = { papeleria: "papeleria central", nube: "nube hosting llc", diseno: "diseno studio" } as const;

type Base = {
  supplier: keyof typeof SUPPLIERS;
  invoiceNumber: string | null;
  amountMinor: number | null;
  currency: string | null;
  beneficiaryAccountReference: string;
  description: string;
  warnings?: InvoiceContext["extractionWarnings"];
  // Fechada el mes siguiente, cuando la autorización mensual aún no se usó: así el escenario
  // muestra su propio motivo y no "autorización ya usada este mes".
  nextMonth?: boolean;
};

function monthStamp(today: string) {
  return today.slice(0, 7).replace("-", "");
}

function firstOfNextMonth(today: string): string {
  const d = new Date(`${today}T00:00:00.000Z`);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toISOString().slice(0, 10);
}

// Número de factura único por clic, salvo el escenario de duplicado (reutiliza el último).
// Cada escenario usa un monto propio: dos facturas del mismo proveedor, monto y fecha con
// distinto número son un duplicado sospechoso y ocultarían el motivo que se quiere mostrar.
async function scenarioBase(scenario: DemoScenarioId, organizationId: string, today: string): Promise<Base | string> {
  const unique = randomUUID().slice(0, 6).toUpperCase();
  switch (scenario) {
    case "papeleria_ok":
      return { supplier: "papeleria", invoiceNumber: `PC-${monthStamp(today)}-${unique}`, amountMinor: 4590, currency: "USD", beneficiaryAccountReference: "****4821", description: "Papelería de oficina (demo)" };
    case "papeleria_second_this_month":
      return { supplier: "papeleria", invoiceNumber: `PC-${monthStamp(today)}-${unique}`, amountMinor: 3200, currency: "USD", beneficiaryAccountReference: "****4821", description: "Segundo pedido del mes (demo)" };
    case "papeleria_duplicate": {
      const last = await db.paymentDecision.findFirst({
        where: { organizationId, supplier: { normalizedName: SUPPLIERS.papeleria }, invoiceNumber: { not: null } },
        orderBy: { evaluatedAt: "desc" },
        select: { invoiceNumber: true },
      });
      if (last?.invoiceNumber == null) return "Primero simula una factura de Papelería Central para poder duplicarla.";
      return { supplier: "papeleria", invoiceNumber: last.invoiceNumber, amountMinor: 4590, currency: "USD", beneficiaryAccountReference: "****4821", description: "Copia reenviada (demo)" };
    }
    case "papeleria_over_limit":
      return { supplier: "papeleria", invoiceNumber: `PC-${unique}`, amountMinor: 15_000, currency: "USD", beneficiaryAccountReference: "****4821", description: "Pedido grande (demo)", nextMonth: true };
    case "papeleria_new_account":
      return { supplier: "papeleria", invoiceNumber: `PC-${unique}`, amountMinor: 2750, currency: "USD", beneficiaryAccountReference: "****9999", description: "\"Cambiamos de banco\" (demo)", nextMonth: true };
    case "nube_recurring":
      return { supplier: "nube", invoiceNumber: `NH-${unique}`, amountMinor: 150_000, currency: "USD", beneficiaryAccountReference: "****1234", description: "Hosting mensual (demo)" };
    case "nube_contract_mismatch":
      return { supplier: "nube", invoiceNumber: `NH-${unique}`, amountMinor: 160_000, currency: "USD", beneficiaryAccountReference: "****1234", description: "Hosting con recargo (demo)" };
    case "eur_invoice":
      return { supplier: "diseno", invoiceNumber: `DS-${unique}`, amountMinor: 82_000, currency: "EUR", beneficiaryAccountReference: "****3390", description: "Diseño mensual en euros (demo)" };
    case "missing_amount":
      return { supplier: "diseno", invoiceNumber: `DS-${unique}`, amountMinor: null, currency: "USD", beneficiaryAccountReference: "****3390", description: "Monto ilegible (demo)" };
    case "extraction_warning":
      return {
        supplier: "diseno",
        invoiceNumber: `DS-${unique}`,
        amountMinor: 61_000,
        currency: "USD",
        beneficiaryAccountReference: "****3390",
        description: "PDF borroso (demo)",
        warnings: [{ code: "low_confidence_amount", message: "El monto se leyó con baja confianza", field: "amountMinor" }],
      };
  }
}

export async function buildDemoInvoice(
  scenario: DemoScenarioId,
  organizationId: string,
  now: Date,
): Promise<{ ok: true; invoice: InvoiceContext } | { ok: false; error: string }> {
  const today = now.toISOString().slice(0, 10);
  const base = await scenarioBase(scenario, organizationId, today);
  if (typeof base === "string") return { ok: false, error: base };

  const supplier = await db.supplier.findFirst({
    where: { organizationId, normalizedName: SUPPLIERS[base.supplier] },
    select: { id: true, name: true },
  });
  if (supplier === null) return { ok: false, error: "Faltan los proveedores demo: carga los datos demo en Políticas." };

  const invoiceDate = base.nextMonth ? firstOfNextMonth(today) : today;
  // Igual que hará el pipeline real: el contrato se compara antes de evaluar.
  const contractMatch = await findContractMatch(organizationId, {
    supplierId: supplier.id,
    amountMinor: base.amountMinor,
    currency: base.currency,
    invoiceDate,
    beneficiaryAccountReference: base.beneficiaryAccountReference,
  });

  const missingFields: InvoiceContext["missingFields"] = [];
  if (base.invoiceNumber === null) missingFields.push("invoiceNumber");
  if (base.amountMinor === null) missingFields.push("amountMinor");
  if (base.currency === null) missingFields.push("currency");

  const invoice = InvoiceContextSchema.parse({
    schemaVersion: 1,
    invoiceId: `demo_${scenario}_${randomUUID()}`,
    organizationId,
    invoiceNumber: base.invoiceNumber,
    source: "dashboard",
    sourceAccountId: null,
    sourceMessageId: null,
    documentId: null,
    documentType: "manual_entry",
    receivedAt: now.toISOString().replace(/\.\d{3}Z$/, "Z"),
    supplierId: supplier.id,
    supplierName: supplier.name,
    supplierMatchStatus: "matched",
    beneficiaryAccountReference: base.beneficiaryAccountReference,
    amountMinor: base.amountMinor,
    currency: base.currency,
    description: base.description,
    invoiceDate,
    dueDate: null,
    contractMatch,
    missingFields: [...missingFields, "dueDate"],
    extractionWarnings: base.warnings ?? [],
    evidence: [],
  });
  return { ok: true, invoice };
}
