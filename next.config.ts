import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  experimental: {
    serverActions: {
      // Neighborhood GeoJSON uploads go through a Server Action. Vercel caps
      // request bodies at 4.5 MB, so stay under it.
      bodySizeLimit: "4mb",
    },
  },
  async redirects() {
    // Short alias: /config/proyectos → /configuracion/proyectos.
    return [{ source: "/config/:path*", destination: "/configuracion/:path*", permanent: false }];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
