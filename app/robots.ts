import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

// Served at /robots.txt. Crawlers may read the whole site except the API.
// Shared conversations (?token=...) stay crawlable on purpose: they send an
// X-Robots-Tag: noindex header (see next.config.ts), and a crawler has to be
// allowed to fetch a page to see that header.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: "/api/",
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
