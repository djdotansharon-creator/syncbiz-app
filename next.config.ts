import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["youtube-search-without-api-key", "jsonpath", "got", "yt-dlp-wrap"],
};

export default nextConfig;
