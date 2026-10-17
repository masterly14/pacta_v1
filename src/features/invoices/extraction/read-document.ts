/**
 * Purpose: turn each document of an invoice group into plain text, the verifiable source for
 *   evidence. PDFs with a text layer are read locally; scanned PDFs and images go to the vision model.
 * Runs in: server and tests (I/O is injected through ReaderDeps).
 * Triggered by: extractInvoice().
 * Receives → Returns: SourceDocument → DocumentTranscript (pages marked "[[page N]]").
 * Talks to: ReaderDeps (unpdf and OpenAI vision in production, fakes in tests).
 */
import type { DocumentTranscript } from "./to-invoice-context";

export type SourceDocument = {
  documentId: string;
  kind: "pdf" | "image" | "email_body";
  mediaType: string;
  bytes: Uint8Array | null; // pdf e image
  text: string | null; // email_body
};

export type ReaderDeps = {
  extractPdfPages(bytes: Uint8Array): Promise<string[]>;
  transcribeWithVision(input: { bytes: Uint8Array; mediaType: string }): Promise<string>;
};

// Menos caracteres que esto en todo el PDF indica un escaneo sin capa de texto.
const MIN_PDF_TEXT_CHARS = 40;

export async function readDocument(doc: SourceDocument, deps: ReaderDeps): Promise<DocumentTranscript> {
  if (doc.kind === "email_body") {
    if (doc.text === null) throw new Error(`El documento ${doc.documentId} no trae texto`);
    return { documentId: doc.documentId, sourceType: "email_body", text: doc.text };
  }
  if (doc.bytes === null) throw new Error(`El documento ${doc.documentId} no trae contenido`);

  if (doc.kind === "pdf") {
    const pages = await deps.extractPdfPages(doc.bytes);
    if (pages.join("").trim().length >= MIN_PDF_TEXT_CHARS) {
      const text = pages.map((page, i) => `[[page ${i + 1}]]\n${page.trim()}`).join("\n\n");
      return { documentId: doc.documentId, sourceType: "invoice_document", text };
    }
  }

  const text = await deps.transcribeWithVision({ bytes: doc.bytes, mediaType: doc.mediaType });
  return { documentId: doc.documentId, sourceType: "invoice_document", text };
}
