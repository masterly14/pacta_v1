import { LangfuseVercelAiSdkIntegration } from "@langfuse/vercel-ai-sdk";

// Integración de telemetría de Langfuse para AI SDK v7.
// Se registra una sola vez en src/instrumentation.ts (ver registerTelemetry).
export const langfuseIntegration = new LangfuseVercelAiSdkIntegration();
