/**
 * Question-and-answer and step data for a page's JSON-LD, read from the page's own MDX.
 *
 * SEO standard section 0: FAQ schema is generated from the visible markup, never written by
 * hand, so it cannot drift from the page. The questions are the `<Accordion title="…">` items of
 * the page's "Common questions" section, the answers their text. The steps of a HowTo are the
 * `###` headings inside the page's first `<Steps>` block. `scripts/seo_check.py` fails the build
 * if any of them is not in the rendered HTML.
 */

import { siteConfig } from "./seo";

export interface Faq {
	question: string;
	answer: string;
}

export interface HowToStep {
	name: string;
	text: string;
}

/** Markdown and MDX reduced to the words a reader sees. */
export function plainText(md: string): string {
	// Inline code is set aside first, so `Service<T>` is not mistaken for a tag below.
	const code: string[] = [];
	return md
		.replace(/^(```|~~~)[\s\S]*?^\1/gm, " ") // code fences
		.replace(
			/`([^`\n]*)`/g,
			(_, c: string) => `\uE000${code.push(c) - 1}\uE000`,
		)
		.replace(/<Version\s*\/>/g, siteConfig.version) // renders the documented version
		.replace(/<([A-Z][A-Za-z]*)\b[^>]*\/>/g, " ") // other self-closing components
		.replace(/<\/?[A-Za-z][^>]*>/g, "") // tags, keeping their children
		.replace(/!\[[^\]]*\]\([^)]*\)/g, "") // images
		.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1") // links keep their text
		.replace(/(\*\*|__)(.+?)\1/g, "$2")
		.replace(/(^|[\s(])[*_]([^*_\n]+)[*_]/g, "$1$2")
		.replace(/\uE000(\d+)\uE000/g, (_, i: string) => code[Number(i)] ?? "")
		.replace(/\s+/g, " ")
		.trim();
}

const unquote = (s: string) =>
	s
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&amp;/g, "&");

export function extractFaqs(mdx: string): Faq[] {
	const section = mdx.split(/^## Common questions\s*$/m)[1];
	if (!section) return [];
	const block = section.split(/^## /m)[0] ?? "";
	return [
		...block.matchAll(
			/<Accordion\s+title=(?:"([^"]+)"|'([^']+)'|\{"([^"]+)"\})[^>]*>([\s\S]*?)<\/Accordion>/g,
		),
	]
		.map((m) => ({
			question: unquote(m[1] ?? m[2] ?? m[3] ?? "").trim(),
			answer: plainText(m[4] ?? ""),
		}))
		.filter((f) => f.question && f.answer);
}

export function extractSteps(mdx: string): HowToStep[] {
	const block = mdx.match(/<Steps>([\s\S]*?)<\/Steps>/)?.[1];
	if (!block) return [];
	return [...block.matchAll(/<Step>([\s\S]*?)<\/Step>/g)].flatMap((m) => {
		const body = m[1] ?? "";
		const heading = body.match(/^#{2,4}\s+(.+)$/m)?.[1];
		if (!heading) return [];
		const name = plainText(heading);
		const rest = body.slice(body.indexOf(heading) + heading.length);
		const para = rest
			.replace(/^(```|~~~)[\s\S]*?^\1/gm, "\n\n")
			.split(/\n\s*\n/)
			.map(plainText)
			.find((p) => p.length > 0);
		return [{ name, text: para ?? name }];
	});
}
