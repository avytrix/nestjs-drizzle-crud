import type { Answer } from "./answer";

/**
 * The conversational layer, checked before any retrieval.
 *
 * "hi" is not in any page, so without this a greeting gets "I could not find that". These are
 * fixed, reviewed sentences, so the guarantee in answer.ts holds, and they answer at once, before
 * the model has even downloaded.
 */

/** Lower case, punctuation off, whitespace collapsed. */
export function normalise(text: string): string {
	return text
		.toLowerCase()
		.replace(/[^a-z0-9\s/-]/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

const words = (q: string) => (q ? q.split(" ").length : 0);

const SMALL_TALK: { test: RegExp; maxWords: number; reply: string }[] = [
	{
		test: /^(hi+|hello+|hey+|hiya|yo|howdy|greetings|good (morning|afternoon|evening))\b/,
		maxWords: 5,
		reply:
			"Hi. I answer questions about nestjs-drizzle-crud from these docs.\n\nA few things people ask:\n- How do I filter by a related column?\n- How does soft delete work?\n- How do I paginate with a cursor?\n- How do I scope every query to a tenant?\n\nOr ask in your own words. Every answer links to the page it came from.",
	},
	{
		test: /^(thanks?|thank you|thx|ty|cheers|perfect|awesome|great)\b/,
		maxWords: 6,
		reply: "You're welcome. Ask me anything else whenever you like.",
	},
	{
		test: /^(bye|goodbye|see you|see ya|later)\b/,
		maxWords: 5,
		reply: "Bye. The docs are here whenever you need them.",
	},
	{
		test: /^(what can you do|what do you do|who are you|what are you|help|how does this work)\b/,
		maxWords: 8,
		reply:
			"I search these docs by meaning, not just keywords, and answer with the section that fits best, plus links to related pages. I run entirely in your browser: the first question downloads a small search model, and nothing you type leaves this device.\n\nI only know what the docs say, so I will tell you when a question is not covered.",
	},
];

/**
 * A reply for small talk, or undefined to fall through to retrieval. `final` means the reply is
 * the whole answer, so the caller does not need to start the model.
 */
export function talk(
	text: string,
): { answer: Answer; final: boolean } | undefined {
	const q = normalise(text);
	for (const rule of SMALL_TALK) {
		if (words(q) <= rule.maxWords && rule.test.test(q)) {
			return {
				answer: { body: rule.reply, sources: [], kind: "answer" },
				final: true,
			};
		}
	}
	return undefined;
}
