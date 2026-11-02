import type { Root } from "fumadocs-core/page-tree";
import { firstUrl, folderPath } from "./page-tree";
import { siteConfig } from "./seo";

/**
 * Schema.org descriptions of this site, for the crawlers that read them.
 *
 * Every page carries exactly one `@graph`, and each graph repeats the organization, website and
 * package nodes in full, so no node points at an `@id` defined on another document. Everything
 * stated here is visible on the site: the package, its repository, its version, the company
 * credited in the footer, and the section a page sits in.
 */

const origin = siteConfig.url;

const organization = {
	"@type": "Organization",
	"@id": `${origin}/#organization`,
	name: siteConfig.organization.name,
	url: siteConfig.organization.url,
	logo: {
		"@type": "ImageObject",
		"@id": `${origin}/#logo`,
		url: `${origin}${siteConfig.logo}`,
		contentUrl: `${origin}${siteConfig.logo}`,
	},
	image: { "@id": `${origin}/#logo` },
	sameAs: [siteConfig.organization.github],
};

const website = {
	"@type": "WebSite",
	"@id": `${origin}/#website`,
	url: origin,
	name: siteConfig.displayName,
	alternateName: siteConfig.name,
	description: siteConfig.description,
	publisher: { "@id": `${origin}/#organization` },
	inLanguage: "en-US",
};

const software = {
	"@type": "SoftwareSourceCode",
	"@id": `${origin}/#software`,
	name: siteConfig.name,
	description: siteConfig.description,
	codeRepository: siteConfig.github,
	programmingLanguage: "TypeScript",
	runtimePlatform: "Node.js",
	license: "https://opensource.org/licenses/MIT",
	version: siteConfig.version,
	url: siteConfig.npm,
	author: { "@type": "Person", name: siteConfig.author },
	publisher: { "@id": `${origin}/#organization` },
	keywords: siteConfig.keywords.join(", "),
};

/** The home page: who publishes the site, and the package it documents. */
export function homeLd() {
	return {
		"@context": "https://schema.org",
		"@graph": [
			organization,
			website,
			software,
			{
				"@type": "WebPage",
				"@id": `${origin}/#webpage`,
				url: origin,
				name: `${siteConfig.displayName}: ${siteConfig.tagline}`,
				description: siteConfig.description,
				isPartOf: { "@id": `${origin}/#website` },
				about: { "@id": `${origin}/#software` },
				inLanguage: "en-US",
			},
		],
	};
}

/** One docs page: the page, the article on it, and its breadcrumb trail. */
export function docPageLd({
	title,
	description,
	url,
	tree,
}: {
	title: string;
	description?: string;
	url: string;
	tree: Root;
}) {
	// A section is only named when it leads somewhere, so each resolves to its first page. A
	// section whose first page is this page would list it twice, so it is dropped.
	const sections = (folderPath(tree, url) ?? []).flatMap((folder) => {
		const href = firstUrl(folder);
		const named = typeof folder.name === "string" ? folder.name : undefined;
		return href && named && href !== url ? [{ name: named, url: href }] : [];
	});

	const trail = [
		{ name: siteConfig.displayName, url: "/" },
		...(url === "/docs" ? [] : [{ name: "Documentation", url: "/docs" }]),
		...sections,
		{ name: title, url },
	];

	const pageUrl = `${origin}${url}`;

	return {
		"@context": "https://schema.org",
		"@graph": [
			organization,
			website,
			software,
			{
				"@type": "WebPage",
				"@id": `${pageUrl}#webpage`,
				url: pageUrl,
				name: title,
				description,
				isPartOf: { "@id": `${origin}/#website` },
				about: { "@id": `${origin}/#software` },
				inLanguage: "en-US",
				breadcrumb: { "@id": `${pageUrl}#breadcrumb` },
			},
			{
				"@type": "TechArticle",
				"@id": `${pageUrl}#article`,
				headline: title,
				description,
				url: pageUrl,
				inLanguage: "en-US",
				isPartOf: { "@id": `${pageUrl}#webpage` },
				mainEntityOfPage: { "@id": `${pageUrl}#webpage` },
				about: { "@id": `${origin}/#software` },
				publisher: { "@id": `${origin}/#organization` },
				author: { "@id": `${origin}/#organization` },
			},
			{
				"@type": "BreadcrumbList",
				"@id": `${pageUrl}#breadcrumb`,
				itemListElement: trail.map((item, i) => ({
					"@type": "ListItem",
					position: i + 1,
					name: item.name,
					item: `${origin}${item.url}`,
				})),
			},
		],
	};
}
