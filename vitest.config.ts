import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  test: {
    include: ["src/**/*.test.ts"],
    // Las pruebas de integración comparten una base desechable y la vacían con TRUNCATE:
    // en paralelo se borrarían datos entre archivos.
    fileParallelism: !process.env.TEST_DATABASE_URL,
    // Usan node:test, no Vitest; se ejecutan con `npm run test:node`.
    exclude: [
      "node_modules/**",
      "src/shared/auth/membership-role.test.ts",
      "src/shared/schemas/gmail-contracts.test.ts",
      "src/features/invoices/gmail/gmail-backend.test.ts",
      "src/lib/r2.test.ts",
    ],
  },
});
