"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { loadMessages, saveMessages } from "@/lib/assistant/session";
import notes from "@/lib/assistant/page-notes.json";
import { talk } from "@/lib/assistant/talk";

export type Status = "idle" | "loading" | "ready" | "failed";

export interface Source {
	url: string;
	title: string;
	heading: string;
	anchor: string;
}

export interface Message {
	id: number;
	role: "you" | "assistant";
	/** What has been revealed so far. Equals `full` once streaming finishes. */
	text: string;
	full: string;
	sources: Source[];
	code?: { lang: string; source: string };
	/** Set when this message was produced by the reader navigating, not by them asking. */
	noteFor?: string;
	streaming: boolean;
}

interface PageNote {
	title: string;
	summary: string;
	topics: { heading: string; anchor: string }[];
}

/**
 * The assistant"s state machine.
 *
 * **The worker starts on first open, never on page load.** A reader who never asks a question
 * never downloads a model, which is the difference between a docs site with a chat and a docs
 * site that costs 23 MB to read.
 *
 * The reveal is a timer over text that already exists. It is deliberately not dressed up as
 * anything else: the answer is retrieved from the page it cites, and the caret says "still
 * arriving", not "still thinking".
 */
export function useAssistant() {
	const [status, setStatus] = useState<Status>("idle");
	const [progress, setProgress] = useState(0);
	// Restored on mount, which is what makes a conversation survive a navigation. Lazy so the
	// read happens once rather than on every render, and after hydration so the server and the
	// client agree on the first paint.
	const [messages, setMessages] = useState<Message[]>([]);
	const [restored, setRestored] = useState(false);

	useEffect(() => {
		const prior = loadMessages();
		if (prior.length > 0) {
			setMessages(prior);
			// Ids are keys and are compared by identity while streaming, so a restored conversation
			// must not hand out one that already exists.
			nextId.current = Math.max(...prior.map((m) => m.id)) + 1;
		}
		setRestored(true);
	}, []);

	useEffect(() => {
		if (restored) saveMessages(messages);
	}, [messages, restored]);
	const [pending, setPending] = useState(false);

	const worker = useRef<Worker | null>(null);
	const nextId = useRef(1);
	const reveal = useRef<number | null>(null);
	/** A question asked before the model finished loading, sent as soon as it is ready. */
	const queued = useRef<string | null>(null);
	/*
	 * `start` has to send the queued question when the worker reports ready, and `send` is
	 * declared below it. A ref keeps `start`"s dependency list empty and honest: listing `send`
	 * would rebuild the worker callback every render for a function that never changes.
	 */
	const sendRef = useRef<(q: string) => void>(() => {});

	const start = useCallback(() => {
		if (worker.current) return;
		setStatus("loading");

		const w = new Worker(
			new URL("../../lib/assistant/worker.ts", import.meta.url),
			{
				type: "module",
			},
		);
		worker.current = w;

		w.addEventListener("message", (event: MessageEvent) => {
			const msg = event.data as
				| { type: "ready" }
				| { type: "progress"; loaded: number; total: number }
				| { type: "failed"; reason: string }
				| {
						type: "answer";
						id: number;
						body: string;
						code?: { lang: string; source: string };
						sources: Source[];
						kind: string;
				  };

			if (msg.type === "ready") {
				setStatus("ready");
				const q = queued.current;
				queued.current = null;
				if (q !== null) sendRef.current(q);
			} else if (msg.type === "progress")
				setProgress(Math.min(1, msg.loaded / Math.max(1, msg.total)));
			else if (msg.type === "failed") setStatus("failed");
			else if (msg.type === "answer") {
				setPending(false);
				setMessages((prev) => [
					...prev,
					{
						id: msg.id,
						role: "assistant",
						text: "",
						full: msg.body,
						sources: msg.sources ?? [],
						code: msg.code,
						streaming: true,
					},
				]);
			}
		});

		w.postMessage({ type: "init" });
	}, []);

	/**
	 * Reveal the newest streaming message a word at a time.
	 *
	 * Word by word rather than character by character: a character typewriter on a 500-word answer
	 * takes half a minute and reads as a gimmick, where words land at about the speed someone
	 * skims. The jitter keeps it from looking like a progress bar.
	 */
	// biome-ignore lint/correctness/useExhaustiveDependencies: re-run only when a new message starts streaming, not on every word it reveals
	useEffect(() => {
		const streaming = messages.find((m) => m.streaming);
		if (!streaming) return;

		const words = streaming.full.split(/(\s+)/);
		let shown =
			streaming.text.length === 0 ? 0 : streaming.text.split(/(\s+)/).length;

		const tick = () => {
			shown += 1;
			const done = shown >= words.length;
			setMessages((prev) =>
				prev.map((m) =>
					m.id === streaming.id
						? { ...m, text: words.slice(0, shown).join(""), streaming: !done }
						: m,
				),
			);
			if (!done)
				reveal.current = window.setTimeout(tick, 14 + Math.random() * 26);
		};

		reveal.current = window.setTimeout(tick, 60);
		return () => {
			if (reveal.current !== null) window.clearTimeout(reveal.current);
		};
		// Only re-run when a new streaming message appears, not on every revealed word.
	}, [messages.find((m) => m.streaming)?.id]);

	/**
	 * Hand a question to the worker. Nothing else.
	 *
	 * It used to also append the user"s message, which double-echoed every first question: `ask`
	 * appended it, queued it because the model was still loading, and the ready handler then
	 * called this, which appended it again. One function appends, one function sends, and the two
	 * are not the same function.
	 */
	const send = useCallback((trimmed: string) => {
		setPending(true);
		worker.current?.postMessage({
			type: "ask",
			id: nextId.current++,
			query: trimmed,
		});
	}, []);

	sendRef.current = send;

	/**
	 * Ask a question: record it once, then either send it or hold it until the model is ready.
	 *
	 * **The download begins on the first question, not when the panel opens.** The panel opens by
	 * itself on a first visit, and charging every reader 23 MB for something they have not asked
	 * for would be the opposite of leaving them free to just read. A question asked while the
	 * model is still arriving is queued and sent the moment it is ready, so the wait is visible
	 * but never loses the question.
	 */
	const ask = useCallback(
		(query: string) => {
			const trimmed = query.trim();
			if (trimmed.length === 0) return;

			// Appended here and nowhere else, so a question appears exactly once whether it was sent
			// immediately or queued behind the model.
			setMessages((prev) => [
				...prev,
				{
					id: nextId.current++,
					role: "you",
					text: trimmed,
					full: trimmed,
					sources: [],
					streaming: false,
				},
			]);
			// Small talk is answered here, at once, without starting the model: "hi" should not cost a
			// reader a 23 MB download. See lib/assistant/talk.ts.
			const quick = talk(trimmed);
			if (quick?.final) {
				setMessages((prev) => [
					...prev,
					{
						id: nextId.current++,
						role: "assistant",
						text: "",
						full: quick.answer.body,
						sources: [],
						streaming: true,
					},
				]);
				return;
			}

			setPending(true);

			if (!worker.current) {
				queued.current = trimmed;
				start();
				return;
			}

			if (status !== "ready") {
				queued.current = trimmed;
				return;
			}

			send(trimmed);
		},
		[send, start, status],
	);

	/**
	 * Notice where the reader just went, and say something useful about it.
	 *
	 * This is the assistant paying attention rather than waiting to be spoken to: click a link in
	 * the sidebar and it tells you what that page covers, with its sections, so the next question
	 * is one word away.
	 *
	 * It is an assistant message, never a user one. Putting "you opened Quick start" in a blue
	 * bubble on the right would be the assistant putting words in the reader"s mouth.
	 *
	 * It needs no model, which is the point: the summaries are a 12 KB map that ships with the
	 * page, so this works from the very first click and long before anyone asks a question.
	 */
	const note = useCallback((rawUrl: string) => {
		/*
		 * A static export serves `/docs/filtering/` with a trailing slash while the index keys it
		 * as `/docs/filtering`, so a straight lookup missed every page but the root. Normalise before
		 * looking up, and keep the normalised form for the links below it.
		 */
		const url = rawUrl.length > 1 ? rawUrl.replace(/\/+$/, "") : "/";
		const page = (notes as Record<string, PageNote | undefined>)[url];
		if (!page) return;

		const lead = "You opened";
		const covers = "This page covers";
		const invite = "Ask me anything about it.";

		const parts = [`**${lead}: ${page.title}**`, page.summary];
		if (page.topics.length > 0) {
			parts.push(
				`${covers}:\n` +
					page.topics
						.map((t) => `- [${t.heading}](${url}#${t.anchor})`)
						.join("\n"),
			);
		}
		parts.push(invite);

		setMessages((prev) => {
			// Never twice in a row for the same page, so a re-render or a hash change is not an
			// event, and never directly after the reader has just spoken.
			const last = prev[prev.length - 1];
			if (last?.role === "assistant" && last.noteFor === url) return prev;
			return [
				...prev,
				{
					id: nextId.current++,
					role: "assistant",
					text: parts.join("\n\n"),
					full: parts.join("\n\n"),
					sources: [],
					noteFor: url,
					streaming: false,
				},
			];
		});
	}, []);

	const reset = useCallback(() => {
		setMessages([]);
		setPending(false);
		queued.current = null;
	}, []);

	return { status, progress, messages, pending, start, ask, reset, note };
}
