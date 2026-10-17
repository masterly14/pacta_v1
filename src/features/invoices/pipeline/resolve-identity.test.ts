/**
 * Purpose: tests for supplier classification (only exact, unambiguous names confirm a supplier).
 * Runs in: Vitest (`npm test`).
 * Triggered by: `npm test` / `npm run test:watch`.
 * Receives → Returns: nothing; passes or fails.
 * Talks to: ./resolve-identity.ts#classifySupplier.
 */
import { describe, expect, it } from "vitest";
import { classifySupplier } from "./resolve-identity";

const catalog = [
  { id: "sup_nube", name: "Nube Hosting LLC" },
  { id: "sup_papeleria", name: "Papelería Central" },
  { id: "sup_diseno", name: "Diseño Studio" },
];

describe("classifySupplier", () => {
  it.each([
    ["Nube Hosting LLC", "sup_nube"],
    ["NUBE HOSTING, llc.", "sup_nube"],
    ["Nube Hosting", "sup_nube"], // el sufijo legal no cambia la identidad
    ["Papeleria Central", "sup_papeleria"], // sin tilde
    ["diseño studio s.a.s", "sup_diseno"],
  ])("matches %j exactly", (name, supplierId) => {
    expect(classifySupplier(name, catalog)).toEqual({ status: "matched", supplierId });
  });

  it("treats a similar but different name as ambiguous (a person confirms)", () => {
    expect(classifySupplier("Nube Hostings", catalog)).toMatchObject({ status: "ambiguous", candidateIds: ["sup_nube"] });
  });

  it("treats two catalog suppliers with the same base name as ambiguous", () => {
    const dup = [...catalog, { id: "sup_nube_2", name: "Nube Hosting Inc." }];
    expect(classifySupplier("Nube Hosting", dup)).toMatchObject({ status: "ambiguous" });
  });

  it.each([null, "", "LLC", "Proveedor Desconocido SpA"])("returns not_found for %j", (name) => {
    expect(classifySupplier(name, catalog)).toEqual({ status: "not_found" });
  });
});
