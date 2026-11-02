/**
 * Break a docs page into the units the assistant answers from, plus the page walk and the
 * content hash the index is stamped with.
 *
 * Plain JavaScript on purpose: `next build` runs the verify script on every Node version CI
 * covers, including Node 20, which cannot strip TypeScript types.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/** Strip the frontmatter block and return it parsed, shallowly. */
export function splitFrontmatter(raw) {
	const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw);
	if (!match) return { meta: {}, body: raw };

	const meta = {};
	for (const line of (match[1] ?? "").split("\n")) {
		const i = line.indexOf(":");
		if (i === -1) continue;
		const key = line.slice(0, i).trim();
		let value = line.slice(i + 1).trim();
		if (
			(value.startsWith('"') && value.endsWith('"')) ||
			(value.startsWith("'") && value.endsWith("'"))
		) {
			value = value.slice(1, -1);
		}
		if (key) meta[key] = value;
	}
	return { meta, body: raw.slice(match[0].length) };
}

/**
 * Pull the fenced code out of a section before anything touches the prose.
 *
 * Returns the prose with the fences removed and the first sample kept whole. They have to be
 * separated because the two want opposite treatment: prose wants its punctuation stripped, and
 * code wants every character of it.
 */
export function splitCode(mdx) {
	let first;

	const prose = mdx.replace(/```([^\n]*)\n([\s\S]*?)```/g, (_m, info, body) => {
		if (!first) {
			// The info string is ```ts title="app.module.ts"; the language is the first word of it.
			first = {
				lang: (info.trim().split(/\s+/)[0] ?? "").toLowerCase(),
				source: body.trimEnd(),
			};
		}
		return " ";
	});

	return { prose, code: first };
}

/**
 * MDX to plain prose.
 *
 * **Underscores and slashes survive.** Stripping `_` would turn `deleted_at` into `deleted at`
 * and `findAll` neighbours like `with_count` into two words: wrong to show a reader, and an
 * identifier split into words embeds as something else entirely.
 *
 * JSX tags go but their children stay: `<Callout title="x">body</Callout>` keeps both, since the
 * title and the body are prose an author wrote for a reader.
 */
export function toPlainText(mdx, origin) {
	return (
		mdx
			// import/export lines are machinery, never prose
			.replace(/^\s*(import|export)\s.+$/gm, "")
			// self-closing JSX carries no reader-facing text
			.replace(/<[A-Z][\w.]*\b[^>]*\/>/g, " ")
			// keep the attribute text of a component that titles itself
			.replace(/<([A-Z][\w.]*)\b([^>]*)>/g, (_m, _tag, attrs) => {
				const title = /title=["']([^"']+)["']/.exec(attrs);
				return title ? `${title[1]}. ` : " ";
			})
			.replace(/<\/[A-Z][\w.]*>/g, " ")
			/*
			 * **Links keep their target.** A reader told to go somewhere needs to be told where. A
			 * relative target is made absolute, because a chunk is read far from the page it came
			 * from and `/docs/for-root` means little in a chat bubble.
			 */
			.replace(/\[([^\]]+)\]\(([^)]*)\)/g, (_m, label, href) => {
				const target = href.trim();
				if (target.length === 0 || target.startsWith("#")) return label;
				const absolute = target.startsWith("http")
					? target
					: `${origin}${target}`;
				return label.trim() === absolute ? label : `${label} (${absolute})`;
			})
			// inline code keeps its content, loses only the ticks
			.replace(/`([^`]+)`/g, "$1")
			// table pipes and emphasis go; underscore and slash are left alone on purpose
			.replace(/[*>|]/g, " ")
			.replace(/^[-=:]{3,}$/gm, " ")
			.replace(/\r/g, "")
			.replace(/[ \t]+/g, " ")
			// Stripping a tag leaves the space it occupied in front of the punctuation that followed
			// it, so "API keys ." and "the dashboard ," read as typos rather than as markup.
			.replace(/\s+([.,;:!?])/g, "$1")
			.replace(/^[ \t]+/gm, "")
			.replace(/\n{3,}/g, "\n\n")
			.trim()
	);
}

/**
 * GitHub-style anchor, matching what Fumadocs (github-slugger) generates for a heading:
 * markdown markers go, underscores and hyphens stay, and each space becomes a hyphen.
 */
export function slugify(heading) {
	return heading
		.toLowerCase()
		.replace(/[`*~]/g, "")
		.replace(/[^\p{L}\p{N}\s_-]/gu, "")
		.replace(/ /g, "-");
}

const MIN_CHARS = 40;

/*
 * Below this, a section is a lead-in rather than an answer, and it absorbs its subsections.
 *
 * Otherwise a heading that introduces three `<Step>` blocks scores well and answers with its one
 * sentence of lead-in, while the steps that say something are separate chunks.
 *
 * Dropping thin parents was tried first and measured worse, because on some pages the thin
 * section is the only route to that page. Absorbing the children keeps the parent answerable and
 * gives it something to say. The children stay indexed too, so a precise question still reaches
 * the precise subsection.
 */
const THIN_BODY = 160;
const MAX_CHARS = 1200;

/** Split an over-long section on paragraph boundaries rather than mid-sentence. */
function pack(text) {
	if (text.length <= MAX_CHARS) return [text];
	const out = [];
	let current = "";
	for (const para of text.split(/\n{2,}/)) {
		if (current.length > 0 && current.length + para.length > MAX_CHARS) {
			out.push(current.trim());
			current = "";
		}
		current += (current.length > 0 ? "\n\n" : "") + para;
	}
	if (current.trim().length > 0) out.push(current.trim());
	return out;
}

/**
 * One page to its chunks.
 *
 * The opening text before the first heading becomes a chunk of its own titled with the page, so a
 * page whose answer lives in its lede is still reachable. Sections shorter than `MIN_CHARS` are
 * folded into nothing rather than embedded: a bare heading with no body is noise in a vector
 * index and will match everything weakly.
 */
export function chunkPage(opts) {
	const { meta, body } = splitFrontmatter(opts.raw);
	const pageTitle = meta.title ?? opts.url;
	const chunks = [];

	// Headings at any depth, so an h3 under an h2 is its own answerable unit.
	const parts = body.split(/^(#{2,4})\s+(.+)$/gm);
	const leadSplit = splitCode(parts[0] ?? "");
	const lead = toPlainText(leadSplit.prose, opts.origin);
	const description = meta.description ?? "";

	const leadText = [description, lead].filter((s) => s.length > 0).join("\n\n");
	if (leadText.length >= MIN_CHARS) {
		pack(leadText).forEach((text, i) => {
			chunks.push({
				url: opts.url,
				anchor: "",
				pageTitle,
				heading: pageTitle,
				text,
				code: i === 0 ? leadSplit.code : undefined,
			});
		});
	}

	// Collect the sections first, with their depth, so a thin one can look at what follows it.
	const sections = [];
	for (let i = 1; i < parts.length; i += 3) {
		const heading = (parts[i + 1] ?? "").trim();
		if (heading.length === 0) continue;
		const split = splitCode(parts[i + 2] ?? "");
		sections.push({
			depth: (parts[i] ?? "##").length,
			heading,
			body: toPlainText(split.prose, opts.origin),
			code: split.code,
		});
	}

	sections.forEach((section, i) => {
		let body = section.body;
		let code = section.code;

		if (body.length < THIN_BODY) {
			// Take the subsections underneath it, in order, until there is enough to answer with or the
			// next sibling at the same depth begins.
			for (let j = i + 1; j < sections.length; j += 1) {
				const next = sections[j];
				if (next.depth <= section.depth) break;
				body = `${body}\n\n${next.heading}. ${next.body}`.trim();
				code ??= next.code;
				if (body.length >= MAX_CHARS) break;
			}
		}

		if (body.length < MIN_CHARS) return;
		pack(body).forEach((text, j) => {
			chunks.push({
				url: opts.url,
				anchor: slugify(section.heading),
				pageTitle,
				heading: section.heading,
				text,
				code: j === 0 ? code : undefined,
			});
		});
	});

	return chunks;
}

/** What actually goes through the embedder: the page and heading give the body its context. */
export function embedText(chunk) {
	return `${chunk.pageTitle}: ${chunk.heading}\n${chunk.text}`;
}

/**
 * Every MDX page under content/docs, with the URL the site serves it at.
 *
 * Route-group folders like `(guides)` add no URL segment, and `index` is its folder's own URL,
 * so `(guides)/filtering.mdx` is `/docs/filtering` and `index.mdx` is `/docs`.
 */
export function docsPages(contentDir) {
	const found = [];
	const walk = (dir) => {
		for (const name of readdirSync(dir)) {
			const full = join(dir, name);
			if (statSync(full).isDirectory()) {
				walk(full);
				continue;
			}
			if (!name.endsWith(".mdx")) continue;
			const rel = relative(contentDir, full).replace(/\\/g, "/");
			const slug = rel
				.replace(/\.mdx$/, "")
				.split("/")
				.filter((part) => !/^\(.+\)$/.test(part))
				.join("/")
				.replace(/(^|\/)index$/, "");
			const url = slug.length > 0 ? `/docs/${slug}` : "/docs";
			found.push({ file: full, url, raw: readFileSync(full, "utf8") });
		}
	};
	walk(contentDir);
	return found.sort((a, b) => a.url.localeCompare(b.url));
}

/** What the index is stamped with, so a stale one can be told from a current one. */
export function contentHash(pages) {
	const h = createHash("sha256");
	for (const d of pages)
		h.update(d.url).update("\u0000").update(d.raw).update("\u0000");
	return h.digest("hex").slice(0, 16);
}
