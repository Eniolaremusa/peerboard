import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  agentRules: false,
  transpilePackages: ["@excalidraw/excalidraw"],
};

export default nextConfig;
