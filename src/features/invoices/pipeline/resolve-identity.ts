/**
 * Purpose: resolve which catalog supplier an extracted invoice belongs to (A-04) and compare it
 *   with that supplier's contract. Only an exact, unambiguous name match confirms a supplier;
 *   a similar name is `ambiguous` (escalates); nothing similar is `not_found`.
 * Runs in: server (Node); classifySupplier() is pure.
 * Triggered by: process-invoice.ts after the AI extraction.
 * Receives → Returns: (organizationId, extracted facts) → IdentityResolution
 *   { supplierId, supplierMatchStatus, contractMatch }.
 * Talks to: db (Supplier read only), contracts/server#findContractMatch, policies/normalize,
 *   payment-history (keySimilarity, LEGAL_SUFFIXES, FUZZY_SUGGEST_THRESHOLD) for the same criterion.
 */
import { db } from "@/lib/db";
import { findContractMatch } from "@/features/contracts/server";
import { FUZZY_SUGGEST_THRESHOLD, LEGAL_SUFFIXES } from "@/features/payment-history/config";
import { keySimilarity } from "@/features/payment-history/suppliers/supplier-matching";
import { normalizeSupplierName } from "@/features/policies/normalize";
import type { InvoiceContext } from "@/shared/schemas/invoice-context";
import type { IdentityResolution } from "../extraction/to-invoice-context";

export type CatalogSupplier = { id: string; name: string };

export type SupplierClassification =
  | { status: "matched"; supplierId: string }
  | { status: "ambiguous"; candidateIds: string[] }
  | { status: "not_found" };

// "S.A.S." se normaliza como "s a s": las letras sueltas consecutivas se unen ("sas").
function joinInitials(tokens: string[]): string[] {
  const out: string[] = [];
  for (const token of tokens) {
    const last = out.at(-1);
    if (token.length === 1 && last !== undefined && /^[a-z]+$/.test(last) && last.length <= 3 && tokens.length > 1) {
      out[out.length - 1] = last + token;
    } else {
      out.push(token);
    }
  }
  return out;
}

// "Nube Hosting LLC" y "nube hosting" son el mismo nombre: se ignoran los sufijos legales.
function baseName(name: string): string {
  const tokens = normalizeSupplierName(name).split(" ").filter((token) => token.length > 0);
  return joinInitials(tokens)
    .filter((token) => !LEGAL_SUFFIXES.has(token))
    .join(" ");
}

// Mismo criterio que la asociación de movimientos bancarios: solo lo exacto vincula.
export function classifySupplier(extractedName: string | null, suppliers: readonly CatalogSupplier[]): SupplierClassification {
  if (extractedName === null) return { status: "not_found" };
  const target = baseName(extractedName);
  if (target === "") return { status: "not_found" };

  const exact = suppliers.filter((s) => baseName(s.name) === target);
  if (exact.length === 1) return { status: "matched", supplierId: exact[0].id };
  if (exact.length > 1) return { status: "ambiguous", candidateIds: exact.map((s) => s.id) };

  const similar = suppliers.filter((s) => {
    const candidate = baseName(s.name);
    return candidate !== "" && keySimilarity(candidate, target) >= FUZZY_SUGGEST_THRESHOLD;
  });
  return similar.length > 0 ? { status: "ambiguous", candidateIds: similar.map((s) => s.id) } : { status: "not_found" };
}

export async function resolveIdentity(organizationId: string, invoice: InvoiceContext): Promise<IdentityResolution> {
  const suppliers = await db.supplier.findMany({ where: { organizationId }, select: { id: true, name: true } });
  const classification = classifySupplier(invoice.name, suppliers);
  if (classification.status !== "matched") {
    return { supplierId: null, supplierMatchStatus: classification.status, contractMatch: null };
  }
  const contractMatch = await findContractMatch(organizationId, {
    supplierId: classification.supplierId,
    amountMinor: invoice.amountMinor,
    currency: invoice.currency,
    invoiceDate: invoice.invoiceDate,
    beneficiaryAccountReference: invoice.beneficiaryAccountReference,
  });
  return { supplierId: classification.supplierId, supplierMatchStatus: "matched", contractMatch };
}
