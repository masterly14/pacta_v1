/**
 * Purpose: orchestrate the AI extraction of one invoice group: read documents, ask the text model
 *   for structured claims, and convert them deterministically into a validated InvoiceContext.
 *   The LLM never decides anything; any failure returns { ok: false } and is never approved by default.
 * Runs in: server and tests (LLM and readers are injected).
 * Triggered by: the invoice pipeline (A-03) and the manual upload (A-05).
 * Receives → Returns: group documents + email metadata + ContextMeta → ExtractionResult.
 * Talks to: read-document.ts, prompt.ts, to-invoice-context.ts, to-receipt-facts.ts, ExtractDeps.
 */
import { buildExtractionPrompt } from "./prompt";
import { RawExtractionSchema, type RawExtraction } from "./raw-extraction.schema";
import { readDocument, type ReaderDeps, type SourceDocument } from "./read-document";
import { toReceiptFacts, type ReceiptFacts } from "./to-receipt-facts";
import {
  toInvoiceContext,
  type ContextMeta,
  type DocumentTranscript,
  type EmailMetadata,
  type IdentityResolution,
} from "./to-invoice-context";
import type { InvoiceContext } from "@/shared/schemas/invoice-context";

export type ExtractDeps = ReaderDeps & {
  // Llama al modelo de texto y devuelve su salida sin validar.
  runExtraction(input: { prompt: string }): Promise<unknown>;
};

export type ExtractionResult =
  // receipt ≠ null: el documento acredita un pago ya hecho y no debe evaluarse para pagar.
  | { ok: true; context: InvoiceContext; receipt: ReceiptFacts | null; transcripts: DocumentTranscript[] }
  | { ok: false; stage: "read" | "llm" | "validation" | "context"; error: string };

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

export async function extractInvoice(
  input: {
    documents: SourceDocument[];
    metadata: EmailMetadata;
    meta: ContextMeta;
    identity?: IdentityResolution;
  },
  deps: ExtractDeps,
): Promise<ExtractionResult> {
  if (input.documents.length === 0) {
    return { ok: false, stage: "read", error: "No hay documentos que leer" };
  }

  let transcripts: DocumentTranscript[];
  try {
    transcripts = await Promise.all(input.documents.map((doc) => readDocument(doc, deps)));
  } catch (error) {
    return { ok: false, stage: "read", error: messageOf(error) };
  }

  let output: unknown;
  try {
    output = await deps.runExtraction({ prompt: buildExtractionPrompt(input.metadata, transcripts) });
  } catch (error) {
    return { ok: false, stage: "llm", error: messageOf(error) };
  }

  const parsed = RawExtractionSchema.safeParse(output);
  if (!parsed.success) {
    return { ok: false, stage: "validation", error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
  }
  const raw: RawExtraction = parsed.data;

  const result = toInvoiceContext(raw, transcripts, input.meta, input.metadata, input.identity);
  if (!result.ok) return { ok: false, stage: "context", error: result.error };
  return { ok: true, context: result.context, receipt: toReceiptFacts(raw, transcripts), transcripts };
}
