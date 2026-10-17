/**
 * Purpose: production wiring of ExtractDeps: unpdf for PDF text, OpenAI for images and scanned
 *   PDFs, DeepSeek for structured extraction. Calls are traced in Langfuse through the
 *   telemetry integration registered in src/instrumentation.ts.
 * Runs in: server only.
 * Triggered by: the invoice pipeline when it builds the dependencies for extractInvoice().
 * Receives → Returns: { organizationId, inboundMessageId } → ExtractDeps.
 * Talks to: OpenAI, DeepSeek (src/lib/ai.ts), unpdf, Langfuse.
 */
import { createOpenAI } from "@ai-sdk/openai";
import { generateText, Output } from "ai";
import { extractText } from "unpdf";
import { deepseek } from "@/lib/ai";
import { RawExtractionSchema } from "./raw-extraction.schema";
import { VISION_SYSTEM_PROMPT, EXTRACTION_SYSTEM_PROMPT } from "./prompt";
import type { ExtractDeps } from "./extract-invoice";

// Sin apiKey explícita, el proveedor lee OPENAI_API_KEY al hacer la llamada, no al importar.
const openai = createOpenAI();

const VISION_MODEL = process.env.OPENAI_VISION_MODEL ?? "gpt-4o-mini";
const EXTRACTION_MODEL = process.env.DEEPSEEK_EXTRACTION_MODEL ?? "deepseek-chat";

export function createExtractDeps(context: { organizationId: string; inboundMessageId: string }): ExtractDeps {
  // Solo ids técnicos van a la traza; el contenido de la factura es el prompt, ya gobernado por Langfuse.
  const telemetry = (functionId: string) => ({
    functionId,
    includeRuntimeContext: { organizationId: true, inboundMessageId: true },
  });

  return {
    async extractPdfPages(bytes) {
      const { text } = await extractText(new Uint8Array(bytes), { mergePages: false });
      return text;
    },

    async transcribeWithVision({ bytes, mediaType }) {
      const { text } = await generateText({
        model: openai(VISION_MODEL),
        system: VISION_SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "Transcribe this document." },
              { type: "file", mediaType, data: bytes },
            ],
          },
        ],
        runtimeContext: context,
        telemetry: telemetry("invoice-vision-transcription"),
      });
      return text;
    },

    async runExtraction({ prompt }) {
      const { output } = await generateText({
        model: deepseek(EXTRACTION_MODEL),
        system: EXTRACTION_SYSTEM_PROMPT,
        prompt,
        output: Output.object({ schema: RawExtractionSchema }),
        runtimeContext: context,
        telemetry: telemetry("invoice-extraction"),
      });
      return output;
    },
  };
}
