/**
 * Is the committed search index still true? Runs before every `next build`, needs no model.
 *
 * Fails the build on what would break the assistant outright:
 *   - the file is missing or not the shape the browser expects (model, dimensions, matrix size);
 *   - a page chunks to nothing, so no question can ever reach it.
 *
 * Warns, without failing, when the index is stale (a page changed after it was built). The
 * assistant then answers from the previous wording until `search:index` is re-run, which is
 * worth fixing but not worth blocking a deploy over: every page is still searchable with Cmd+K.
 * Set SEARCH_INDEX_STRICT=1 to make staleness fail too.
 */
import { existsSync, readFileSync } from "node:fs";
import {
	allChunks,
	CONTENT,
	DIMENSIONS,
	INDEX_FILE,
	MODEL,
	NOTES_FILE,
} from "./build-search-index.mjs";
import { contentHash, docsPages } from "./chunk.mjs";

const fail = [];
const warn = [];

if (!existsSync(INDEX_FILE) || !existsSync(NOTES_FILE)) {
	console.error(
		"search index missing: run `pnpm --filter nestjs-drizzle-crud-docs search:index`",
	);
	process.exit(1);
}

const index = JSON.parse(readFileSync(INDEX_FILE, "utf8"));
const pages = docsPages(CONTENT);

if (index.model !== MODEL)
	fail.push(`built by ${index.model}, expected ${MODEL}`);
if (index.dimensions !== DIMENSIONS) {
	fail.push(`unexpected dimensions ${index.dimensions}`);
}
const vectorBytes = Buffer.from(index.vectors, "base64").byteLength;
if (vectorBytes !== index.chunks.length * index.dimensions) {
	fail.push(
		`vector matrix is ${vectorBytes} bytes, expected ${index.chunks.length * index.dimensions}`,
	);
}

const fresh = allChunks(pages);
for (const page of pages) {
	if (!fresh.some((c) => c.url === page.url)) {
		fail.push(`page chunks to nothing: ${page.url}`);
	}
}

if (index.contentHash !== contentHash(pages)) {
	const covered = new Set(index.chunks.map((c) => c.u));
	const missing = pages.filter((p) => !covered.has(p.url)).map((p) => p.url);
	warn.push(
		`search index is stale (built ${index.builtAt}); the assistant answers from the older text${
			missing.length > 0 ? ` and cannot reach ${missing.join(", ")}` : ""
		}.\n  Refresh it: see the header of scripts/build-search-index.mjs`,
	);
}

for (const w of warn) console.warn(`warning: ${w}`);
if (process.env.SEARCH_INDEX_STRICT === "1") fail.push(...warn);

if (fail.length > 0) {
	console.error(
		`search index verification failed:\n${fail.map((f) => `  - ${f}`).join("\n")}`,
	);
	process.exit(1);
}

console.log(
	`search index ok: ${index.chunks.length} chunks over ${pages.length} pages${warn.length > 0 ? " (stale)" : ""}`,
);
