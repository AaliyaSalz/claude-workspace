import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        // Shared conversations (/?token=...) are private: never index them,
        // never follow their links, and don't leak the token in the Referer header.
        source: "/",
        has: [{ type: "query", key: "token" }],
        headers: [
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
          { key: "Referrer-Policy", value: "no-referrer" },
        ],
      },
    ];
  },
};

export default nextConfig;
