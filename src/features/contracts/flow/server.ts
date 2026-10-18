/**
 * Purpose: persistir y leer las versiones del flujo de un contrato (borrador → activa → reemplazada),
 *   siempre acotado por organizationId, validado y auditado. El flujo es evidencia, no autorización.
 * Runs in: servidor (Node).
 * Triggered by: flow/actions.ts (guardar borrador, activar), las páginas de contratos (lecturas)
 *   y, en la fase de integración, findContractMatch (versión activa).
 * Receives → Returns: (ContractActor, JSON no confiable) → FlowResult; (orgId, contractId) → vista.
 * Talks to: db — Contract, ContractFlowVersion, AuditEvent; ../permissions.ts, ../overlap.ts,
 *   ./validate.ts, ./template.ts, ./hash.ts.
 */
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { findOverlap } from "../overlap";
import { checkCanManageContracts, type ContractActor } from "../permissions";
import { hashGraph } from "./hash";
import type { ContractFlowGraph } from "./schema";
import { summarizeGraph } from "./template";
import { validateFlow, type FlowIssue } from "./validate";

type Tx = Prisma.TransactionClient;
type Denial = "forbidden" | "not_found" | "conflict" | "invalid";

export type FlowResult =
  | { ok: true; message: string; version: number; graphSha256: string }
  | { ok: false; reason: Denial; error: string; issues: FlowIssue[] };

const denied = (reason: Denial, error: string, issues: FlowIssue[] = []): FlowResult => ({ ok: false, reason, error, issues });

const toDbDate = (d: string) => new Date(`${d}T00:00:00.000Z`);
const fromDbDate = (d: Date) => d.toISOString().slice(0, 10);
const asJson = (graph: ContractFlowGraph) => graph as unknown as Prisma.InputJsonValue;

function audit(tx: Tx, actor: ContractActor, versionId: string, eventType: string, payload: Prisma.InputJsonValue) {
  return tx.auditEvent.create({
    data: { organizationId: actor.organizationId, entityType: "contract_flow", entityId: versionId, eventType, actorId: actor.userId, payload },
  });
}

// El JSON guardado se vuelve a validar al leerlo: si no cumple, no se usa (falla cerrado).
function parseStored(graph: Prisma.JsonValue): ContractFlowGraph | null {
  const v = validateFlow(graph);
  return v.ok ? v.graph : null;
}

// ---------------------------------------------------------------------------
// Lecturas
// ---------------------------------------------------------------------------

export type FlowVersionView = {
  id: string;
  version: number;
  status: "draft" | "active" | "superseded";
  graph: ContractFlowGraph | null; // null = el JSON guardado no pasó la validación
  graphSha256: string;
  createdBy: string;
  createdAt: string;
  activatedBy: string | null;
  activatedAt: string | null;
};

export async function getContractFlow(organizationId: string, contractId: string) {
  const contract = await db.contract.findFirst({
    where: { id: contractId, organizationId },
    include: { supplier: { select: { name: true } }, flowVersions: { orderBy: { version: "desc" } } },
  });
  if (contract === null) return null;

  const versions: FlowVersionView[] = contract.flowVersions.map((v) => ({
    id: v.id,
    version: v.version,
    status: v.status,
    graph: parseStored(v.graph),
    graphSha256: v.graphSha256,
    createdBy: v.createdBy,
    createdAt: v.createdAt.toISOString(),
    activatedBy: v.activatedBy,
    activatedAt: v.activatedAt?.toISOString() ?? null,
  }));
  return {
    contractId: contract.id,
    supplierId: contract.supplierId,
    supplierName: contract.supplier.name,
    status: contract.status,
    active: versions.find((v) => v.status === "active") ?? null,
    draft: versions.find((v) => v.status === "draft") ?? null,
    history: versions.filter((v) => v.status !== "draft"),
  };
}

// Versión activa de un contrato, lista para evaluar. null si no hay o no es válida.
export async function getActiveFlow(organizationId: string, contractId: string) {
  const row = await db.contractFlowVersion.findFirst({
    where: { organizationId, contractId, status: "active" },
  });
  if (row === null) return null;
  const graph = parseStored(row.graph);
  return graph === null ? null : { version: row.version, graph, graphSha256: row.graphSha256 };
}

// ---------------------------------------------------------------------------
// Mutaciones
// ---------------------------------------------------------------------------

// Guarda (crea o actualiza) el único borrador del contrato. `baseSha256` es el hash del borrador
// que el editor cargó (null si no había): si cambió mientras tanto, se rechaza en vez de pisarlo.
export async function saveFlowDraft(
  actor: ContractActor,
  contractId: string,
  rawGraph: unknown,
  baseSha256: string | null,
): Promise<FlowResult> {
  const denial = checkCanManageContracts(actor);
  if (denial !== null) return denied("forbidden", denial);

  const validation = validateFlow(rawGraph);
  if (!validation.ok) return denied("invalid", "El flujo no es válido.", validation.errors);
  const graph = validation.graph;
  const sha = hashGraph(graph);

  return db.$transaction(async (tx): Promise<FlowResult> => {
    // Bloquea el contrato: dos guardados simultáneos no crean dos borradores.
    const locked = await tx.$queryRaw<{ status: string }[]>`
      SELECT status::text AS status FROM contracts WHERE id = ${contractId} AND organization_id = ${actor.organizationId} FOR UPDATE`;
    if (locked.length === 0) return denied("not_found", "Contrato no encontrado.");
    if (locked[0].status !== "active") return denied("conflict", "Un contrato terminado no se puede editar.");

    const draft = await tx.contractFlowVersion.findFirst({ where: { contractId, organizationId: actor.organizationId, status: "draft" } });
    if ((draft?.graphSha256 ?? null) !== baseSha256) {
      return denied("conflict", "El borrador cambió desde que lo abriste. Recarga para ver la última versión.");
    }

    if (draft !== null) {
      await tx.contractFlowVersion.update({ where: { id: draft.id }, data: { graph: asJson(graph), graphSha256: sha } });
      await audit(tx, actor, draft.id, "flow.draft_saved", { contractId, version: draft.version, graphSha256: sha });
      return { ok: true, message: "Borrador guardado.", version: draft.version, graphSha256: sha };
    }

    const last = await tx.contractFlowVersion.aggregate({ where: { contractId }, _max: { version: true } });
    const version = (last._max.version ?? 0) + 1;
    const created = await tx.contractFlowVersion.create({
      data: { organizationId: actor.organizationId, contractId, version, graph: asJson(graph), graphSha256: sha, status: "draft", createdBy: actor.userId },
    });
    await audit(tx, actor, created.id, "flow.draft_saved", { contractId, version, graphSha256: sha });
    return { ok: true, message: "Borrador creado.", version, graphSha256: sha };
  });
}

// Activa el borrador: lo congela, reemplaza a la versión activa y proyecta el resumen al contrato.
// `expectedSha256` es el hash que la persona revisó; si el borrador cambió, no se activa.
export async function activateFlow(actor: ContractActor, contractId: string, expectedSha256: string): Promise<FlowResult> {
  const denial = checkCanManageContracts(actor);
  if (denial !== null) return denied("forbidden", denial);

  return db.$transaction(async (tx): Promise<FlowResult> => {
    const contract = await tx.contract.findFirst({
      where: { id: contractId, organizationId: actor.organizationId },
      select: { supplierId: true, status: true },
    });
    if (contract === null) return denied("not_found", "Contrato no encontrado.");
    if (contract.status !== "active") return denied("conflict", "Un contrato terminado no se puede modificar.");

    // Mismo orden de bloqueo que createContract: primero el proveedor, luego el contrato.
    await tx.$queryRaw`SELECT id FROM suppliers WHERE id = ${contract.supplierId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM contracts WHERE id = ${contractId} FOR UPDATE`;

    const draft = await tx.contractFlowVersion.findFirst({ where: { contractId, organizationId: actor.organizationId, status: "draft" } });
    if (draft === null) return denied("not_found", "No hay un borrador para activar.");

    // Se revalida en el servidor: el borrador guardado no es de fiar.
    const validation = validateFlow(draft.graph);
    if (!validation.ok) return denied("invalid", "El borrador no es válido.", validation.errors);
    const sha = hashGraph(validation.graph);
    if (sha !== expectedSha256) {
      return denied("conflict", "El borrador cambió desde que lo revisaste. Revísalo de nuevo antes de activar.");
    }
    const terms = summarizeGraph(validation.graph);
    if (terms === null) {
      return denied("invalid", "Para activar, el flujo necesita exactamente un nodo de monto.", [
        { code: "NO_SUMMARY", message: "Debe haber exactamente un nodo de monto.", nodeId: null },
      ]);
    }

    // La vigencia del nuevo flujo no puede solaparse con otro contrato activo del proveedor.
    const others = await tx.contract.findMany({
      where: { organizationId: actor.organizationId, supplierId: contract.supplierId, status: "active", id: { not: contractId } },
      select: { validFrom: true, validTo: true },
    });
    const overlap = findOverlap(
      { validFrom: terms.validFrom, validTo: terms.validTo },
      others.map((c) => ({ validFrom: fromDbDate(c.validFrom), validTo: c.validTo === null ? null : fromDbDate(c.validTo) })),
    );
    if (overlap !== null) {
      return denied("conflict", `La vigencia se solapa con otro contrato activo del proveedor (${overlap.validFrom} → ${overlap.validTo ?? "sin fin"}).`);
    }

    // Primero se reemplaza la activa: el índice único permite una sola.
    const previous = await tx.contractFlowVersion.findFirst({ where: { contractId, organizationId: actor.organizationId, status: "active" } });
    if (previous !== null) {
      await tx.contractFlowVersion.update({ where: { id: previous.id }, data: { status: "superseded" } });
      await audit(tx, actor, previous.id, "flow.superseded", { contractId, version: previous.version, supersededBy: draft.version });
    }
    await tx.contractFlowVersion.update({
      where: { id: draft.id },
      data: { status: "active", graphSha256: sha, activatedBy: actor.userId, activatedAt: new Date() },
    });
    await tx.contract.update({
      where: { id: contractId },
      data: {
        frequency: terms.frequency,
        validFrom: toDbDate(terms.validFrom),
        validTo: terms.validTo === null ? null : toDbDate(terms.validTo),
        currency: terms.currency,
        agreedAmountMinor: terms.agreedAmountMinor,
        beneficiaryAccountRef: terms.beneficiaryAccountRef,
      },
    });
    await audit(tx, actor, draft.id, "flow.activated", { contractId, version: draft.version, graphSha256: sha, summary: terms });
    return { ok: true, message: `Versión ${draft.version} activada.`, version: draft.version, graphSha256: sha };
  });
}
