import type { Hit } from "./retrieve";

/**
 * Turn retrieved sections into the reply a reader sees.
 *
 * **Nothing here is generated.** Every sentence is either a fixed template or text lifted from
 * the page it cites, so the assistant cannot invent an option, a method or a behaviour the docs
 * do not describe, and a prompt injection can at worst retrieve the wrong section.
 */

export interface Source {
	url: string;
	title: string;
	heading: string;
	anchor: string;
}

export interface Answer {
	/** Markdown, revealed progressively by the UI. */
	body: string;
	/** Shown as a real code block under the prose, never mixed into it. */
	code?: { lang: string; source: string };
	/** The page the body came from. */
	sources: Source[];
	kind: "answer" | "unsure";
}

export const UNSURE =
	"I could not find that in the docs. Try naming the thing you are after, for example a method like `findAll`, an option like `softDelete`, or a topic like relations.\n\nYou can also press Cmd+K to search every page.";

/** Trim a section to something readable in a chat bubble without cutting a sentence in half. */
function excerpt(text: string, max = 520): string {
	const clean = text.replace(/\n{2,}/g, "\n\n").trim();
	if (clean.length <= max) return clean;
	const cut = clean.slice(0, max);
	const stop = Math.max(
		cut.lastIndexOf(". "),
		cut.lastIndexOf(".\n"),
		cut.lastIndexOf("\n\n"),
	);
	return `${stop > max * 0.5 ? cut.slice(0, stop + 1) : cut}…`;
}

const link = (h: Hit) =>
	h.chunk.anchor ? `${h.chunk.url}#${h.chunk.anchor}` : h.chunk.url;

export function compose(hits: Hit[]): Answer {
	const [top, ...rest] = hits;
	if (!top) return { body: UNSURE, sources: [], kind: "unsure" };

	const parts = [excerpt(top.chunk.text)];

	if (rest.length > 0) {
		parts.push(
			`**Related pages**\n${rest
				.map((h) => {
					const label =
						h.chunk.heading && h.chunk.heading !== h.chunk.pageTitle
							? `${h.chunk.pageTitle}: ${h.chunk.heading}`
							: h.chunk.pageTitle;
					return `- [${label}](${link(h)})`;
				})
				.join("\n")}`,
		);
	}

	return {
		body: parts.join("\n\n"),
		code: top.chunk.code,
		sources: [
			{
				url: link(top),
				title: top.chunk.pageTitle,
				heading: top.chunk.heading,
				anchor: top.chunk.anchor,
			},
		],
		kind: "answer",
	};
}
