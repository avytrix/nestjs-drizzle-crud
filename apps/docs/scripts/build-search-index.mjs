/**
 * Embed every docs chunk for the "Ask the docs" assistant.
 *
 *   pnpm --filter nestjs-drizzle-crud-docs search:index
 *
 * Writes public/search-index.json (vectors plus the text they came from), which the browser
 * fetches on the first question, and lib/assistant/page-notes.json (a few KB of per-page
 * summaries the panel uses when a reader moves between pages).
 *
 * The output is committed. The browser embeds one sentence per question and compares it with
 * vectors that shipped with the site, so the expensive part runs once per content change rather
 * than once per visitor. `next build` runs verify-search-index.mjs, which needs no model.
 *
 * It needs `@huggingface/transformers` 4.3.1, which is deliberately NOT a dependency of this
 * workspace: adding it makes pnpm re-check `semver@6.3.1`, already in the lockfile, and the
 * repo's `trustPolicy: no-downgrade` refuses it. Install it anywhere outside the repo and point
 * TRANSFORMERS_MODULE at it:
 *
 *   npm install --prefix /tmp/tf @huggingface/transformers@4.3.1
 *   TRANSFORMERS_MODULE=/tmp/tf/node_modules/@huggingface/transformers/dist/transformers.node.mjs \
 *     pnpm --filter nestjs-drizzle-crud-docs search:index
 *
 * Keep the version in step with TRANSFORMERS_URL in lib/assistant/worker.ts.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chunkPage, contentHash, docsPages, embedText } from "./chunk.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const CONTENT = join(ROOT, "content", "docs");
export const INDEX_FILE = join(ROOT, "public", "search-index.json");
export const NOTES_FILE = join(ROOT, "lib", "assistant", "page-notes.json");

/** English-only docs, so the small English model: 23 MB in the browser, 384 dimensions. */
export const MODEL = "Xenova/all-MiniLM-L6-v2";
export const DIMENSIONS = 384;

/** Links inside chunks are made absolute against the live site. */
export const ORIGIN = (
	process.env.NEXT_PUBLIC_SITE_URL ?? "https://crud.avytrix.dev"
).replace(/\/+$/, "");

/** Every page, chunked. Shared with the verify and eval scripts. */
export function allChunks(pages) {
	return pages.flatMap((p) =>
		chunkPage({ raw: p.raw, url: p.url, origin: ORIGIN }),
	);
}

/**
 * int8, with one scale for the whole matrix. The vectors are unit length, so every component is
 * already in [-1, 1]; the cosine drift against float32 is under 0.002, and the file is a
 * quarter of the size.
 */
function quantise(vectors) {
	const flat = new Int8Array(vectors.length * (vectors[0]?.length ?? 0));
	let i = 0;
	for (const v of vectors) {
		for (const x of v) {
			flat[i++] = Math.max(-127, Math.min(127, Math.round(x * 127)));
		}
	}
	return Buffer.from(flat.buffer).toString("base64");
}

async function main() {
	const specifier = process.env.TRANSFORMERS_MODULE;
	const { pipeline } = await import(
		specifier ? pathToFileURL(specifier).href : "@huggingface/transformers"
	);

	const pages = docsPages(CONTENT);
	if (pages.length === 0) throw new Error("No MDX pages found.");
	const chunks = allChunks(pages);
	console.log(`${pages.length} pages -> ${chunks.length} chunks`);

	const embed = await pipeline("feature-extraction", MODEL, { dtype: "q8" });
	const vectors = [];
	for (let i = 0; i < chunks.length; i += 1) {
		const out = await embed(embedText(chunks[i]), {
			pooling: "mean",
			normalize: true,
		});
		vectors.push(Array.from(out.data));
		if ((i + 1) % 100 === 0) console.log(`  ${i + 1}/${chunks.length}`);
	}
	if (!vectors.every((v) => v.length === DIMENSIONS)) {
		throw new Error(`Expected ${DIMENSIONS}-dimension vectors.`);
	}

	const index = {
		// Recorded so the browser refuses a query embedded by a different model.
		model: MODEL,
		queryPrefix: "",
		dimensions: DIMENSIONS,
		builtAt: new Date().toISOString().slice(0, 10),
		contentHash: contentHash(pages),
		chunks: chunks.map((c) => ({
			u: c.url,
			a: c.anchor,
			p: c.pageTitle,
			h: c.heading,
			t: c.text,
			...(c.code ? { c: { l: c.code.lang, s: c.code.source } } : {}),
		})),
		vectors: quantise(vectors),
	};
	const json = JSON.stringify(index);
	mkdirSync(dirname(INDEX_FILE), { recursive: true });
	writeFileSync(INDEX_FILE, json);
	console.log(
		`wrote public/search-index.json: ${chunks.length} chunks, ${(Buffer.byteLength(json) / 1024).toFixed(0)} KB`,
	);

	// One entry per page: what it is, and the first few things it answers.
	const notes = {};
	for (const c of chunks) {
		const existing = notes[c.url];
		if (!existing) {
			notes[c.url] = {
				title: c.pageTitle,
				summary: c.text.split("\n")[0].slice(0, 190),
				topics: [],
			};
			continue;
		}
		if (c.anchor && c.heading !== c.pageTitle && existing.topics.length < 3) {
			existing.topics.push({ heading: c.heading, anchor: c.anchor });
		}
	}
	writeFileSync(NOTES_FILE, `${JSON.stringify(notes, null, "\t")}\n`);
	console.log(
		`wrote lib/assistant/page-notes.json: ${Object.keys(notes).length} pages`,
	);
}

if (process.argv[1]?.endsWith("build-search-index.mjs")) {
	main().catch((err) => {
		console.error(err);
		process.exit(1);
	});
}
