import type { NextConfig } from "next";

const allowedDevOrigins =
  process.env.NEXT_ALLOWED_DEV_ORIGINS?.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean) ?? [];

const nextConfig: NextConfig = {
  ...(allowedDevOrigins.length > 0 ? { allowedDevOrigins } : {}),
  // The link preview picture reads these from disk when drawn.
  outputFileTracingIncludes: {
    "/social-card": ["./src/app/social-card/assets/**"],
  },
};

export default nextConfig;
