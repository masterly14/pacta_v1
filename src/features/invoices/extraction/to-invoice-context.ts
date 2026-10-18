/**
 * Purpose: deterministic conversion of an untrusted RawExtraction into a validated InvoiceContext.
 *   Amounts become integer minor units without floats, the account is masked, dates are checked,
 *   missingFields is computed from the nulls and evidence is kept only when its excerpt really
 *   appears in the source text. Anything unparseable becomes null plus a warning, never a guess.
 *   Account-like numbers in stored free text (excerpts, subject, body, description) are masked.
 * Runs in: server and tests (pure, no I/O).
 * Triggered by: extractInvoice() after the LLM call.
 * Receives → Returns: (RawExtraction, transcripts, meta) → { ok: true, context } | { ok: false, error }.
 * Talks to: contracts/money.ts (amount parsing), shared InvoiceContextSchema (last barrier).
 */
import { z } from "zod";
import { parseAmountToMinor } from "@/features/contracts/money";
import {
  CalendarDateSchema,
  InvoiceContextSchema,
  type EvidenceReference,
  type InvoiceContext,
  type InvoiceMissingField,
} from "@/shared/schemas/invoice-context";
import type { RawClaim, RawExtraction } from "./raw-extraction.schema";

export type DocumentTranscript = {
  documentId: string;
  sourceType: "invoice_document" | "email_body";
  // Texto leído del documento; las páginas van marcadas como "[[page N]]".
  text: string;
};

// Datos del correo tal como los entrega Gmail (hechos, no inferencias). Todo null en carga manual.
export type EmailMetadata = {
  senderName: string | null;
  senderEmail: string | null;
  subject: string | null;
  attachmentFilenames: string[];
};

export type ContextMeta = {
  invoiceId: string;
  organizationId: string;
  source: "email" | "dashboard";
  sourceAccountId: string | null;
  sourceMessageId: string | null;
  documentId: string | null;
  documentType: InvoiceContext["documentType"];
  receivedAt: string;
};

// Identidad del proveedor y contrato: la fija A-04. Por defecto, "no confirmado" (nunca aprueba).
export type IdentityResolution = Pick<
  InvoiceContext,
  "supplierId" | "supplierMatchStatus" | "contractMatch"
>;

export const UNRESOLVED_IDENTITY: IdentityResolution = {
  supplierId: null,
  supplierMatchStatus: "not_found",
  contractMatch: null,
};

export type ToContextResult = { ok: true; context: InvoiceContext } | { ok: false; error: string };

type Warning = InvoiceContext["extractionWarnings"][number];

const PAGE_MARKER = /\[\[page (\d+)\]\]/g;

const squash = (text: string) => text.replace(/\s+/g, " ").trim().toLowerCase();

const clean = (value: string | null): string | null => {
  const trimmed = value?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
};

// Secuencias de 10+ dígitos (con espacios o guiones): cuentas, IBAN, tarjetas. Las fechas
// (8 dígitos) y los montos normales no coinciden.
const ACCOUNT_LIKE = /\d(?:[ -]?\d){9,}/g;

// El InvoiceContext se guarda con cada decisión: el texto libre nunca lleva una cuenta completa.
export function redactAccountNumbers(text: string): string {
  return text.replace(ACCOUNT_LIKE, (match) => `****${match.replace(/\D/g, "").slice(-4)}`);
}

// Busca el fragmento en los textos fuente (ignorando espacios y mayúsculas) y devuelve dónde.
export function locateExcerpt(excerpt: string, transcripts: DocumentTranscript[]) {
  const needle = squash(excerpt);
  if (needle === "") return null;
  for (const transcript of transcripts) {
    // Se recorre página por página para poder informar la página real.
    const parts = transcript.text.split(PAGE_MARKER);
    // split con grupo de captura: [texto0, "1", texto1, "2", texto2…]
    for (let i = 0; i < parts.length; i += 2) {
      if (squash(parts[i]).includes(needle)) {
        const page = i === 0 ? null : Number(parts[i - 1]);
        return { transcript, page: page !== null && page > 0 ? page : null };
      }
    }
    if (squash(transcript.text.replace(PAGE_MARKER, " ")).includes(needle)) {
      return { transcript, page: null };
    }
  }
  return null;
}

function maskAccount(value: string): string | null {
  const alnum = value.replace(/[^A-Za-z0-9]/g, "");
  return alnum.length >= 4 ? `****${alnum.slice(-4)}` : null;
}

export function toInvoiceContext(
  raw: RawExtraction,
  transcripts: DocumentTranscript[],
  meta: ContextMeta,
  metadata: EmailMetadata,
  identity: IdentityResolution = UNRESOLVED_IDENTITY,
): ToContextResult {
  const warnings: Warning[] = [];
  const evidence: EvidenceReference[] = [];
  const warn = (code: string, message: string, field: string | null) => warnings.push({ code, message, field });

  if (!raw.isInvoice) {
    warn("NOT_AN_INVOICE", "El modelo indicó que el documento no parece una factura", null);
  }
  if (raw.injectionSuspected) {
    warn("PROMPT_INJECTION_SUSPECTED", "El documento contiene texto que intenta dar instrucciones; se ignoró", null);
  }

  // Registra evidencia solo si el fragmento existe en la fuente.
  const addEvidence = (field: string, claim: RawClaim) => {
    const excerpt = clean(claim.excerpt);
    if (excerpt === null) {
      warn("NO_EVIDENCE", `Sin fragmento que respalde ${field}`, field);
      return;
    }
    const found = locateExcerpt(excerpt, transcripts);
    if (found === null) {
      warn("EXCERPT_NOT_FOUND", `El fragmento de ${field} no aparece en el documento`, field);
      return;
    }
    evidence.push({
      evidenceId: `ev_${field}`,
      sourceType: found.transcript.sourceType,
      documentId: found.transcript.documentId,
      field,
      page: found.page,
      excerpt: redactAccountNumbers(excerpt).slice(0, 1000),
    });
  };

  const text = (field: string, claim: RawClaim): string | null => {
    const value = clean(claim.value);
    if (value !== null) addEvidence(field, claim);
    return value;
  };

  const invoiceNumber = text("invoiceNumber", raw.invoiceNumber);
  // `name`: lo que dice el documento; si no consta, el remitente del correo (con advertencia).
  // No identifica al proveedor: de eso se encarga A-04.
  let name = text("name", raw.supplierName);
  if (name === null) {
    name = clean(metadata.senderName);
    if (name !== null) warn("NAME_FROM_SENDER", "El nombre proviene del remitente del correo, no del documento", "name");
  }
  if (name !== null && name.length > 200) {
    name = name.slice(0, 200);
    warn("NAME_TRUNCATED", "El nombre se truncó a 200 caracteres", "name");
  }

  let email: string | null = clean(metadata.senderEmail)?.toLowerCase() ?? null;
  if (email !== null && !z.email().safeParse(email).success) {
    warn("EMAIL_INVALID", "El remitente no es un correo válido", "email");
    email = null;
  }

  const rawSubject = clean(metadata.subject);
  const subject = rawSubject === null ? null : redactAccountNumbers(rawSubject).slice(0, 998);

  let body: string | null = null;
  const bodyTranscript = transcripts.find((t) => t.sourceType === "email_body");
  if (bodyTranscript) {
    const rawBody = clean(bodyTranscript.text);
    body = rawBody === null ? null : redactAccountNumbers(rawBody);
    if (body !== null && body.length > 100_000) {
      body = body.slice(0, 100_000);
      warn("BODY_TRUNCATED", "El cuerpo del correo se truncó a 100000 caracteres", "body");
    }
  }
  const rawDescription = text("description", raw.description);
  const description = rawDescription === null ? null : redactAccountNumbers(rawDescription);

  // Cuenta: se enmascara aquí; el valor completo no sale de esta función.
  let beneficiaryAccountReference: string | null = null;
  const accountValue = clean(raw.beneficiaryAccount.value);
  if (accountValue !== null) {
    beneficiaryAccountReference = maskAccount(accountValue);
    if (beneficiaryAccountReference === null) {
      warn("ACCOUNT_UNUSABLE", "La cuenta beneficiaria es demasiado corta para referenciarla", "beneficiaryAccountReference");
    }
    // Sin evidencia a propósito: el fragmento contendría la cuenta completa.
  }

  // Moneda e importe: ninguno se asume si el otro falla.
  let currency: string | null = null;
  const currencyValue = clean(raw.currency.value)?.toUpperCase() ?? null;
  if (currencyValue !== null) {
    if (/^[A-Z]{3}$/.test(currencyValue)) {
      currency = currencyValue;
      addEvidence("currency", raw.currency);
    } else {
      warn("CURRENCY_INVALID", "La moneda no es un código ISO 4217 de tres letras", "currency");
    }
  }

  let amountMinor: number | null = null;
  const amountValue = clean(raw.amount.value);
  if (amountValue !== null) {
    if (currency === null) {
      warn("AMOUNT_WITHOUT_CURRENCY", "Hay importe pero no moneda comparable; se descarta el importe", "amountMinor");
    } else {
      const parsed = parseAmountToMinor(amountValue, currency);
      if (!parsed.ok) {
        warn("AMOUNT_UNPARSEABLE", parsed.error, "amountMinor");
      } else if (parsed.amountMinor <= 0) {
        warn("AMOUNT_NOT_POSITIVE", "El importe extraído no es positivo; se trata como desconocido", "amountMinor");
      } else {
        amountMinor = parsed.amountMinor;
        addEvidence("amountMinor", raw.amount);
      }
    }
  }
  // Un importe sin leer deja la moneda sin respaldo útil, pero la moneda sola es válida.

  const date = (field: "invoiceDate" | "dueDate", claim: RawClaim): string | null => {
    const value = clean(claim.value);
    if (value === null) return null;
    const parsed = CalendarDateSchema.safeParse(value);
    if (!parsed.success) {
      warn("DATE_INVALID", `${field} no es una fecha YYYY-MM-DD válida`, field);
      return null;
    }
    addEvidence(field, claim);
    return parsed.data;
  };
  const invoiceDate = date("invoiceDate", raw.invoiceDate);
  const dueDate = date("dueDate", raw.dueDate);

  const values = { invoiceNumber, name, email, subject, body, beneficiaryAccountReference, amountMinor, currency, description, invoiceDate, dueDate };
  const missingFields = (Object.keys(values) as InvoiceMissingField[]).filter((field) => values[field] === null);

  const candidate = {
    schemaVersion: 1 as const,
    invoiceId: meta.invoiceId,
    organizationId: meta.organizationId,
    invoiceNumber,
    source: meta.source,
    sourceAccountId: meta.sourceAccountId,
    sourceMessageId: meta.sourceMessageId,
    documentId: meta.documentId,
    documentType: meta.documentType,
    receivedAt: meta.receivedAt,
    ...identity,
    name,
    email,
    subject,
    body,
    beneficiaryAccountReference,
    amountMinor,
    currency,
    description,
    invoiceDate,
    dueDate,
    missingFields,
    extractionWarnings: warnings,
    evidence,
  };

  const parsed = InvoiceContextSchema.safeParse(candidate);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
  }
  return { ok: true, context: parsed.data };
}
