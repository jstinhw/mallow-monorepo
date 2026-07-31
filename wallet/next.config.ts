import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @mallow/agents-protocol is a workspace package shipped as TypeScript source.
  transpilePackages: ["@mallow/agents-protocol"],
};

export default nextConfig;
