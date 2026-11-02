import type { Faq, HowToStep } from "./page-schema";
import { absoluteUrl, siteConfig } from "./seo";

/**
 * Schema.org descriptions of this site, for the crawlers that read them.
 *
 * Every page carries exactly one `@graph` (SEO standard 5.3), and each graph repeats the
 * organization, website and package nodes in full, so no node points at an `@id` defined on
 * another document. Everything stated here is visible on the site: the package, its repository,
 * its version and license, Avytrix Technologies and the three profiles the footer links to, the
 * page's breadcrumb, and the questions and steps rendered on the page itself.
 */

const origin = siteConfig.url;
const home = absoluteUrl("/");
const orgRef = { "@id": `${origin}/#organization` };

const organization = {
	"@type": "Organization",
	...orgRef,
	name: siteConfig.organization.name,
	url: siteConfig.organization.url,
	logo: {
		"@type": "ImageObject",
		"@id": `${origin}/#logo`,
		url: `${origin}${siteConfig.logo}`,
		contentUrl: `${origin}${siteConfig.logo}`,
	},
	image: { "@id": `${origin}/#logo` },
	sameAs: siteConfig.organization.profiles.map((p) => p.url),
};

const website = {
	"@type": "WebSite",
	"@id": `${origin}/#website`,
	url: home,
	name: siteConfig.displayName,
	alternateName: siteConfig.project,
	description: siteConfig.description,
	publisher: orgRef,
	author: orgRef,
	inLanguage: "en-US",
};

const software = {
	"@type": "SoftwareSourceCode",
	"@id": `${origin}/#software`,
	name: siteConfig.name,
	alternateName: siteConfig.project,
	identifier: siteConfig.name,
	description: siteConfig.description,
	codeRepository: siteConfig.github,
	programmingLanguage: "TypeScript",
	runtimePlatform: "Node.js",
	license: "https://opensource.org/licenses/MIT",
	version: siteConfig.version,
	url: home,
	author: { "@type": "Person", name: siteConfig.author },
	maintainer: orgRef,
	publisher: orgRef,
	keywords: siteConfig.keywords.join(", "),
	targetProduct: { "@id": `${origin}/#application` },
};

const application = {
	"@type": "SoftwareApplication",
	"@id": `${origin}/#application`,
	name: siteConfig.name,
	alternateName: siteConfig.project,
	description: siteConfig.description,
	applicationCategory: "DeveloperApplication",
	operatingSystem: "Node.js",
	softwareVersion: siteConfig.version,
	license: "https://opensource.org/licenses/MIT",
	url: home,
	downloadUrl: siteConfig.npm,
	publisher: orgRef,
};

const shared = [organization, website, software, application];

/** The home page: who publishes the site, and the package it documents. No breadcrumb. */
export function homeLd() {
	return {
		"@context": "https://schema.org",
		"@graph": [
			...shared,
			{
				"@type": "WebPage",
				"@id": `${home}#webpage`,
				url: home,
				name: siteConfig.homeTitle,
				description: siteConfig.description,
				isPartOf: { "@id": `${origin}/#website` },
				about: { "@id": `${origin}/#software` },
				publisher: orgRef,
				inLanguage: "en-US",
			},
		],
	};
}

/**
 * One docs page: the page, the article on it, its breadcrumb trail, and, when the page renders
 * them, its common questions (FAQPage) and its steps (HowTo).
 */
export function docPageLd({
	title,
	description,
	url,
	faqs = [],
	steps = [],
	about = false,
	modified,
}: {
	title: string;
	description?: string;
	/** The page's path, e.g. "/docs/soft-delete". */
	url: string;
	faqs?: Faq[];
	steps?: HowToStep[];
	/** The page about Avytrix Technologies: an AboutPage whose subject is the organization. */
	about?: boolean;
	/** ISO date the page's file last changed in git. */
	modified?: string;
}) {
	const pageUrl = absoluteUrl(url);
	const page = { "@id": `${pageUrl}#webpage` };

	// Navigation labels, home first, the current page last, no item twice (standard 5.4).
	const trail = [
		{ name: siteConfig.displayName, url: "/" },
		...(url === "/docs" ? [] : [{ name: "Documentation", url: "/docs" }]),
		{ name: title, url },
	];

	return {
		"@context": "https://schema.org",
		"@graph": [
			...shared,
			{
				"@type": about ? "AboutPage" : "WebPage",
				...page,
				url: pageUrl,
				name: title,
				description,
				isPartOf: { "@id": `${origin}/#website` },
				about: about ? orgRef : { "@id": `${origin}/#software` },
				publisher: orgRef,
				inLanguage: "en-US",
				breadcrumb: { "@id": `${pageUrl}#breadcrumb` },
				...(about ? { mainEntity: orgRef } : {}),
				...(modified ? { dateModified: modified } : {}),
			},
			...(about
				? []
				: [
						{
							"@type": "TechArticle",
							"@id": `${pageUrl}#article`,
							headline: title,
							description,
							url: pageUrl,
							inLanguage: "en-US",
							isPartOf: page,
							mainEntityOfPage: page,
							about: { "@id": `${origin}/#software` },
							publisher: orgRef,
							author: orgRef,
							...(modified ? { dateModified: modified } : {}),
						},
					]),
			{
				"@type": "BreadcrumbList",
				"@id": `${pageUrl}#breadcrumb`,
				itemListElement: trail.map((item, i) => ({
					"@type": "ListItem",
					position: i + 1,
					name: item.name,
					item: absoluteUrl(item.url),
				})),
			},
			...(steps.length >= 2
				? [
						{
							"@type": "HowTo",
							"@id": `${pageUrl}#howto`,
							name: title,
							description,
							isPartOf: page,
							step: steps.map((s, i) => ({
								"@type": "HowToStep",
								position: i + 1,
								name: s.name,
								text: s.text,
							})),
						},
					]
				: []),
			...(faqs.length > 0
				? [
						{
							"@type": "FAQPage",
							"@id": `${pageUrl}#faq`,
							isPartOf: page,
							mainEntity: faqs.map((f) => ({
								"@type": "Question",
								name: f.question,
								acceptedAnswer: { "@type": "Answer", text: f.answer },
							})),
						},
					]
				: []),
		],
	};
}
