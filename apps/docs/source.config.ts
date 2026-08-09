import { defineDocs, defineConfig } from "fumadocs-mdx/config";
import { transformerTwoslash } from "fumadocs-twoslash";
import { rehypeCodeDefaultOptions } from "fumadocs-core/mdx-plugins";

// Reads `accent=nest|drizzle` from the fence meta string and tags the
// rendered <pre> with `data-accent="..."`. CSS in app/global.css turns the
// tag into a left-edge accent color. Default: no tag = no accent.
//
// Convention: append `accent=nest` or `accent=drizzle` to any ```ts fence.
//   nest    — NestJS module/controller wiring (app.module.ts, *.controller.ts)
//   drizzle — Drizzle schema definitions and raw SQL
// Untagged fences stay neutral (library API, mixed code, npm/shell).
const accentTransformer = {
	name: "accent-meta",
	pre(node: { properties?: Record<string, unknown> }) {
		const raw = (this as { options?: { meta?: { __raw?: string } } })
			.options?.meta?.__raw;
		if (!raw) return;
		const m = raw.match(/\baccent=(drizzle|nest)\b/);
		if (m) {
			node.properties = { ...node.properties, "data-accent": m[1] };
		}
	},
};

export const docs = defineDocs({
	dir: "content/docs",
});

export default defineConfig({
	mdxOptions: {
		// pnpm is this project's package manager, so its tab comes first and is
		// what a reader copies by default. Every ```npm block in content/docs is a
		// plain `npm i <packages>` line, so the conversions stay this simple.
		remarkNpmOptions: {
			persist: { id: "package-manager" },
			packageManagers: [
				{
					name: "pnpm",
					command: (cmd) => cmd.replace(/^npm i(nstall)? /, "pnpm add "),
				},
				{ name: "npm", command: (cmd) => cmd },
				{
					name: "yarn",
					command: (cmd) => cmd.replace(/^npm i(nstall)? /, "yarn add "),
				},
				{
					name: "bun",
					command: (cmd) => cmd.replace(/^npm i(nstall)? /, "bun add "),
				},
			],
		},
		rehypeCodeOptions: {
			themes: {
				light: "github-light",
				dark: "github-dark",
			},
			langs: ["ts", "tsx", "js", "jsx", "bash", "json", "html", "css"],
			transformers: [
				...(rehypeCodeDefaultOptions.transformers ?? []),
				transformerTwoslash(),
				accentTransformer,
			],
		},
	},
});
