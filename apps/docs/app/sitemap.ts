import type { MetadataRoute } from "next";
import { lastModified } from "@/lib/doc-history";
import { siteConfig } from "@/lib/seo";
import { source } from "@/lib/source";

export const dynamic = "force-static";
export const revalidate = false;

/**
 * The home page plus every docs page, once each, at its canonical URL.
 *
 * `lastModified` is the date git last touched the page's file, not the build time: a lastmod
 * that changes on every deploy says nothing, and search engines learn to ignore it. A page whose
 * date cannot be read goes out without one.
 */
export default function sitemap(): MetadataRoute.Sitemap {
	const home: MetadataRoute.Sitemap = [{ url: siteConfig.url, priority: 1.0 }];

	const docs: MetadataRoute.Sitemap = source.getPages().map((page) => ({
		url: `${siteConfig.url}${page.url}`,
		lastModified: lastModified(page.path) ?? undefined,
		changeFrequency: "weekly" as const,
		priority: page.url === "/docs" ? 0.9 : 0.7,
	}));

	return [...home, ...docs];
}
