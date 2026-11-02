import { docs } from "../.source/server";
import { llms, loader } from "fumadocs-core/source";
import { icons } from "lucide-react";
import { createElement } from "react";

/** A lucide icon by name, for frontmatter `icon:` (sidebar and page header) and meta.json. */
export function lucideIcon(name: string | undefined) {
	if (!name) return;
	if (!(name in icons)) throw new Error(`Unknown lucide icon: ${name}`);
	return createElement(icons[name as keyof typeof icons]);
}

export const source = loader({
	baseUrl: "/docs",
	source: docs.toFumadocsSource(),
	/*
	 * `icon: Rocket` in frontmatter or meta.json resolves to the lucide icon of that name. An
	 * unknown name throws at build rather than rendering a blank square, so a typo fails the
	 * build instead of shipping a hole in the sidebar.
	 */
	icon: lucideIcon,
});

/** Markdown for /llms-full.txt and the per-page `content.md` routes. */
export const docsLlms = llms(source, {
	renderPage: async (page) => `# ${page.data.title} (${page.url})

${await page.data.getText("processed")}`,
});

/** Where a page's Markdown lives: /llms.mdx/docs/<slug>/content.md */
export function markdownSegments(page: { slugs: string[] }) {
	return [...page.slugs, "content.md"];
}

export function markdownUrl(page: { slugs: string[] }) {
	return `/llms.mdx/docs/${markdownSegments(page).join("/")}`;
}

/** Where a page's sharing card lives: /og/docs/<slug>/image.png */
export function imageSegments(page: { slugs: string[] }) {
	return [...page.slugs, "image.png"];
}

export function imageUrl(page: { slugs: string[] }) {
	return `/og/docs/${imageSegments(page).join("/")}`;
}
