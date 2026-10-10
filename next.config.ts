import type { NextConfig } from "next";
const config: NextConfig = {
  turbopack: { root: process.cwd() },
  // Avoid repeated cache compaction failures on this workspace's full disk.
  experimental: { turbopackFileSystemCacheForDev: false },
  devIndicators: false,
  serverExternalPackages: ["@libsql/client"],
  outputFileTracingIncludes: { "/api/*": ["./drizzle/*.sql", "./ml/models/*.json"] },
  async headers() {
    return [{ source: "/api/:path*", headers: [{key: "Cache-Control", value: "no-store"}, {key: "X-Content-Type-Options", value: "nosniff"}] }];
  },
};
export default config;
