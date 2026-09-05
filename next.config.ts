import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Preview/sandbox hostnames are allowed to call the dev server.
  allowedDevOrigins: ["*.e2b.app", "localhost", "127.0.0.1"],
  serverExternalPackages: ["@prisma/client", "prisma", "unpdf", "mammoth", "pg"],
  experimental: {
    optimizePackageImports: ["lucide-react", "framer-motion"],
  },
  logging: {
    fetches: { fullUrl: false },
  },
};

export default nextConfig;
