import type { Metadata } from "next";

export const siteConfig = {
	name: "nestjs-drizzle-crud", // the npm package: structured data, llms.txt, install commands
	displayName: "Nestjs Drizzle", // what readers see: header, tab titles, site name
	logo: "/avytrix-icon.png", // Avytrix Technologies mark
	version: "3.5.0",
	tagline: "Type-safe CRUD for Drizzle ORM in NestJS",
	description:
		"Type-safe CRUD for Drizzle ORM in NestJS. Configure the connection once, and every entity gets full CRUD: find, create, update, soft-delete, bulk ops, pagination, filtering, relations and full-text search.",
	url: process.env.NEXT_PUBLIC_SITE_URL ?? "https://crud.avytrix.dev",
	github: "https://github.com/avytrix/nestjs-drizzle-crud",
	npm: "https://www.npmjs.com/package/nestjs-drizzle-crud",
	sponsor: "https://github.com/sponsors/avytrix",
	author: "Suman Bonakurthi",
	license: "MIT",
	repoPath: "blob/main/content/docs",
	// Target search terms, merged into every page's keywords.
	keywords: [
		"nestjs",
		"drizzle",
		"drizzle-orm",
		"nestjs crud",
		"drizzle crud",
		"nestjs drizzle",
		"nestjs drizzle crud",
		"type-safe crud",
		"typescript orm",
		"crud abstraction",
		"crud generator",
		"rest api",
		"postgresql",
		"mysql",
		"soft delete",
		"pagination",
		"full-text search",
		"database",
		"nodejs",
		"typescript",
	],
};

export type SiteConfig = typeof siteConfig;

const ogTitle = `${siteConfig.displayName}: ${siteConfig.tagline}`;

/**
 * Per-page metadata factory. Returns Next.js `Metadata` with a canonical URL,
 * merged keywords, and OpenGraph/Twitter cards. The site-wide OG image
 * (app/opengraph-image.tsx) is attached automatically by Next.
 */
export function createMetadata(params?: {
	title?: string;
	description?: string;
	/** Absolute path, e.g. "/docs/installation". Defaults to the home page. */
	path?: string;
	keywords?: string[];
	ogType?: "website" | "article";
}): Metadata {
	const description = params?.description ?? siteConfig.description;
	const path = params?.path ?? "/";
	const url = new URL(path, siteConfig.url).toString();
	const heading = params?.title ? `${params.title} · ${siteConfig.displayName}` : ogTitle;

	return {
		title: params?.title,
		description,
		keywords: [...siteConfig.keywords, ...(params?.keywords ?? [])],
		alternates: { canonical: path },
		openGraph: {
			type: params?.ogType ?? "website",
			url,
			siteName: siteConfig.displayName,
			title: heading,
			description,
			locale: "en_US",
		},
		twitter: {
			card: "summary_large_image",
			title: heading,
			description,
		},
	};
}

// --- JSON-LD structured data (schema.org) for rich results ---

export const websiteJsonLd = {
	"@context": "https://schema.org",
	"@type": "WebSite",
	name: siteConfig.name,
	url: siteConfig.url,
	description: siteConfig.description,
};

export const softwareJsonLd = {
	"@context": "https://schema.org",
	"@type": "SoftwareSourceCode",
	name: siteConfig.name,
	description: siteConfig.description,
	codeRepository: siteConfig.github,
	programmingLanguage: "TypeScript",
	runtimePlatform: "Node.js",
	license: "https://opensource.org/licenses/MIT",
	author: { "@type": "Person", name: siteConfig.author },
	keywords: siteConfig.keywords.join(", "),
	url: siteConfig.url,
	softwareVersion: siteConfig.version,
};

export function articleJsonLd(params: {
	title: string;
	description?: string;
	path: string;
}) {
	return {
		"@context": "https://schema.org",
		"@type": "TechArticle",
		headline: params.title,
		description: params.description ?? siteConfig.description,
		url: new URL(params.path, siteConfig.url).toString(),
		author: { "@type": "Person", name: siteConfig.author },
		isPartOf: { "@type": "WebSite", name: siteConfig.name, url: siteConfig.url },
	};
}
