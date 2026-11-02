/**
 * Does every page come back when you ask about it?
 *
 *   TRANSFORMERS_MODULE=... pnpm --filter nestjs-drizzle-crud-docs search:eval
 *
 * The probes are generated from the docs rather than hand-picked, so they cannot be quietly
 * curated to pass: each page's title, and each of its headings. A probe passes when its page is
 * in the top 4. Needs Node 22.6 or later (it loads retrieve.ts with type stripping) and the same
 * TRANSFORMERS_MODULE as build-search-index.mjs.
 */
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { search, decodeVectors } from "../lib/assistant/retrieve.ts";
import { allChunks, CONTENT, INDEX_FILE } from "./build-search-index.mjs";
import { docsPages } from "./chunk.mjs";

const index = JSON.parse(readFileSync(INDEX_FILE, "utf8"));
const rows = decodeVectors(index);

const specifier = process.env.TRANSFORMERS_MODULE;
const { pipeline } = await import(
	specifier ? pathToFileURL(specifier).href : "@huggingface/transformers"
);
const embed = await pipeline("feature-extraction", index.model, {
	dtype: "q8",
});

const probes = [];
for (const page of docsPages(CONTENT)) {
	const chunks = allChunks([page]);
	probes.push({
		q: chunks[0]?.pageTitle ?? page.url,
		url: page.url,
		kind: "title",
	});
	for (const c of chunks) {
		if (c.anchor !== "")
			probes.push({ q: c.heading, url: page.url, kind: "heading" });
	}
}

let pass = 0;
const misses = [];
for (const p of probes) {
	const out = await embed(p.q, { pooling: "mean", normalize: true });
	const hits = search(Float32Array.from(out.data), index, rows, { limit: 4 });
	if (hits.some((h) => h.chunk.url === p.url)) pass += 1;
	else misses.push({ ...p, got: hits.map((h) => h.chunk.url).slice(0, 3) });
}

const byKind = (k) => {
	const all = probes.filter((p) => p.kind === k).length;
	const bad = misses.filter((m) => m.kind === k).length;
	return `${all - bad}/${all} (${(((all - bad) / all) * 100).toFixed(1)}%)`;
};

console.log(`titles   ${byKind("title")}`);
console.log(`headings ${byKind("heading")}`);
console.log(
	`overall  ${pass}/${probes.length} (${((pass / probes.length) * 100).toFixed(1)}%)`,
);
for (const m of misses.slice(0, 15)) {
	console.log(
		`  miss "${m.q}" -> wanted ${m.url}, got ${m.got.join(", ") || "(nothing)"}`,
	);
}
