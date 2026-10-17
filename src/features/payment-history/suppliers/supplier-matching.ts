import {
  AMBIGUITY_MARGIN,
  AUTO_CREATE_MIN_OCCURRENCES,
  FUZZY_SUGGEST_THRESHOLD,
  SAMPLE_DESCRIPTIONS_MAX,
} from "../config";
import type { BankTransaction } from "../schemas/bank-transaction";
import type { AssociationSkipped, SupplierCandidate, SupplierSuggestion } from "../schemas/supplier-association";
import { extractCounterpartyKey, isCleanKey, proposeSupplierName } from "./counterparty-key";

// Planificador PURO de la asociación movimiento ↔ proveedor. No lee ni escribe nada: decide qué se
// vincula (solo coincidencia exacta e inequívoca) y qué queda como sugerencia para una persona.

export type MatchTransaction = Pick<BankTransaction, "id" | "postedOn" | "amountMinor" | "supplierId" | "description">;
export type MatchSupplier = { id: string; name: string };

export type ExactLink = { key: string; supplierId: string; transactionIds: string[] };

export type AssociationPlan = {
  exact: ExactLink[];
  suggestions: SupplierSuggestion[];
  skipped: AssociationSkipped;
};

// ---------------------------------------------------------------------------
// Similitud (determinística, 0..1, dos decimales)
// ---------------------------------------------------------------------------

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    previous = current;
  }
  return previous[b.length];
}

// max(Dice de tokens, 1 − Levenshtein/longitud). Cubre nombres con tokens extra y errores de tecleo.
export function keySimilarity(a: string, b: string): number {
  if (a === b) return 1;
  const tokensA = new Set(a.split(" "));
  const tokensB = new Set(b.split(" "));
  let shared = 0;
  for (const token of tokensA) if (tokensB.has(token)) shared++;
  const dice = (2 * shared) / (tokensA.size + tokensB.size);
  const edit = 1 - levenshtein(a, b) / Math.max(a.length, b.length);
  return Math.round(Math.max(dice, edit) * 100) / 100;
}

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

type Group = { key: string; transactions: MatchTransaction[] };

export function planAssociation(
  transactions: readonly MatchTransaction[],
  suppliers: readonly MatchSupplier[],
): AssociationPlan {
  const skipped: AssociationSkipped = { inflows: 0, unclassifiable: 0, alreadyLinked: 0 };

  // La clave del proveedor sale de su nombre con el mismo extractor que los movimientos: así
  // "Hosting Demo Inc" (normalizedName "hosting demo inc") coincide con "COMPRA ... HOSTING DEMO".
  const suppliersByKey = new Map<string, MatchSupplier[]>();
  for (const supplier of suppliers) {
    const key = extractCounterpartyKey(supplier.name);
    if (key === null) continue;
    suppliersByKey.set(key, [...(suppliersByKey.get(key) ?? []), supplier]);
  }

  const groups = new Map<string, Group>();
  for (const transaction of transactions) {
    if (transaction.supplierId !== null) {
      skipped.alreadyLinked++;
      continue;
    }
    if (transaction.amountMinor >= 0) {
      skipped.inflows++;
      continue;
    }
    const key = extractCounterpartyKey(transaction.description);
    if (key === null) {
      skipped.unclassifiable++;
      continue;
    }
    const group = groups.get(key) ?? { key, transactions: [] };
    group.transactions.push(transaction);
    groups.set(key, group);
  }

  const exact: ExactLink[] = [];
  const suggestions: SupplierSuggestion[] = [];

  for (const group of [...groups.values()].sort((a, b) => a.key.localeCompare(b.key))) {
    const ordered = [...group.transactions].sort((a, b) => (a.postedOn === b.postedOn ? a.id.localeCompare(b.id) : a.postedOn < b.postedOn ? -1 : 1));
    const transactionIds = ordered.map((transaction) => transaction.id);
    const base = { key: group.key, occurrences: transactionIds.length, transactionIds };

    const sameKey = suppliersByKey.get(group.key) ?? [];
    if (sameKey.length === 1) {
      exact.push({ key: group.key, supplierId: sameKey[0].id, transactionIds });
      continue;
    }
    if (sameKey.length > 1) {
      // Dos proveedores del catálogo con la misma clave: no se elige uno por la persona.
      suggestions.push({
        kind: "ambiguous",
        ...base,
        candidates: sameKey.slice(0, 5).map((supplier) => ({ supplierId: supplier.id, supplierName: supplier.name, similarity: 1 })),
      });
      continue;
    }

    // Sin coincidencia exacta: candidatos parecidos (un proveedor por clave distinta).
    const candidates: SupplierCandidate[] = [];
    for (const [supplierKey, matching] of suppliersByKey) {
      const similarity = keySimilarity(group.key, supplierKey);
      if (similarity >= FUZZY_SUGGEST_THRESHOLD) {
        for (const supplier of matching) candidates.push({ supplierId: supplier.id, supplierName: supplier.name, similarity });
      }
    }
    candidates.sort((a, b) => b.similarity - a.similarity || a.supplierName.localeCompare(b.supplierName));

    if (candidates.length === 0) {
      suggestions.push({
        kind: "create_new",
        ...base,
        proposedName: proposeSupplierName(group.key),
        firstPostedOn: ordered[0].postedOn,
        lastPostedOn: ordered[ordered.length - 1].postedOn,
        sampleDescriptions: [...new Set(ordered.map((transaction) => transaction.description))].slice(0, SAMPLE_DESCRIPTIONS_MAX),
        // Solo claves limpias con varias apariciones y SIN candidato parecido: no se crean casi-duplicados.
        autoCreateEligible: base.occurrences >= AUTO_CREATE_MIN_OCCURRENCES && isCleanKey(group.key),
      });
    } else if (candidates.length === 1 || candidates[0].similarity - candidates[1].similarity > AMBIGUITY_MARGIN) {
      suggestions.push({ kind: "link_existing", ...base, candidate: candidates[0] });
    } else {
      suggestions.push({ kind: "ambiguous", ...base, candidates: candidates.slice(0, 5) });
    }
  }

  return { exact, suggestions, skipped };
}
