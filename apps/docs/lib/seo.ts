import type { Metadata } from "next";

export const siteConfig = {
	name: "nestjs-drizzle-crud", // the npm package: structured data, llms.txt, install commands
	displayName: "Nestjs Drizzle", // what readers see: header, tab titles, site name
	logo: "/avytrix-icon.png", // Avytrix Technologies mark
	version: "3.5.0",
	tagline: "Type-safe CRUD for Drizzle ORM in NestJS",
	description:
		"Type-safe CRUD for Drizzle ORM in NestJS. Configure the connection once, and every entity gets full CRUD: find, create, update, soft-delete, bulk ops, pagination, filtering, relations and full-text search.",
	url: (process.env.NEXT_PUBLIC_SITE_URL ?? "https://crud.avytrix.dev").replace(
		/\/+$/,
		"",
	),
	github: "https://github.com/avytrix/nestjs-drizzle-crud",
	npm: "https://www.npmjs.com/package/nestjs-drizzle-crud",
	sponsor: "https://github.com/sponsors/avytrix",
	author: "Suman Bonakurthi",
	license: "MIT",
	/** The company behind the package, credited in the footer. */
	organization: {
		name: "Avytrix Technologies",
		url: "https://avytrix.dev",
		github: "https://github.com/avytrix",
	},
	/** Where the docs sources live, for "edit on GitHub" and page history links. */
	git: {
		repo: "avytrix/nestjs-drizzle-crud",
		branch: "main",
		contentDir: "apps/docs/content/docs",
	},
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
 * Per-page metadata. Returns Next.js `Metadata` with a self canonical, merged keywords, and
 * OpenGraph/Twitter cards. Docs pages pass their own card (`image`); everything else falls back
 * to the site-wide one in app/opengraph-image.tsx, which Next attaches by itself.
 */
export function createMetadata(params?: {
	title?: string;
	description?: string;
	/** Absolute path, e.g. "/docs/installation". Defaults to the home page. */
	path?: string;
	keywords?: string[];
	ogType?: "website" | "article";
	/** Path of a per-page sharing card. */
	image?: string;
}): Metadata {
	const description = params?.description ?? siteConfig.description;
	const path = params?.path ?? "/";
	const url = new URL(path, siteConfig.url).toString();
	const heading = params?.title
		? `${params.title} · ${siteConfig.displayName}`
		: ogTitle;
	const images = params?.image ? [params.image] : undefined;

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
			...(images ? { images } : {}),
		},
		twitter: {
			card: "summary_large_image",
			title: heading,
			description,
			...(images ? { images } : {}),
		},
	};
}
