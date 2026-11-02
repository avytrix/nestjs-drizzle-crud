import type { Metadata } from "next";

export const siteConfig = {
	name: "@avytrix/nestjs-drizzle-crud", // the npm package: structured data, llms.txt, install commands
	project: "nestjs-drizzle-crud", // the project and repository name, used in prose
	/** The npm name before the move to the @avytrix scope (3.5.1). Deprecated on npm. */
	formerName: "nestjs-drizzle-crud",
	mcpBin: "nestjs-drizzle-crud-mcp",
	displayName: "Nestjs Drizzle", // what readers see: header, tab titles, site name
	logo: "/avytrix-icon.png", // Avytrix Technologies mark
	version: "3.5.1",
	tagline: "Type-safe CRUD for Drizzle ORM in NestJS",
	/** The home page <title>: the primary query first, the display name last, at most 60 characters. */
	homeTitle: "NestJS + Drizzle ORM CRUD library | Nestjs Drizzle",
	description:
		"NestJS + Drizzle ORM CRUD: type-safe services with filtering, pagination, relations, soft delete, upsert and multi-tenancy for PostgreSQL and MySQL.",
	url: (process.env.NEXT_PUBLIC_SITE_URL ?? "https://crud.avytrix.dev").replace(
		/\/+$/,
		"",
	),
	github: "https://github.com/avytrix/nestjs-drizzle-crud",
	npm: "https://www.npmjs.com/package/@avytrix/nestjs-drizzle-crud",
	sponsor: "https://github.com/sponsors/avytrix",
	author: "Suman Bonakurthi",
	license: "MIT",
	/** The company behind the package, credited in the footer. */
	organization: {
		name: "Avytrix Technologies",
		url: "https://avytrix.dev",
		contact: "https://avytrix.dev/contact",
		email: "hello@avytrix.dev",
		github: "https://github.com/avytrix",
		/** The profiles avytrix.dev itself links to, in its footer. Nothing else goes in sameAs. */
		profiles: [
			{ name: "GitHub", url: "https://github.com/avytrix" },
			{ name: "LinkedIn", url: "https://www.linkedin.com/company/avytrix" },
			{ name: "Facebook", url: "https://www.facebook.com/myavytrix" },
		],
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
		"nestjs drizzle orm",
		"drizzle orm nestjs crud",
		"nestjs crud generator",
		"drizzle pagination",
		"drizzle cursor pagination",
		"drizzle soft delete",
		"drizzle upsert",
		"nestjs multi tenant",
		"nestjs swagger",
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

/**
 * The one URL form for a page: absolute, with the trailing slash `trailingSlash: true` gives
 * every exported route. Canonicals, og:url, the sitemap, JSON-LD and llms.txt all use it, so no
 * crawler is ever handed a URL that GitHub Pages answers with a 301.
 */
export function absoluteUrl(path = "/"): string {
	const clean = path.split("#")[0] ?? "/";
	return `${siteConfig.url}${clean === "/" ? "/" : `${clean.replace(/\/+$/, "")}/`}`;
}

/**
 * A link to avytrix.dev that says where it came from, so enquiries from the docs can be
 * measured: utm_source=nestjs-drizzle-crud, utm_medium=docs, utm_campaign=<page slug>.
 */
export function avytrixUrl(path: string, campaign: string): string {
	const url = new URL(path, siteConfig.organization.url);
	url.searchParams.set("utm_source", "nestjs-drizzle-crud");
	url.searchParams.set("utm_medium", "docs");
	url.searchParams.set("utm_campaign", campaign);
	return url.toString();
}

/** The robots policy for every indexable page (SEO standard 2.4). */
export const indexRobots = {
	index: true,
	follow: true,
	"max-snippet": -1,
	"max-image-preview": "large",
	"max-video-preview": -1,
} as const;

const ogTitle = siteConfig.homeTitle;
const ogImage = { url: "/opengraph-image", width: 1200, height: 630 };

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
	const url = absoluteUrl(params?.path ?? "/");
	const heading = params?.title
		? `${params.title} | ${siteConfig.displayName}`
		: ogTitle;
	const image = params?.image
		? { url: params.image, width: 1200, height: 630 }
		: ogImage;
	const images = [{ ...image, alt: heading }];

	return {
		title: params?.title ?? { absolute: ogTitle },
		description,
		keywords: [...siteConfig.keywords, ...(params?.keywords ?? [])],
		alternates: { canonical: url },
		robots: indexRobots,
		openGraph: {
			type: params?.ogType ?? "website",
			url,
			siteName: siteConfig.displayName,
			title: heading,
			description,
			locale: "en_US",
			images,
		},
		twitter: {
			card: "summary_large_image",
			title: heading,
			description,
			images: [image.url],
		},
	};
}
