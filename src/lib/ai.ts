import { createDeepSeek } from "@ai-sdk/deepseek";

// Proveedor de modelos: DeepSeek. Uso: deepseek("deepseek-chat") en agentes.
// La clave se lee de DEEPSEEK_API_KEY al hacer la llamada, no al importar.
export const deepseek = createDeepSeek({
  apiKey: process.env.DEEPSEEK_API_KEY,
});
