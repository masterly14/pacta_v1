import type { NextConfig } from "next";
import { withWorkflow } from "workflow/next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // El mock de Buk lee sus payloads de disco: Next debe empaquetarlos con la ruta.
  outputFileTracingIncludes: {
    "/api/mock/buk/*": ["./src/features/obligations/fixtures/buk/payloads/**/*"],
    // El flujo de nómina lee los mismos payloads desde sus server actions.
    "/obligations/*": ["./src/features/obligations/fixtures/buk/payloads/**/*"],
    "/api/cron/obligations": ["./src/features/obligations/fixtures/buk/payloads/**/*"],
    "/platform/runs": ["./src/features/obligations/fixtures/buk/payloads/**/*"],
    "/platform/obligations": ["./src/features/obligations/fixtures/buk/payloads/**/*"],
  },
  allowedDevOrigins: ["localhost:3000", "378a-200-3-154-136.ngrok-free.app"],
};

export default withWorkflow(nextConfig);
