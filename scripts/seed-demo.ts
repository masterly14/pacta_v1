/**
 * Carga un mes de historia FICTICIA para la demo (CLAUDE.md §6.10: nunca datos reales):
 * proveedores, autorizaciones, una versión de política vigente desde el 1 de septiembre, facturas
 * recibidas por día evaluadas por el motor real con la fecha de cada día (sin avisos de WhatsApp),
 * recibos de pagos con tarjeta y movimientos bancarios de una suscripción.
 *
 * Idempotente: los ids son fijos (`seed_…`) y lo que ya existe se omite. No borra ni modifica nada
 * existente; la política nueva repite los límites de la vigente.
 *
 *   node --env-file=.env.local ./node_modules/vite-node/vite-node.mjs --config vitest.config.ts \
 *     scripts/seed-demo.ts <organizationId> <adminUserId>
 */
import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { findContractMatch } from "@/features/contracts/server";
import { evaluateInvoice } from "@/features/decisions/server";
import { normalizeSupplierName } from "@/features/policies/normalize";
import { InvoiceContextSchema, InvoiceMissingFieldSchema, type InvoiceContext } from "@/shared/schemas/invoice-context";

const [organizationId, actorId] = process.argv.slice(2);
if (!organizationId || !actorId) {
  console.error("Uso: seed-demo.ts <organizationId> <adminUserId>");
  process.exit(1);
}

const POLICY_FROM = "2026-09-01";
const AUTH_FROM = "2026-09-01";
const AUTH_UNTIL = "2027-08-31";

type SupplierSeed = { key: string; name: string; account: string; email: string };
const SUPPLIERS: SupplierSeed[] = [
  { key: "cloudline", name: "Cloudline Hosting", account: "****5521", email: "billing@cloudline.example" },
  { key: "limpieza", name: "Limpieza Total S.A.S.", account: "****6610", email: "facturas@limpiezatotal.example" },
  { key: "cafe", name: "Café Andino", account: "****7302", email: "pedidos@cafeandino.example" },
  { key: "transportes", name: "Transportes Rápidos", account: "****8814", email: "cobros@transportesrapidos.example" },
  { key: "contable", name: "Software Contable Pro", account: "****4417", email: "billing@contablepro.example" },
  { key: "imprenta", name: "Imprenta Express", account: "****2290", email: "ventas@imprentaexpress.example" },
  { key: "streambox", name: "StreamBox Pro", account: "****0042", email: "no-reply@streambox.example" },
  { key: "nordico", name: "Diseño Nórdico", account: "****9183", email: "studio@disenonordico.example" },
  { key: "dominios", name: "Dominios Latam", account: "****3376", email: "renovaciones@dominioslatam.example" },
];

// Autorizaciones explícitas (lo único que permite aprobar sin una persona).
const AUTHORIZATIONS: { supplier: string; frequency: "weekly" | "monthly"; maxAmountMinor: number }[] = [
  { supplier: "cloudline", frequency: "monthly", maxAmountMinor: 90_000 },
  { supplier: "limpieza", frequency: "weekly", maxAmountMinor: 35_000 },
  { supplier: "cafe", frequency: "weekly", maxAmountMinor: 20_000 },
  { supplier: "contable", frequency: "monthly", maxAmountMinor: 250_000 },
  { supplier: "imprenta", frequency: "monthly", maxAmountMinor: 60_000 },
];

type InvoiceSeed = {
  key: string;
  date: string; // YYYY-MM-DD de recepción y emisión
  time: string; // HH:MM UTC
  supplier: string | null; // null = proveedor no reconocido
  name: string;
  number: string | null;
  amountMinor: number | null;
  currency?: string;
  account?: string;
  description: string;
};

// Un mes de facturas. Resultado esperado al lado (lo decide el motor, no el script).
const INVOICES: InvoiceSeed[] = [
  { key: "lt-0921", date: "2026-09-21", time: "13:10", supplier: "limpieza", name: "Limpieza Total S.A.S.", number: "LT-0921", amountMinor: 32_000, description: "Limpieza de oficina, semana 38" }, // aprobada
  { key: "cl-2609", date: "2026-09-22", time: "09:05", supplier: "cloudline", name: "Cloudline Hosting", number: "CL-2609", amountMinor: 89_000, description: "Plan Business, septiembre" }, // aprobada
  { key: "ca-0923", date: "2026-09-23", time: "15:40", supplier: "cafe", name: "Café Andino", number: "CA-0923", amountMinor: 14_550, description: "Café y snacks de oficina" }, // aprobada
  { key: "tr-1188", date: "2026-09-25", time: "11:20", supplier: "transportes", name: "Transportes Rápidos", number: "TR-1188", amountMinor: 26_000, description: "Envíos a clientes" }, // escalada: sin autorización
  { key: "lt-0928", date: "2026-09-28", time: "13:02", supplier: "limpieza", name: "Limpieza Total S.A.S.", number: "LT-0928", amountMinor: 32_000, description: "Limpieza de oficina, semana 39" }, // aprobada
  { key: "ca-0930", date: "2026-09-30", time: "16:15", supplier: "cafe", name: "Café Andino", number: "CA-0930", amountMinor: 14_550, description: "Café y snacks de oficina" }, // aprobada
  { key: "scp-2609", date: "2026-09-30", time: "10:00", supplier: "contable", name: "Software Contable Pro", number: "SCP-2609", amountMinor: 240_000, description: "Licencia anual, 10 usuarios" }, // escalada: supera el límite automático
  { key: "tr-1203", date: "2026-10-01", time: "12:45", supplier: "transportes", name: "Transportes Rápidos", number: "TR-1203", amountMinor: 41_000, description: "Envíos a clientes" }, // escalada
  { key: "cl-2610", date: "2026-10-02", time: "09:03", supplier: "cloudline", name: "Cloudline Hosting", number: "CL-2610", amountMinor: 89_000, description: "Plan Business, octubre" }, // aprobada
  { key: "lt-1005", date: "2026-10-05", time: "13:07", supplier: "limpieza", name: "Limpieza Total S.A.S.", number: "LT-1005", amountMinor: 32_000, description: "Limpieza de oficina, semana 41" }, // aprobada
  { key: "ie-551", date: "2026-10-06", time: "14:30", supplier: "imprenta", name: "Imprenta Express", number: "IE-551", amountMinor: 48_000, description: "Tarjetas y volantes" }, // aprobada
  { key: "ca-1007", date: "2026-10-07", time: "15:55", supplier: "cafe", name: "Café Andino", number: "CA-1007", amountMinor: 14_550, description: "Café y snacks de oficina" }, // aprobada
  { key: "tr-1219", date: "2026-10-08", time: "11:10", supplier: "transportes", name: "Transportes Rápidos", number: "TR-1219", amountMinor: 18_500, description: "Envíos a clientes" }, // escalada
  { key: "ie-551-resend", date: "2026-10-09", time: "08:50", supplier: "imprenta", name: "Imprenta Express", number: "IE-551", amountMinor: 48_000, description: "Tarjetas y volantes (reenvío)" }, // bloqueada: duplicada
  { key: "dn-77", date: "2026-10-10", time: "17:20", supplier: "nordico", name: "Diseño Nórdico", number: "DN-77", amountMinor: 82_000, currency: "EUR", description: "Rediseño de marca" }, // escalada: moneda
  { key: "lt-1012", date: "2026-10-12", time: "13:05", supplier: "limpieza", name: "Limpieza Total S.A.S.", number: "LT-1012", amountMinor: 32_000, description: "Limpieza de oficina, semana 42" }, // aprobada
  { key: "sg-unknown", date: "2026-10-12", time: "19:40", supplier: null, name: "Servicios Globales", number: null, amountMinor: null, description: "Cobro de servicios" }, // escalada: datos incompletos
  { key: "ca-1014", date: "2026-10-14", time: "16:05", supplier: "cafe", name: "Café Andino", number: "CA-1014", amountMinor: 14_550, description: "Café y snacks de oficina" }, // aprobada
  { key: "scp-2610-account", date: "2026-10-14", time: "18:30", supplier: "contable", name: "Software Contable Pro", number: "SCP-2610", amountMinor: 18_000, account: "****9999", description: "Módulo de nómina" }, // escalada: cambio de cuenta
  { key: "tr-1236", date: "2026-10-15", time: "10:25", supplier: "transportes", name: "Transportes Rápidos", number: "TR-1236", amountMinor: 53_000, description: "Envíos a clientes" }, // escalada
  { key: "ie-552", date: "2026-10-16", time: "14:10", supplier: "imprenta", name: "Imprenta Express", number: "IE-552", amountMinor: 52_000, description: "Catálogos" }, // escalada: autorización del mes ya usada
];

// Recibos de pagos ya realizados (cargos con tarjeta): no se evalúan.
const RECEIPTS: (Omit<InvoiceSeed, "time"> & { paidOn: string; method: string })[] = [
  { key: "sb-0828", date: "2026-08-28", paidOn: "2026-08-28", supplier: "streambox", name: "StreamBox Pro", number: "SB-0828", amountMinor: 4_999, description: "Suscripción mensual", method: "Visa terminada en 4242" },
  { key: "sb-0928", date: "2026-09-28", paidOn: "2026-09-28", supplier: "streambox", name: "StreamBox Pro", number: "SB-0928", amountMinor: 4_999, description: "Suscripción mensual", method: "Visa terminada en 4242" },
  { key: "cl-2610-paid", date: "2026-10-03", paidOn: "2026-10-03", supplier: "cloudline", name: "Cloudline Hosting", number: "CL-2610", amountMinor: 89_000, description: "Pago del plan Business, octubre", method: "Transferencia" },
  { key: "dl-1006", date: "2026-10-06", paidOn: "2026-10-06", supplier: "dominios", name: "Dominios Latam", number: "DL-1006", amountMinor: 1_850, description: "Renovación anual de dominio", method: "Mastercard terminada en 1881" },
  { key: "ca-1013-paid", date: "2026-10-13", paidOn: "2026-10-13", supplier: "cafe", name: "Café Andino", number: "CA-1013", amountMinor: 9_800, description: "Compra en tienda", method: "Visa terminada en 4242" },
];

// Movimientos del extracto bancario (suscripción de StreamBox cobrada cada mes).
const BANK: { key: string; date: string; supplier: string; amountMinor: number; description: string }[] = [
  { key: "sb-0728", date: "2026-07-28", supplier: "streambox", amountMinor: -4_999, description: "STREAMBOX PRO MENSUAL" },
  { key: "sb-0828", date: "2026-08-28", supplier: "streambox", amountMinor: -4_999, description: "STREAMBOX PRO MENSUAL" },
  { key: "sb-0928", date: "2026-09-28", supplier: "streambox", amountMinor: -4_999, description: "STREAMBOX PRO MENSUAL" },
];

const day = (date: string) => new Date(`${date}T00:00:00.000Z`);
const addDays = (date: string, days: number) => new Date(day(date).getTime() + days * 86_400_000).toISOString().slice(0, 10);
const fingerprint = (value: string) => createHash("sha256").update(value).digest("hex");

async function ensureSuppliers(): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  for (const s of SUPPLIERS) {
    const normalizedName = normalizeSupplierName(s.name);
    const existing = await db.supplier.findFirst({ where: { organizationId, normalizedName }, select: { id: true } });
    const id = existing?.id ?? (await db.supplier.create({ data: { organizationId, name: s.name, normalizedName, beneficiaryAccountRef: s.account } })).id;
    ids.set(s.key, id);
  }
  return ids;
}

async function ensurePolicy(): Promise<void> {
  const covering = await db.paymentPolicy.findFirst({ where: { organizationId, effectiveFrom: { lte: day(POLICY_FROM) } } });
  if (covering) return;
  const current = await db.paymentPolicy.findFirst({ where: { organizationId }, orderBy: { version: "desc" } });
  if (current === null) throw new Error("La organización no tiene política: configúrala primero en Políticas.");
  // Mismos límites que la vigente; solo amplía la vigencia hacia atrás para la historia demo.
  const created = await db.paymentPolicy.create({
    data: {
      organizationId,
      version: current.version + 1,
      autoApprovalLimitMinor: current.autoApprovalLimitMinor,
      monthlyBudgetMinor: current.monthlyBudgetMinor,
      currency: current.currency,
      effectiveFrom: day(POLICY_FROM),
      createdBy: actorId,
    },
  });
  await db.auditEvent.create({
    data: { organizationId, entityType: "payment_policy", entityId: created.id, eventType: "payment_policy.created", actorId, payload: { version: created.version, seed: "demo" } },
  });
  console.log(`política v${created.version} vigente desde ${POLICY_FROM}`);
}

async function ensureAuthorizations(suppliers: Map<string, string>): Promise<void> {
  for (const a of AUTHORIZATIONS) {
    const supplierId = suppliers.get(a.supplier)!;
    const account = SUPPLIERS.find((s) => s.key === a.supplier)!.account;
    const exists = await db.paymentAuthorization.findFirst({ where: { organizationId, supplierId, beneficiaryAccountRef: account, status: "active", validFrom: day(AUTH_FROM) } });
    if (exists) continue;
    const created = await db.paymentAuthorization.create({
      data: {
        organizationId,
        supplierId,
        beneficiaryAccountRef: account,
        currency: "USD",
        maxAmountMinor: a.maxAmountMinor,
        scope: "recurring",
        frequency: a.frequency,
        validFrom: day(AUTH_FROM),
        validUntil: day(AUTH_UNTIL),
        authorizedBy: actorId,
      },
    });
    await db.auditEvent.create({
      data: { organizationId, entityType: "payment_authorization", entityId: created.id, eventType: "payment_authorization.created", actorId, payload: { seed: "demo" } },
    });
  }
}

async function buildContext(seed: InvoiceSeed | (typeof RECEIPTS)[number], suppliers: Map<string, string>, receivedAt: Date): Promise<InvoiceContext> {
  const supplier = seed.supplier === null ? null : SUPPLIERS.find((s) => s.key === seed.supplier)!;
  const supplierId = seed.supplier === null ? null : suppliers.get(seed.supplier)!;
  const currency = seed.amountMinor === null ? null : ("currency" in seed && seed.currency ? seed.currency : "USD");
  const account = "account" in seed && seed.account ? seed.account : (supplier?.account ?? null);
  const values = {
    invoiceNumber: seed.number,
    name: seed.name,
    email: supplier?.email ?? "cobros@serviciosglobales.example",
    subject: seed.number === null ? "Cobro pendiente" : `Factura ${seed.number}`,
    body: null,
    beneficiaryAccountReference: account,
    amountMinor: seed.amountMinor,
    currency,
    description: seed.description,
    invoiceDate: seed.date,
    dueDate: addDays(seed.date, 15),
  };
  const contractMatch = await findContractMatch(organizationId, {
    supplierId,
    amountMinor: values.amountMinor,
    currency: values.currency,
    invoiceDate: values.invoiceDate,
    beneficiaryAccountReference: values.beneficiaryAccountReference,
  });
  return InvoiceContextSchema.parse({
    schemaVersion: 1,
    invoiceId: `seed_${seed.key}`,
    organizationId,
    source: "email",
    sourceAccountId: "seed_mailbox",
    sourceMessageId: `seed-${seed.key}`,
    documentId: null,
    documentType: "pdf",
    receivedAt: receivedAt.toISOString(),
    supplierId,
    supplierMatchStatus: supplierId === null ? "not_found" : "matched",
    contractMatch,
    ...values,
    missingFields: InvoiceMissingFieldSchema.options.filter((field) => values[field] === null),
    extractionWarnings: [],
    evidence: [],
  });
}

function invoiceRow(context: InvoiceContext, extra: Partial<Prisma.InvoiceUncheckedCreateInput>): Prisma.InvoiceUncheckedCreateInput {
  return {
    id: context.invoiceId,
    organizationId,
    source: "email",
    extractionStatus: "extracted",
    supplierId: context.supplierId,
    supplierMatchStatus: context.supplierMatchStatus,
    name: context.name,
    invoiceNumber: context.invoiceNumber,
    amountMinor: context.amountMinor,
    currency: context.currency,
    invoiceDate: context.invoiceDate === null ? null : day(context.invoiceDate),
    dueDate: context.dueDate === null ? null : day(context.dueDate),
    contextJson: context as Prisma.InputJsonValue,
    receivedAt: new Date(context.receivedAt),
    processedAt: new Date(context.receivedAt),
    ...extra,
  };
}

async function seedInvoices(suppliers: Map<string, string>): Promise<void> {
  // En orden cronológico: cada evaluación ve las decisiones anteriores (duplicados, periodos, presupuesto).
  const ordered = [...INVOICES].sort((a, b) => `${a.date}T${a.time}`.localeCompare(`${b.date}T${b.time}`));
  for (const seed of ordered) {
    const id = `seed_${seed.key}`;
    const receivedAt = new Date(`${seed.date}T${seed.time}:00.000Z`);
    const existing = await db.invoice.findUnique({ where: { id }, select: { id: true } });
    let context: InvoiceContext;
    if (existing === null) {
      context = await buildContext(seed, suppliers, receivedAt);
      await db.invoice.create({ data: invoiceRow(context, { documentKind: "invoice" }) });
    } else {
      const row = await db.invoice.findUniqueOrThrow({ where: { id }, select: { contextJson: true } });
      context = InvoiceContextSchema.parse(row.contextJson);
    }
    if ((await db.paymentDecision.count({ where: { organizationId, invoiceId: id } })) > 0) continue;
    // El motor real con la fecha de ese día; sin avisos para no enviar WhatsApp de datos históricos.
    const decision = await evaluateInvoice(context, { now: new Date(receivedAt.getTime() + 90_000), notify: false });
    console.log(`${seed.date} ${seed.name} ${seed.number ?? "(sin número)"} → ${decision.decision} ${decision.reasonCodes.join(",")}`);
  }
}

async function seedReceipts(suppliers: Map<string, string>): Promise<void> {
  for (const seed of RECEIPTS) {
    const id = `seed_${seed.key}`;
    if (await db.invoice.findUnique({ where: { id }, select: { id: true } })) continue;
    const context = await buildContext(seed, suppliers, new Date(`${seed.date}T12:00:00.000Z`));
    await db.invoice.create({ data: invoiceRow(context, { documentKind: "receipt", paidOn: day(seed.paidOn), paymentMethod: seed.method }) });
    console.log(`recibo ${seed.paidOn} ${seed.name} ${seed.number}`);
  }
}

async function seedBank(suppliers: Map<string, string>): Promise<void> {
  const batchId = "seed_bank_batch";
  if (!(await db.bankImportBatch.findUnique({ where: { id: batchId } }))) {
    await db.bankImportBatch.create({ data: { id: batchId, organizationId, fileName: "extracto-demo.csv", rowCount: BANK.length, importedBy: actorId } });
  }
  for (const row of BANK) {
    const fp = fingerprint(`seed:${row.key}`);
    if (await db.bankTransaction.findFirst({ where: { organizationId, fingerprint: fp }, select: { id: true } })) continue;
    await db.bankTransaction.create({
      data: { organizationId, importBatchId: batchId, supplierId: suppliers.get(row.supplier)!, postedOn: day(row.date), amountMinor: row.amountMinor, currency: "USD", description: row.description, fingerprint: fp },
    });
  }
}

const suppliers = await ensureSuppliers();
await ensurePolicy();
await ensureAuthorizations(suppliers);
await seedBank(suppliers);
await seedInvoices(suppliers);
await seedReceipts(suppliers);
await db.$disconnect();
console.log("listo");
