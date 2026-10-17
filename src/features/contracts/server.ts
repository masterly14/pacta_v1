/**
 * Purpose: persist and read contracts, always scoped by organizationId and audited, and
 *   load the supplier's contracts to produce an invoice's ContractMatch.
 * Runs in: server (Node).
 * Triggered by: actions.ts and POST /api/contracts (mutations), the /platform/contracts
 *   page (reads) and, later, the invoice context builder (findContractMatch).
 * Receives → Returns: (ContractActor, validated input) → ContractResult; organizationId →
 *   overview; (organizationId, invoice facts) → ContractMatch | null.
 * Talks to: db (src/lib/db.ts) — Contract, Supplier (read only), AuditEvent;
 *   ./permissions.ts, ./match-contract.ts, ./overlap.ts.
 */
import type { Prisma, Contract } from "@prisma/client";
import { db } from "@/lib/db";
import type { Workspace } from "@/shared/auth/ensure-workspace";
import type { ContractMatch } from "@/shared/schemas/invoice-context";
import { matchContract, type ContractMatchInvoiceFacts, type MatchableContract } from "./match-contract";
import { findOverlap } from "./overlap";
import { checkCanManageContracts, type ContractActor } from "./permissions";
import type { ContractInput } from "./schemas";

type DenialReason = "forbidden" | "not_found" | "conflict";

export type ContractResult =
  | { ok: true; message: string; contractId: string }
  | { ok: false; reason: DenialReason; error: string };

type Tx = Prisma.TransactionClient;

function denied(reason: DenialReason, error: string): ContractResult {
  return { ok: false, reason, error };
}

// Fechas de calendario (@db.Date) se guardan como medianoche UTC.
function toDbDate(calendarDate: string): Date {
  return new Date(`${calendarDate}T00:00:00.000Z`);
}

function fromDbDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function audit(tx: Tx, actor: ContractActor, entityId: string, eventType: string, payload: Prisma.InputJsonValue) {
  return tx.auditEvent.create({
    data: { organizationId: actor.organizationId, entityType: "contract", entityId, eventType, actorId: actor.userId, payload },
  });
}

function toMatchable(contract: Contract): MatchableContract {
  return {
    contractId: contract.id,
    supplierId: contract.supplierId,
    status: contract.status,
    agreedAmountMinor: contract.agreedAmountMinor,
    currency: contract.currency,
    frequency: contract.frequency,
    validFrom: fromDbDate(contract.validFrom),
    validTo: contract.validTo === null ? null : fromDbDate(contract.validTo),
    beneficiaryAccountRef: contract.beneficiaryAccountRef,
  };
}

// ---------------------------------------------------------------------------
// Actor
// ---------------------------------------------------------------------------

export function contractActorFromWorkspace(workspace: Workspace): ContractActor {
  return {
    userId: workspace.user.id,
    organizationId: workspace.organization.id,
    role: workspace.membership.role,
  };
}

// ---------------------------------------------------------------------------
// Lecturas
// ---------------------------------------------------------------------------

export async function getContractsOverview(organizationId: string) {
  const [contracts, suppliers] = await Promise.all([
    db.contract.findMany({
      where: { organizationId },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      include: { supplier: { select: { name: true } } },
    }),
    db.supplier.findMany({ where: { organizationId }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);

  return {
    suppliers,
    contracts: contracts.map((contract) => ({
      ...toMatchable(contract),
      supplierName: contract.supplier.name,
      description: contract.description,
      createdBy: contract.createdBy,
      createdAt: contract.createdAt.toISOString(),
      terminatedAt: contract.terminatedAt?.toISOString() ?? null,
    })),
  };
}

export type ContractsOverview = Awaited<ReturnType<typeof getContractsOverview>>;

// Compara la factura con los contratos activos de su proveedor. Solo evidencia: no autoriza.
export async function findContractMatch(
  organizationId: string,
  invoice: ContractMatchInvoiceFacts,
): Promise<ContractMatch | null> {
  if (invoice.supplierId === null) {
    return null;
  }
  const contracts = await db.contract.findMany({
    where: { organizationId, supplierId: invoice.supplierId, status: "active" },
  });
  return matchContract(invoice, contracts.map(toMatchable));
}

// ---------------------------------------------------------------------------
// Mutaciones (cada una con su evento de auditoría en la misma transacción)
// ---------------------------------------------------------------------------

export async function createContract(actor: ContractActor, input: ContractInput): Promise<ContractResult> {
  const denial = checkCanManageContracts(actor);
  if (denial !== null) return denied("forbidden", denial);

  // El proveedor llega del formulario: debe pertenecer a la organización del actor.
  const supplier = await db.supplier.findFirst({
    where: { id: input.supplierId, organizationId: actor.organizationId },
    select: { id: true, name: true },
  });
  if (supplier === null) return denied("not_found", "Proveedor no encontrado.");

  return db.$transaction(async (tx): Promise<ContractResult> => {
    // Bloquea al proveedor: dos registros simultáneos no pueden saltarse la comprobación.
    await tx.$queryRaw`SELECT id FROM suppliers WHERE id = ${supplier.id} FOR UPDATE`;

    // Dos contratos vigentes el mismo día vuelven ambigua cada factura del proveedor.
    const active = await tx.contract.findMany({
      where: { organizationId: actor.organizationId, supplierId: supplier.id, status: "active" },
      select: { validFrom: true, validTo: true },
    });
    const overlap = findOverlap(
      { validFrom: input.validFrom, validTo: input.validTo },
      active.map((c) => ({ validFrom: fromDbDate(c.validFrom), validTo: c.validTo === null ? null : fromDbDate(c.validTo) })),
    );
    if (overlap !== null) {
      return denied(
        "conflict",
        `${supplier.name} ya tiene un contrato activo vigente ${overlap.validFrom} → ${overlap.validTo ?? "sin fin"} que se solapa. Termínalo antes de registrar uno nuevo.`,
      );
    }

    const contract = await tx.contract.create({
      data: {
        organizationId: actor.organizationId,
        supplierId: supplier.id,
        agreedAmountMinor: input.agreedAmountMinor,
        currency: input.currency,
        frequency: input.frequency,
        validFrom: toDbDate(input.validFrom),
        validTo: input.validTo === null ? null : toDbDate(input.validTo),
        beneficiaryAccountRef: input.beneficiaryAccountRef,
        description: input.description,
        createdBy: actor.userId,
      },
    });
    await audit(tx, actor, contract.id, "contract.created", { ...input, supplierName: supplier.name });
    return { ok: true, message: `Contrato con ${supplier.name} registrado.`, contractId: contract.id };
  });
}

// Un contrato no se borra ni se edita: se termina y queda en el historial.
export async function terminateContract(actor: ContractActor, contractId: string): Promise<ContractResult> {
  const denial = checkCanManageContracts(actor);
  if (denial !== null) return denied("forbidden", denial);

  const terminated = await db.$transaction(async (tx) => {
    const { count } = await tx.contract.updateMany({
      where: { id: contractId, organizationId: actor.organizationId, status: "active" },
      data: { status: "terminated", terminatedAt: new Date(), terminatedBy: actor.userId },
    });
    if (count === 0) return false;
    await audit(tx, actor, contractId, "contract.terminated", {});
    return true;
  });
  if (!terminated) return denied("not_found", "Contrato no encontrado o ya terminado.");
  return { ok: true, message: "Contrato terminado.", contractId };
}
