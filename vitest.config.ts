import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  test: {
    include: ["src/**/*.test.ts"],
    // Usan node:test, no Vitest; se ejecutan con `npm run test:node`.
    exclude: [
      "node_modules/**",
      "src/shared/auth/membership-role.test.ts",
      "src/shared/schemas/gmail-contracts.test.ts",
      "src/features/invoices/gmail/gmail-backend.test.ts",
      "src/lib/r2.test.ts",
      "src/features/payment-history/**/*.test.ts",
    ],
  },
});
