import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Código generado por CLIs (shadcn/ui y AI Elements) y por el build de Workflow.
    // Se revisa en su fuente, no aquí; no se edita a mano.
    "src/components/ui/**",
    "src/components/ai-elements/**",
    "src/app/.well-known/**",
  ]),
]);

export default eslintConfig;
