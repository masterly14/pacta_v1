import type { NextConfig } from "next";
import { withWorkflow } from "workflow/next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  allowedDevOrigins: ["localhost:3000", "378a-200-3-154-136.ngrok-free.app"],
};

export default withWorkflow(nextConfig);
