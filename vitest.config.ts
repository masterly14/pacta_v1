import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  test: {
    include: ["src/**/*.test.ts"],
    // Usa node:test; se ejecuta con su propio comando en `npm test`.
    exclude: ["src/shared/auth/membership-role.test.ts", "node_modules/**"],
  },
});
