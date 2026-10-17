/**
 * Purpose: compare an invoice's extracted facts with the supplier's registered contracts
 *   and describe the result as a ContractMatch (matched, mismatch, ambiguous or not_found).
 *   Evidence only: a matching contract never authorizes a payment.
 * Runs in: server and tests (pure, no DB, AI or clock).
 * Triggered by: findContractMatch() and, later, the invoice context builder.
 * Receives → Returns: (ContractMatchInvoiceFacts, MatchableContract[]) → ContractMatch | null,
 *   validated by ContractMatchSchema; null when the supplier is not confirmed.
 * Talks to: src/shared/schemas/invoice-context.ts, ./money.ts.
 */
import {
  ContractMatchSchema,
  type ContractMatch,
  type EvidenceReference,
} from "@/shared/schemas/invoice-context";
import { formatMinor } from "./money";

export type ContractFrequency = "one_time" | "weekly" | "monthly" | "quarterly" | "yearly";

// Datos de la factura que usa la comparación (subconjunto de InvoiceContext).
export type ContractMatchInvoiceFacts = {
  supplierId: string | null;
  amountMinor: number | null;
  currency: string | null;
  invoiceDate: string | null; // YYYY-MM-DD
  beneficiaryAccountReference: string | null;
};

// Contrato registrado, en forma plana (fechas de calendario como texto).
export type MatchableContract = {
  contractId: string;
  supplierId: string;
  status: "active" | "terminated";
  agreedAmountMinor: number;
  currency: string;
  frequency: ContractFrequency;
  validFrom: string; // YYYY-MM-DD
  validTo: string | null; // null = sin fecha de fin
  beneficiaryAccountRef: string | null;
};

type Discrepancy = ContractMatch["discrepancies"][number];

const DAY_MS = 86_400_000;

export function matchContract(
  invoice: ContractMatchInvoiceFacts,
  contracts: MatchableContract[],
): ContractMatch | null {
  // Sin proveedor confirmado no se sabe qué contratos mirar: no se compara.
  if (invoice.supplierId === null) {
    return null;
  }

  const candidates = contracts
    .filter((c) => c.supplierId === invoice.supplierId && c.status === "active")
    .sort((a, b) => a.contractId.localeCompare(b.contractId));

  if (candidates.length === 0) {
    return finalize({ ...emptyMatch(), matchStatus: "not_found" });
  }

  // Sin fecha no se puede saber qué contrato estaba vigente.
  if (invoice.invoiceDate === null) {
    return finalize({ ...emptyMatch(), matchStatus: "ambiguous", evidence: candidates.map(contractEvidence) });
  }
  const invoiceDate = invoice.invoiceDate;

  const inForce = candidates.filter((c) => isInForce(c, invoiceDate));
  if (inForce.length > 1) {
    return finalize({ ...emptyMatch(), matchStatus: "ambiguous", evidence: inForce.map(contractEvidence) });
  }

  if (inForce.length === 1) {
    return compare(invoice, inForce[0], []);
  }

  // Ninguno vigente: se compara con el más cercano y se informa el periodo.
  const closest = candidates.reduce((best, c) =>
    distanceInDays(c, invoiceDate) < distanceInDays(best, invoiceDate) ? c : best,
  );
  const period: Discrepancy = {
    field: "period",
    expected: `${closest.validFrom} to ${closest.validTo ?? "open-ended"}`,
    actual: invoiceDate,
    description: `Invoice date ${invoiceDate} is outside the contract validity period.`,
  };
  return compare(invoice, closest, [period]);
}

function compare(
  invoice: ContractMatchInvoiceFacts,
  contract: MatchableContract,
  initial: Discrepancy[],
): ContractMatch {
  const discrepancies = [...initial];
  const agreed = formatMinor(contract.agreedAmountMinor, contract.currency);

  if (invoice.currency !== contract.currency) {
    discrepancies.push({
      field: "currency",
      expected: contract.currency,
      actual: invoice.currency,
      description:
        invoice.currency === null
          ? `Invoice currency is unknown; the contract is in ${contract.currency}.`
          : `Invoice is in ${invoice.currency}; the contract is in ${contract.currency}.`,
    });
  } else if (invoice.amountMinor !== contract.agreedAmountMinor) {
    // Comparación exacta: cualquier diferencia escala, nunca aprueba.
    const actual = invoice.amountMinor === null ? null : formatMinor(invoice.amountMinor, contract.currency);
    discrepancies.push({
      field: "amount",
      expected: agreed,
      actual,
      description:
        actual === null
          ? `Invoice amount is unknown; the contract agrees ${agreed}.`
          : `Invoice amount ${actual} differs from the agreed ${agreed}.`,
    });
  }

  const contractAccount = contract.beneficiaryAccountRef;
  const invoiceAccount = invoice.beneficiaryAccountReference;
  if (contractAccount !== null && invoiceAccount !== null && contractAccount !== invoiceAccount) {
    discrepancies.push({
      field: "beneficiary_account",
      expected: contractAccount,
      actual: invoiceAccount,
      description: `Invoice asks for payment to ${invoiceAccount}; the contract names ${contractAccount}.`,
    });
  }

  return finalize({
    contractId: contract.contractId,
    matchStatus: discrepancies.length === 0 ? "matched" : "mismatch",
    agreedAmountMinor: contract.agreedAmountMinor,
    currency: contract.currency,
    frequency: contract.frequency,
    validFrom: contract.validFrom,
    validTo: contract.validTo,
    discrepancies,
    evidence: [contractEvidence(contract)],
  });
}

function emptyMatch(): ContractMatch {
  return {
    contractId: null,
    matchStatus: "not_found",
    agreedAmountMinor: null,
    currency: null,
    frequency: null,
    validFrom: null,
    validTo: null,
    discrepancies: [],
    evidence: [],
  };
}

// Fail-closed: si el resultado no cumple el contrato compartido, lanza.
function finalize(match: ContractMatch): ContractMatch {
  return ContractMatchSchema.parse(match);
}

function isInForce(contract: MatchableContract, date: string): boolean {
  // YYYY-MM-DD se ordena igual como texto que como fecha.
  return contract.validFrom <= date && (contract.validTo === null || date <= contract.validTo);
}

function distanceInDays(contract: MatchableContract, date: string): number {
  const day = Date.parse(date);
  if (date < contract.validFrom) {
    return (Date.parse(contract.validFrom) - day) / DAY_MS;
  }
  return contract.validTo === null ? 0 : (day - Date.parse(contract.validTo)) / DAY_MS;
}

// Contratos registrados a mano: la evidencia es la entrada manual, no un documento.
function contractEvidence(contract: MatchableContract): EvidenceReference {
  const terms = [
    formatMinor(contract.agreedAmountMinor, contract.currency),
    contract.frequency,
    `valid ${contract.validFrom} to ${contract.validTo ?? "open-ended"}`,
    contract.beneficiaryAccountRef === null ? null : `account ${contract.beneficiaryAccountRef}`,
  ].filter((part): part is string => part !== null);
  return {
    evidenceId: `contract:${contract.contractId}`,
    sourceType: "manual_entry",
    documentId: null,
    field: "contractMatch",
    page: null,
    excerpt: `Contract ${contract.contractId}: ${terms.join(", ")}`,
  };
}
