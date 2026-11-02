import { ogImage, ogSize } from "@/lib/og";
import { siteConfig } from "@/lib/seo";

export const alt = `${siteConfig.displayName}: type-safe CRUD for Drizzle ORM in NestJS`;
export const dynamic = "force-static";
export const size = ogSize;
export const contentType = "image/png";
export const revalidate = false;

export default function Image() {
	return ogImage(
		siteConfig.tagline,
		`Configure once. Every entity gets full CRUD. v${siteConfig.version}`,
	);
}
