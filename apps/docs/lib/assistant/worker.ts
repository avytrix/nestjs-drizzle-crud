/// <reference lib="webworker" />
import { compose, UNSURE } from "./answer";
import { decodeVectors, type SearchIndex, search } from "./retrieve";
import { talk } from "./talk";

/**
 * The embedder, off the main thread.
 *
 * The model is ~23 MB and a forward pass takes tens of milliseconds, so it runs here rather than
 * in a hook, and the panel stays responsive while it loads. Nothing starts until the first
 * question: a reader who never asks downloads nothing.
 *
 * Everything runs in the browser. The index is a static file this site publishes, the library
 * comes from jsDelivr pinned to one exact version, and the model weights come from the Hugging
 * Face hub; all three are cached by the browser after the first question. No server of ours is
 * involved and no key is needed, which is what lets this work on GitHub Pages.
 */

/**
 * Pinned to one version, and kept in step with the version that built the index (the
 * `search:index` script). The bundle is self-contained: it carries onnxruntime-web and fetches
 * its WASM from the same CDN.
 */
const TRANSFORMERS_URL =
	"https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1/dist/transformers.min.js";

const INDEX_URL = `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/search-index.json`;

type Incoming = { type: "init" } | { type: "ask"; id: number; query: string };

type Outgoing =
	| { type: "ready" }
	| { type: "progress"; loaded: number; total: number }
	| { type: "failed"; reason: string }
	| {
			type: "answer";
			id: number;
			body: string;
			code?: unknown;
			sources: unknown;
			kind: string;
	  };

const post = (msg: Outgoing) => (self as unknown as Worker).postMessage(msg);

type Embed = (
	text: string,
	opts: object,
) => Promise<{ data: ArrayLike<number> }>;

let embed: Embed | null = null;
let index: SearchIndex | null = null;
let rows: Int8Array | null = null;

async function init() {
	try {
		const [lib, loaded] = await Promise.all([
			import(
				/* webpackIgnore: true */ /* turbopackIgnore: true */ TRANSFORMERS_URL
			),
			fetch(INDEX_URL).then((r) => {
				if (!r.ok) throw new Error(`search index: HTTP ${r.status}`);
				return r.json() as Promise<SearchIndex>;
			}),
		]);

		index = loaded;
		rows = decodeVectors(index);

		lib.env.allowLocalModels = false;
		const pipe = await lib.pipeline("feature-extraction", index.model, {
			dtype: "q8",
			progress_callback: (p: {
				status?: string;
				loaded?: number;
				total?: number;
			}) => {
				if (
					p.status === "progress" &&
					typeof p.loaded === "number" &&
					typeof p.total === "number"
				) {
					post({ type: "progress", loaded: p.loaded, total: p.total });
				}
			},
		});

		embed = (text, opts) => pipe(text, opts);
		post({ type: "ready" });
	} catch (err) {
		post({
			type: "failed",
			reason: err instanceof Error ? err.message : "unknown",
		});
	}
}

self.addEventListener("message", (event: MessageEvent<Incoming>) => {
	const msg = event.data;

	if (msg.type === "init") {
		void init();
		return;
	}

	void (async () => {
		if (!embed || !index || !rows) {
			post({ type: "failed", reason: "not ready" });
			return;
		}
		const out = await embed(`${index.queryPrefix ?? ""}${msg.query}`, {
			pooling: "mean",
			normalize: true,
		});
		const query = Float32Array.from(out.data);

		// A query embedded by a different model than the index is refused rather than scored:
		// a cosine between vectors of different provenance returns a plausible number, not an error.
		if (query.length !== index.dimensions) {
			post({ type: "failed", reason: "dimension mismatch" });
			return;
		}

		const lead = talk(msg.query);
		const answer = lead
			? lead.answer
			: compose(search(query, index, rows, { limit: 4 }));
		post({
			type: "answer",
			id: msg.id,
			body: answer.kind === "unsure" ? UNSURE : answer.body,
			code: answer.code,
			sources: answer.sources,
			kind: answer.kind,
		});
	})();
});
