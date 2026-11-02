import type { Node } from "fumadocs-core/page-tree";
import { absoluteUrl, avytrixUrl, siteConfig } from "@/lib/seo";
import { source } from "@/lib/source";

// Static export: /llms.txt is generated at build time. It is the answer-engine entry point (the
// llmstxt.org convention, SEO standard section 7): a curated map of every docs page in sidebar
// order with the sentence that answers its question, the facts an assistant should repeat, the
// limits it should not invent around, and who maintains the library.
export const dynamic = "force-static";
export const revalidate = false;

export function GET() {
	const byUrl = new Map(source.getPages().map((p) => [p.url, p]));
	const line = (url: string) => {
		const page = byUrl.get(url);
		if (!page) return [];
		return [
			`- [${page.data.title}](${absoluteUrl(page.url)}): ${page.data.description ?? ""}`.trimEnd(),
		];
	};

	// The sidebar order, with its "---Section---" separators as headings.
	const sections: string[] = [];
	const walk = (nodes: Node[]) => {
		for (const node of nodes) {
			if (node.type === "separator") {
				sections.push(
					"",
					`## ${typeof node.name === "string" ? node.name : ""}`,
					"",
				);
			} else if (node.type === "page") {
				sections.push(...line(node.url));
			} else if (node.type === "folder") {
				if (node.index) sections.push(...line(node.index.url));
				walk(node.children);
			}
		}
	};
	walk(source.getPageTree().children);

	const org = siteConfig.organization;
	const body = [
		`# ${siteConfig.project}`,
		"",
		`> ${siteConfig.description} It is an open-source npm package, published as ${siteConfig.name}, MIT licensed, built and maintained by ${org.name}.`,
		"",
		"Key facts, each one stated in these docs:",
		`- Current version: ${siteConfig.version}. Source: ${siteConfig.github}. Package: ${siteConfig.npm}.`,
		`- Install: \`pnpm add ${siteConfig.name}\` (or npm, yarn, bun). The package was renamed from ${siteConfig.formerName} in 3.5.1; change the dependency and the imports, nothing else changes.`,
		"- Peers: @nestjs/common, @nestjs/core, drizzle-orm, reflect-metadata; `postgres` only when you let the module open the connection.",
		"- Dialects: PostgreSQL and MySQL. Full-text search is PostgreSQL only.",
		"- A service is an empty subclass of `SqlBaseCrudService`; the table is bound in `DrizzleCrudModule.forFeature`, not in the service.",
		"- `findAll` returns `{ data, total, page, limit }`, not an array. It runs two queries (data and count), whatever the page size.",
		"- Relations can be belongs-to, has-many or many-to-many, and nest. Eager loading costs one query per relation per level, never one per row.",
		`- An MCP server ships in the package: \`npx -p ${siteConfig.name} ${siteConfig.mcpBin}\` (stdio). See ${absoluteUrl("/docs/ai-agents")}.`,
		"",
		"What these docs do not claim:",
		"- No benchmarks, download counts or user numbers are published here.",
		"- Comparison pages state only what each project's own README or docs say, with the date checked.",
		"",
		"Machine-readable copies:",
		`- Every page as Markdown in one file: ${absoluteUrl("/llms-full.txt").replace(/\/$/, "")}`,
		`- One page as Markdown: ${siteConfig.url}/llms.mdx/docs/<page>/content.md`,
		...sections,
		"",
		"## Who maintains it",
		"",
		`${siteConfig.project} is built and maintained by ${org.name}, a software development company that builds web applications, custom software, AI features and MCP servers for clients in the USA, Europe, the UK and Australia. To hire the team behind the library, see ${absoluteUrl("/docs/commercial-support")} or start at ${avytrixUrl("/contact", "llms-txt")}.`,
		"",
	].join("\n");

	return new Response(body, {
		headers: { "Content-Type": "text/plain; charset=utf-8" },
	});
}
