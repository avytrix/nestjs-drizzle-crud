import { createMDX } from "fumadocs-mdx/next";

const withMDX = createMDX();

/*
 * The site lives under a path on avytrix.dev: https://avytrix.dev/opensource/nestjs-drizzle-crud.
 * NEXT_PUBLIC_SITE_URL is the origin only and NEXT_PUBLIC_BASE_PATH the path prefix. Both default
 * to production, so a plain build produces the live site. avytrix.dev's CI builds this app and
 * copies `out/` into its own site under the prefix. The same defaults are in lib/seo.ts,
 * scripts/build-search-index.mjs and scripts/seo_check.py.
 */
const siteUrl = (
	process.env.NEXT_PUBLIC_SITE_URL ?? "https://avytrix.dev"
).replace(/\/+$/, "");
const basePath = (
	process.env.NEXT_PUBLIC_BASE_PATH ?? "/opensource/nestjs-drizzle-crud"
).replace(/\/+$/, "");

/** @type {import('next').NextConfig} */
const config = {
	reactStrictMode: true,
	// Static HTML export: GitHub Pages serves files, not a Node server.
	output: "export",
	// GitHub Pages does not rewrite extensionless URLs, so emit `route/index.html`.
	trailingSlash: true,
	basePath,
	// Inlined into client code too, so the defaults reach the browser bundle and the worker.
	env: { NEXT_PUBLIC_SITE_URL: siteUrl, NEXT_PUBLIC_BASE_PATH: basePath },
	// next/image optimization needs a server; disable for static export.
	images: { unoptimized: true },
	serverExternalPackages: ["typescript", "twoslash"],
};

export default withMDX(config);
