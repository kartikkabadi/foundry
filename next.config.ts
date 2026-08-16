import type { NextConfig } from "next";
import { withEve } from "eve/next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["vps.tailb387b4.ts.net", "100.70.218.15"],
  experimental: {
    serverActions: {
      allowedOrigins: ["vps.tailb387b4.ts.net:3100", "vps.tailb387b4.ts.net"],
    },
  },
};

export default withEve(nextConfig);
