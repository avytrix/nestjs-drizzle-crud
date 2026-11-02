/**
 * Cosine retrieval over the prebuilt index in public/search-index.json.
 *
 * Pure, and takes its index as an argument, so the eval script can run it in Node against the
 * same file the browser fetches.
 */

export interface Chunk {
	/** Page URL: `/docs/filtering`. */
	url: string;
	/** Anchor for the heading this chunk covers, empty for the page's opening text. */
	anchor: string;
	pageTitle: string;
	/** The heading text, or the page title for the opening chunk. */
	heading: string;
	/** Prose only, MDX stripped and code removed. */
	text: string;
	/** The first code sample in the section, kept whole so it can be shown as code. */
	code?: { lang: string; source: string };
}

export interface SearchIndex {
	model: string;
	/** Prepended to a query before embedding. MiniLM needs nothing. */
	queryPrefix?: string;
	dimensions: number;
	builtAt: string;
	contentHash: string;
	chunks: {
		u: string;
		a: string;
		p: string;
		h: string;
		t: string;
		c?: { l: string; s: string };
	}[];
	/** base64 int8, `chunks.length * dimensions`. */
	vectors: string;
}

export interface Hit {
	chunk: Chunk;
	score: number;
}

export function decodeVectors(index: SearchIndex): Int8Array {
	const bin = atob(index.vectors);
	const out = new Int8Array(bin.length);
	for (let i = 0; i < bin.length; i += 1) {
		out[i] = (bin.charCodeAt(i) << 24) >> 24;
	}
	return out;
}

export function toChunk(row: SearchIndex["chunks"][number]): Chunk {
	return {
		url: row.u,
		anchor: row.a,
		pageTitle: row.p,
		heading: row.h,
		text: row.t,
		code: row.c ? { lang: row.c.l, source: row.c.s } : undefined,
	};
}

/**
 * A bare dot product. Both sides are unit length already (the build normalises before
 * quantising, the embedder normalises its output), so this does not renormalise: a build that
 * forgot would show up as scores that make no sense rather than being quietly papered over.
 * The 1/127 is the int8 scale, applied once to the sum.
 */
export function cosine(
	query: Float32Array,
	rows: Int8Array,
	row: number,
	dims: number,
): number {
	let sum = 0;
	const base = row * dims;
	for (let i = 0; i < dims; i += 1) sum += query[i]! * rows[base + i]!;
	return sum / 127;
}

/**
 * The floor the best match must clear before anything is shown.
 *
 * Measured for this model on a comparable docs corpus: real questions score 0.29 to
 * 0.68 and off-topic prompts 0.15 to 0.21. `pnpm --filter nestjs-drizzle-crud-docs search:eval`
 * re-measures it against these docs.
 */
export const ACCEPT = 0.22;

/**
 * Top matches for a query vector, one per page.
 *
 * Deduplicated by page before `limit`, keeping each page's best section. Without that, one long
 * page with eight similar sections fills the whole answer and the second-best page, usually the
 * one that disambiguates, never shows.
 */
export function search(
	query: Float32Array,
	index: SearchIndex,
	rows: Int8Array,
	opts: { limit?: number; accept?: number } = {},
): Hit[] {
	const { limit = 4, accept = ACCEPT } = opts;
	if (query.length !== index.dimensions) return [];

	const scored: Hit[] = index.chunks.map((row, i) => ({
		chunk: toChunk(row),
		score: cosine(query, rows, i, index.dimensions),
	}));
	scored.sort((a, b) => b.score - a.score);

	const top = scored[0];
	if (!top || top.score < accept) return [];

	const seen = new Set<string>();
	const out: Hit[] = [];
	for (const h of scored) {
		if (seen.has(h.chunk.url)) continue;
		seen.add(h.chunk.url);
		out.push(h);
		if (out.length >= limit) break;
	}
	return out;
}
