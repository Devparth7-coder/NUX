/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: {
    serverActions: { bodySizeLimit: '25mb' },
  },
  allowedDevOrigins: [
    '*.e2b.app',
    '*.arena.ai',
    'localhost',
  ],
  serverExternalPackages: ['@prisma/client', 'adm-zip'],
  images: { dangerouslyAllowSVG: true },
};
export default nextConfig;
