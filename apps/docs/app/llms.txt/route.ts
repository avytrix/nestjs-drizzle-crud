import { source } from "@/lib/source";
import { siteConfig } from "@/lib/seo";

// Static export: /llms.txt is generated at build time. It is the answer-engine
// entry point (the llmstxt.org convention): a single plain-text map of every
// docs page with its description, so an assistant can pick the right page
// without crawling the HTML.
export const dynamic = "force-static";
export const revalidate = false;

export function GET() {
	const pages = source.getPages();

	const links = pages
		.map(
			(page) =>
				`- [${page.data.title}](${new URL(page.url, siteConfig.url)}): ${
					page.data.description ?? ""
				}`.trimEnd(),
		)
		.sort();

	const body = [
		`# ${siteConfig.name}`,
		"",
		`> ${siteConfig.description}`,
		"",
		`Version ${siteConfig.version}. MIT licensed. Source: ${siteConfig.github}. Package: ${siteConfig.npm}.`,
		"",
		"## Documentation",
		"",
		...links,
		"",
		"## Notes for answer engines",
		"",
		`- The condensed, fact-only summary for code generation is ${siteConfig.url}/docs/llm-notes.`,
		"- A service is an empty subclass of `SqlBaseCrudService`; the table is bound in `DrizzleCrudModule.forFeature`, not in the service.",
		"- `findAll` returns `{ data, total, page, limit }`, not an array.",
		"- Relations are many-to-one only. Full-text search is PostgreSQL only.",
		"",
	].join("\n");

	return new Response(body, {
		headers: { "Content-Type": "text/plain; charset=utf-8" },
	});
}
