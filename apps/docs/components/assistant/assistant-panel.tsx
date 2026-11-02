"use client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { ArrowUp, Bot, RotateCcw, Sparkles, X } from "lucide-react";
import { useAssistant, type Message } from "./use-assistant";
import {
	clearMessages,
	getOpen,
	getOpenOnServer,
	setOpen as writeOpen,
	subscribeOpen,
} from "@/lib/assistant/session";

const SEEN_KEY = "ndc-assistant-greeted";

const COPY = {
	open: "Ask the docs",
	title: "Ask the docs",
	subtitle: "Answers come from these docs, quoted, never made up.",
	firstLoad:
		"Runs in your browser. The first question downloads a 23 MB search model, cached after that. Nothing you type leaves this device.",
	placeholder: "How do I filter by a related column?",
	loading: "Getting ready",
	failed:
		"The assistant could not start on this device. Every answer it would have given is on the pages themselves, and Cmd+K still searches them.",
	thinking: "Searching the docs",
	send: "Send",
	close: "Close",
	restart: "Start a new conversation",
	source: "Source",
	suggestions: [
		"How do I filter by a related column?",
		"How does soft delete work?",
		"How do I paginate with a cursor?",
		"How do I scope every query to a tenant?",
	],
} as const;

/**
 * Hold back a markdown construct the reveal has not finished.
 *
 * A word-at-a-time reveal lands mid-syntax, and `[Soft delete` with no closing bracket
 * renders as a literal bracket, which looks like a bug rather than like typing. Cutting at the
 * last unterminated marker costs a few characters of latency and keeps every frame valid.
 */
function stable(text: string): string {
	const openLink = text.lastIndexOf("[");
	if (openLink !== -1 && !/\]\([^)]*\)\s*$/.test(text.slice(openLink))) {
		const closed = text.slice(openLink).match(/^\[[^\]]*\]\([^)]*\)/);
		if (!closed) return text.slice(0, openLink);
	}
	const ticks = (text.match(/`/g) ?? []).length;
	if (ticks % 2 === 1) return text.slice(0, text.lastIndexOf("`"));
	const bolds = (text.match(/\*\*/g) ?? []).length;
	if (bolds % 2 === 1) return text.slice(0, text.lastIndexOf("**"));
	return text;
}

/** Only links that stay on the web: http(s), a site path, or an anchor. */
const safeHref = (href: string) =>
	/^(https?:\/\/|\/|#)/.test(href) ? href : "#";

/**
 * Inline formatting for one line: bold, code, links, bare URLs.
 *
 * Kept separate from the block pass because the two cannot be done in one sweep: replacing every
 * newline with `<br/>` put a stray break after each list item. The text is escaped first (`&`,
 * `<` and `"`), so neither a docs chunk nor what a reader types can add markup or break out of
 * an attribute, and link targets are limited to web URLs.
 */
function inline(text: string): string {
	return (
		text
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/"/g, "&quot;")
			.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
			.replace(
				/`([^`]+)`/g,
				'<code class="bg-fd-muted rounded px-1 py-0.5 text-[0.85em]">$1</code>',
			)
			.replace(
				/\[([^\]]+)\]\(([^)]+)\)/g,
				(_m, label: string, href: string) =>
					`<a href="${safeHref(href)}" class="text-fd-primary underline underline-offset-2">${label}</a>`,
			)
			/*
			 * Bare URLs become links. The chunks carry their targets as `label (https://...)`, right
			 * for plain text and unusable in a bubble nobody can click. Runs after the markdown pass
			 * so an href is not linked twice, and shows the host and path rather than the scheme.
			 */
			.replace(
				/(^|[\s(])(https?:\/\/[^\s<)]+)/g,
				(_m, lead: string, url: string) => {
					const shown = url.replace(/^https?:\/\//, "");
					return `${lead}<a href="${url}" class="text-fd-primary underline underline-offset-2 break-all">${shown}</a>`;
				},
			)
	);
}

/**
 * Markdown, only the subset the composed answers use, parsed as blocks.
 *
 * Blocks rather than a string of `<br/>`: a list is a `<ul>` with its own spacing, a paragraph
 * is a `<p>`, and the gaps come from CSS instead of from stray line breaks.
 */
function Rendered({
	text,
	streaming = false,
}: {
	text: string;
	streaming?: boolean;
}) {
	const source = streaming ? stable(text) : text;
	const out: string[] = [];
	let list: string[] = [];
	let para: string[] = [];

	const flushList = () => {
		if (list.length === 0) return;
		out.push(
			`<ul class="my-2 space-y-1 pl-4">${list
				.map((i) => `<li class="list-disc leading-snug">${i}</li>`)
				.join("")}</ul>`,
		);
		list = [];
	};

	const flushPara = () => {
		if (para.length === 0) return;
		// A lone bold line is a label for whatever follows it ("Related pages"), so it keeps its
		// top margin and drops the bottom one rather than floating between two blocks.
		const only = para.length === 1 ? (para[0] ?? "") : "";
		const isLabel = /^<strong>[^<]*<\/strong>$/.test(only);
		const cls = isLabel ? "mt-3 mb-1 first:mt-0" : "my-2 first:mt-0 last:mb-0";
		out.push(`<p class="${cls}">${para.join(" ")}</p>`);
		para = [];
	};

	for (const raw of source.split("\n")) {
		const line = raw.trim();

		if (line.length === 0) {
			flushPara();
			flushList();
			continue;
		}

		const item = /^[-*]\s+(.*)$/.exec(line);
		if (item) {
			flushPara();
			list.push(inline(item[1] ?? ""));
			continue;
		}

		flushList();
		para.push(inline(line));
	}
	flushPara();
	flushList();

	return (
		// biome-ignore lint/security/noDangerouslySetInnerHtml: built by inline() above, which escapes &, < and " first and only links to web URLs
		<div dangerouslySetInnerHTML={{ __html: out.join("") }} />
	);
}

function Bubble({ message }: { message: Message }) {
	const mine = message.role === "you";

	return (
		<div
			className={`assistant-message-in flex ${mine ? "justify-end" : "justify-start"}`}
		>
			<div
				className={
					mine
						? "bg-fd-primary max-w-[85%] rounded-2xl rounded-br-md px-4 py-2.5 text-sm text-fd-primary-foreground"
						: "bg-fd-card border-fd-border max-w-[92%] rounded-2xl rounded-bl-md border px-4 py-3 text-sm leading-[1.6]"
				}
			>
				<Rendered text={message.text} streaming={message.streaming} />
				{!message.streaming && message.code && (
					<pre className="bg-fd-muted mt-3 overflow-x-auto rounded-lg p-3 text-[0.8rem] leading-[1.8]">
						<code>{message.code.source}</code>
					</pre>
				)}
				{message.streaming && (
					<span className="assistant-caret bg-fd-primary ml-0.5 inline-block h-[1em] w-[2px] translate-y-[2px]" />
				)}
				{!message.streaming && message.sources.length > 0 && (
					<div className="border-fd-border mt-3 space-y-1 border-t pt-2.5">
						{message.sources.map((s) => (
							<a
								key={s.url}
								href={s.url}
								className="text-fd-muted-foreground hover:text-fd-accent-foreground flex items-baseline gap-1.5 text-xs leading-snug"
							>
								<span className="shrink-0 opacity-70">{COPY.source}</span>
								<span className="underline underline-offset-2">
									{s.title}
									{s.heading && s.heading !== s.title ? ` · ${s.heading}` : ""}
								</span>
							</a>
						))}
					</div>
				)}
			</div>
		</div>
	);
}

function Typing({ label }: { label: string }) {
	return (
		<div
			role="status"
			className="assistant-message-in bg-fd-card border-fd-border flex w-fit items-center gap-[5px] rounded-2xl rounded-bl-md border px-4 py-3.5"
		>
			<span className="sr-only">{label}</span>
			{[0, 1, 2].map((d) => (
				<span
					key={d}
					aria-hidden="true"
					className="assistant-typing bg-fd-primary size-[7px] rounded-full"
					style={{ ["--d" as string]: `${d * 160}ms` }}
				/>
			))}
		</div>
	);
}

/**
 * The assistant, as a panel over the documentation.
 *
 * It starts closed and starts nothing: the worker and the model load on the first open, so a
 * reader who never asks pays nothing. If the model cannot load the panel says so plainly and
 * points at the pages, because the answer was always on a page anyway.
 */
export function AssistantPanel() {
	const t = COPY;
	// Read straight from the store, so a navigation reopens it without a corrective render.
	const open = useSyncExternalStore(subscribeOpen, getOpen, getOpenOnServer);
	const setOpen = writeOpen;
	const [draft, setDraft] = useState("");
	const { status, progress, messages, pending, ask, reset, note } =
		useAssistant();
	const pathname = usePathname();
	const firstPath = useRef<string | null>(null);
	const scroller = useRef<HTMLDivElement>(null);
	const input = useRef<HTMLTextAreaElement>(null);

	/*
	 * Introduce the assistant once, on a first visit, and never on a phone.
	 *
	 * A newcomer should see it exists without hunting for a button. It is remembered in
	 * `localStorage` so it does not reintroduce itself to a returning reader, and it is skipped
	 * below `sm`, where the panel is a full-height sheet: opening that unasked would cover the page
	 * someone came to read.
	 *
	 * Storage is wrapped because a private window or blocked site data throws on access, and an
	 * assistant that takes down the page it sits on is worse than one that greets you twice.
	 */
	useEffect(() => {
		if (getOpen()) return;

		let seen = true;
		try {
			seen = window.localStorage.getItem(SEEN_KEY) === "1";
		} catch {
			seen = true;
		}
		if (seen) return;

		try {
			window.localStorage.setItem(SEEN_KEY, "1");
		} catch {
			/* blocked storage: it just greets again next time */
		}

		if (!window.matchMedia("(min-width: 640px)").matches) return;

		const t = window.setTimeout(() => writeOpen(true), 900);
		return () => window.clearTimeout(t);
	}, []);

	useEffect(() => {
		if (open && status !== "failed") input.current?.focus();
	}, [open, status]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: scroll to the bottom whenever a message or the typing dots appear
	useEffect(() => {
		scroller.current?.scrollTo({
			top: scroller.current.scrollHeight,
			behavior: "smooth",
		});
	}, [messages, pending]);

	/*
	 * Follow the reader.
	 *
	 * Only while the panel is open, so a note always appears somewhere the reader can see it
	 * happen. Arriving on a page is not a navigation, so the first path is recorded and skipped;
	 * otherwise opening the docs would start every conversation with a note nobody asked for.
	 */
	useEffect(() => {
		if (firstPath.current === null) {
			firstPath.current = pathname;
			return;
		}
		if (pathname === firstPath.current) return;
		firstPath.current = pathname;
		if (open) note(pathname);
	}, [pathname, open, note]);

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") writeOpen(false);
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, []);

	const submit = () => {
		ask(draft);
		setDraft("");
	};

	if (!open) {
		return (
			<button
				type="button"
				onClick={() => setOpen(true)}
				aria-label={t.open}
				className="bg-fd-primary fixed right-4 bottom-4 z-40 flex items-center gap-2 rounded-full px-4 py-3 text-sm font-medium text-fd-primary-foreground shadow-lg transition-transform duration-150 hover:scale-[1.03] sm:right-5 sm:bottom-5"
			>
				<Sparkles className="size-4 shrink-0" />
				<span className="hidden sm:inline">{t.open}</span>
			</button>
		);
	}

	return (
		<div
			role="dialog"
			aria-label={t.title}
			className="assistant-panel-in bg-fd-background border-fd-border fixed inset-0 z-50 flex h-[100dvh] w-full flex-col overflow-hidden border shadow-2xl sm:inset-auto sm:right-4 sm:bottom-4 sm:h-[min(620px,calc(100dvh-2rem))] sm:w-[min(440px,calc(100vw-2rem))] sm:rounded-2xl"
		>
			<header className="border-fd-border flex items-start justify-between gap-3 border-b px-4 py-3">
				<div className="flex items-start gap-2.5">
					<Bot className="text-fd-primary mt-0.5 size-5 shrink-0" />
					<div>
						<p className="text-sm font-semibold">{t.title}</p>
						<p className="text-fd-muted-foreground text-xs">{t.subtitle}</p>
					</div>
				</div>
				<div className="flex shrink-0 items-center gap-1">
					{messages.length > 0 && (
						<button
							type="button"
							onClick={() => {
								clearMessages();
								reset();
							}}
							aria-label={t.restart}
							title={t.restart}
							className="text-fd-muted-foreground hover:text-fd-accent-foreground p-1"
						>
							<RotateCcw className="size-4" />
						</button>
					)}
					<button
						type="button"
						onClick={() => setOpen(false)}
						aria-label={t.close}
						className="text-fd-muted-foreground hover:text-fd-accent-foreground -mr-1 p-1"
					>
						<X className="size-4" />
					</button>
				</div>
			</header>

			<div
				ref={scroller}
				className="flex-1 space-y-3 overflow-y-auto px-4 py-4"
			>
				{status === "failed" && (
					<p className="text-fd-muted-foreground text-sm">{t.failed}</p>
				)}

				{status === "idle" && messages.length === 0 && (
					<p className="text-fd-muted-foreground mb-3 text-xs leading-relaxed">
						{t.firstLoad}
					</p>
				)}

				{status !== "failed" && messages.length === 0 && (
					<div className="space-y-2">
						{t.suggestions.map((q, i) => (
							<button
								key={q}
								type="button"
								onClick={() => ask(q)}
								className="assistant-message-in border-fd-border hover:bg-fd-accent block w-full rounded-xl border px-3 py-2 text-left text-sm"
								style={{ ["--delay" as string]: `${i * 60}ms` }}
							>
								{q}
							</button>
						))}
					</div>
				)}

				{messages.map((m) => (
					<Bubble key={m.id} message={m} />
				))}

				{/* The download, shown under the question that started it, so the wait is visible. */}
				{status === "loading" && (
					<div className="text-fd-muted-foreground assistant-message-in space-y-2 text-xs">
						<p>
							{t.loading}
							{progress > 0 ? ` ${Math.round(progress * 100)}%` : "…"}
						</p>
						<div className="bg-fd-muted h-1 overflow-hidden rounded-full">
							<div
								className="bg-fd-primary h-full rounded-full transition-[width] duration-200"
								style={{ width: `${Math.max(4, progress * 100)}%` }}
							/>
						</div>
					</div>
				)}

				{pending && status !== "loading" && <Typing label={t.thinking} />}
			</div>

			<div className="border-fd-border border-t p-3">
				<div className="border-fd-border focus-within:border-fd-primary flex items-end gap-2 rounded-xl border px-3 py-2 transition-colors">
					<textarea
						ref={input}
						rows={1}
						value={draft}
						disabled={status === "failed"}
						onChange={(e) => setDraft(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter" && !e.shiftKey) {
								e.preventDefault();
								submit();
							}
						}}
						placeholder={t.placeholder}
						className="max-h-28 flex-1 resize-none bg-transparent text-sm outline-none disabled:opacity-50"
					/>
					<button
						type="button"
						onClick={submit}
						disabled={status === "failed" || draft.trim().length === 0}
						aria-label={t.send}
						className="bg-fd-primary shrink-0 rounded-lg p-1.5 text-fd-primary-foreground disabled:opacity-30"
					>
						<ArrowUp className="size-4" />
					</button>
				</div>
			</div>
		</div>
	);
}
