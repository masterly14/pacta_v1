import { registerOTel } from "@vercel/otel";
import { LangfuseSpanProcessor } from "@langfuse/otel";
import { registerTelemetry } from "ai";
import { langfuseIntegration } from "@/lib/langfuse";

// Next.js llama a register() una vez al arrancar el servidor.
export function register() {
  registerOTel({
    serviceName: "pacta",
    spanProcessors: [new LangfuseSpanProcessor()],
  });

  registerTelemetry(langfuseIntegration);
}
