import { describe, expect, it } from "vitest";
import {
  AssociateRequestSchema,
  AssociationReportSchema,
  ConfirmSuggestionRequestSchema,
  SupplierAssociationAuditEventSchema,
  SupplierSuggestionSchema,
} from "./supplier-association";

const candidate = { supplierId: "sup_1", supplierName: "Hosting Demo Inc", similarity: 0.92 };

describe("SupplierSuggestionSchema", () => {
  const base = { key: "hosting demo", occurrences: 2, transactionIds: ["t1", "t2"] };

  it("acepta las tres formas", () => {
    expect(SupplierSuggestionSchema.safeParse({ ...base, kind: "link_existing", candidate }).success).toBe(true);
    expect(SupplierSuggestionSchema.safeParse({ ...base, kind: "ambiguous", candidates: [candidate, { ...candidate, supplierId: "sup_2" }] }).success).toBe(true);
    expect(SupplierSuggestionSchema.safeParse({
        ...base,
        kind: "create_new",
        proposedName: "Hosting Demo",
        firstPostedOn: "2026-01-01",
        lastPostedOn: "2026-02-01",
        sampleDescriptions: ["HOSTING DEMO"],
        autoCreateEligible: true,
      }).success).toBe(true);
  });

  it("ambiguous exige al menos dos candidatos y occurrences debe igualar transactionIds", () => {
    expect(SupplierSuggestionSchema.safeParse({ ...base, kind: "ambiguous", candidates: [candidate] }).success).toBe(false);
    expect(SupplierSuggestionSchema.safeParse({ ...base, occurrences: 3, kind: "link_existing", candidate }).success).toBe(false);
  });

  it("rechaza similitud fuera de 0..1 y campos extra (nada que autorice)", () => {
    expect(SupplierSuggestionSchema.safeParse({ ...base, kind: "link_existing", candidate: { ...candidate, similarity: 1.2 } }).success).toBe(false);
    expect(SupplierSuggestionSchema.safeParse({ ...base, kind: "link_existing", candidate, authorized: true }).success).toBe(false);
  });
});

describe("peticiones", () => {
  it("autoCreate es false por defecto", () => {
    expect(AssociateRequestSchema.parse({})).toEqual({ autoCreate: false });
    expect(AssociateRequestSchema.parse({ autoCreate: true }).autoCreate).toBe(true);
  });

  it("confirmar exige acción y datos coherentes", () => {
    expect(ConfirmSuggestionRequestSchema.safeParse({ action: "link_existing", key: "k", supplierId: "s" }).success).toBe(true);
    expect(ConfirmSuggestionRequestSchema.safeParse({ action: "create_new", key: "k", name: "  " }).success).toBe(false);
    expect(ConfirmSuggestionRequestSchema.safeParse({ action: "create_new", key: "k", supplierId: "s" }).success).toBe(false);
    expect(ConfirmSuggestionRequestSchema.safeParse({ action: "authorize", key: "k" }).success).toBe(false);
  });
});

describe("informe y auditoría", () => {
  it("el informe vacío es válido", () => {
    expect(AssociationReportSchema.safeParse({ linked: [], created: [], suggestions: [], skipped: { inflows: 0, unclassifiable: 0, alreadyLinked: 0 } })
        .success).toBe(true);
  });

  it("filas de auditoría válidas e inválidas", () => {
    expect(SupplierAssociationAuditEventSchema.safeParse({
        entityType: "supplier",
        entityId: "sup_1",
        actorId: null,
        eventType: "proveedor.creado_automaticamente",
        payload: { name: "Hosting Demo", normalizedName: "hosting demo", key: "hosting demo", transactionCount: 3, requestedBy: "user_1", importBatchId: null },
      }).success).toBe(true);
    expect(SupplierAssociationAuditEventSchema.safeParse({
        entityType: "supplier",
        entityId: "sup_1",
        actorId: "user_1",
        eventType: "transacciones_bancarias.vinculadas",
        payload: { key: "hosting demo", count: 0, method: "exact", importBatchId: null },
      }).success).toBe(false);
    expect(SupplierAssociationAuditEventSchema.safeParse({
        entityType: "supplier",
        entityId: "sup_1",
        actorId: null,
        eventType: "autorizacion.creada",
        payload: {},
      }).success).toBe(false);
  });
});
