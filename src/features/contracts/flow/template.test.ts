import { describe, expect, it } from "vitest";
import { evaluateFlow } from "./evaluate";
import { hashGraph } from "./hash";
import { summarizeGraph, templateGraph, type FlatTerms } from "./template";
import { validateFlow } from "./validate";
import { matchContract } from "../match-contract";

const terms: FlatTerms = {
  frequency: "monthly",
  validFrom: "2026-01-01",
  validTo: "2026-12-31",
  currency: "USD",
  agreedAmountMinor: 150_000,
  beneficiaryAccountRef: "ACC-1",
};

describe("templateGraph", () => {
  it("produce un grafo válido con y sin cuenta, y su resumen vuelve a los términos planos", () => {
    for (const t of [terms, { ...terms, beneficiaryAccountRef: null, validTo: null }]) {
      const graph = templateGraph(t);
      expect(validateFlow(graph).ok).toBe(true);
      expect(summarizeGraph(graph)).toEqual(t);
    }
  });

  it("evalúa igual que la comparación plana anterior (equivalencia con matchContract)", () => {
    const contract = { contractId: "c1", supplierId: "s1", status: "active" as const, beneficiaryAccountRef: terms.beneficiaryAccountRef, ...terms };
    const graph = templateGraph(terms);
    const cases = [
      { amountMinor: 150_000, currency: "USD", invoiceDate: "2026-06-01", acct: "ACC-1" },
      { amountMinor: 150_001, currency: "USD", invoiceDate: "2026-06-01", acct: "ACC-1" },
      { amountMinor: 150_000, currency: "EUR", invoiceDate: "2026-06-01", acct: "ACC-1" },
      { amountMinor: 150_000, currency: "USD", invoiceDate: "2027-03-01", acct: "ACC-1" },
      { amountMinor: 150_000, currency: "USD", invoiceDate: "2026-06-01", acct: "ACC-9" },
      { amountMinor: null, currency: "USD", invoiceDate: "2026-06-01", acct: "ACC-1" },
    ];
    for (const c of cases) {
      const legacy = matchContract(
        { supplierId: "s1", amountMinor: c.amountMinor, currency: c.currency, invoiceDate: c.invoiceDate, beneficiaryAccountReference: c.acct },
        [contract],
      );
      const flow = evaluateFlow(graph, {
        amountMinor: c.amountMinor,
        currency: c.currency,
        invoiceDate: c.invoiceDate,
        dueDate: null,
        beneficiaryAccountReference: c.acct,
        deliveredMilestones: null,
      });
      expect(flow.status).toBe(legacy?.matchStatus);
      expect(flow.discrepancies.map((d) => d.field).sort()).toEqual(legacy?.discrepancies.map((d) => d.field).sort());
    }
  });

  it("sin nodo de monto único no hay resumen", () => {
    const graph = templateGraph(terms);
    graph.nodes = graph.nodes.filter((n) => n.type !== "amount");
    expect(summarizeGraph(graph)).toBeNull();
  });
});

describe("hashGraph", () => {
  it("no depende del orden de las claves y cambia con el contenido", () => {
    const a = templateGraph(terms);
    const reordered = JSON.parse(JSON.stringify({ edges: a.edges, nodes: a.nodes, schemaVersion: 1 }));
    expect(hashGraph(reordered)).toBe(hashGraph(a));
    expect(hashGraph(templateGraph({ ...terms, agreedAmountMinor: 1 }))).not.toBe(hashGraph(a));
    expect(hashGraph(a)).toMatch(/^[a-f0-9]{64}$/);
  });
});
