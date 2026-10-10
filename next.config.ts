import type { NextConfig } from "next";
const config: NextConfig = {
  serverExternalPackages: ["@libsql/client"],
  async headers() {
    return [{ source: "/api/:path*", headers: [{key: "Cache-Control", value: "no-store"}, {key: "X-Content-Type-Options", value: "nosniff"}] }];
  },
};
export default config;
