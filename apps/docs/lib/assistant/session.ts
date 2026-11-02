import type { Message } from "@/components/assistant/use-assistant";

/**
 * The conversation, kept across navigation and across closing the panel.
 *
 * A Next navigation remounts the panel, so without this every sidebar click threw the
 * conversation away. `sessionStorage` on purpose: a conversation belongs to the tab and the
 * sitting, not to next week. Every access is wrapped, because a private window or blocked site
 * data throws, and an assistant that takes the page down with it is worse than one that forgets.
 */

const KEY = "ndc-assistant-session-v1";
const OPEN_KEY = "ndc-assistant-open";

/** Capped so a long sitting cannot grow past the quota and start throwing on every write. */
const MAX_MESSAGES = 60;

export function loadMessages(): Message[] {
	try {
		const raw = sessionStorage.getItem(KEY);
		if (!raw) return [];
		const parsed: unknown = JSON.parse(raw);
		if (!Array.isArray(parsed)) return [];
		// A message that was mid-reveal when the page changed comes back finished.
		return parsed
			.filter(
				(m): m is Message => typeof m === "object" && m !== null && "role" in m,
			)
			.map((m) => ({ ...m, text: m.full ?? m.text, streaming: false }));
	} catch {
		return [];
	}
}

export function saveMessages(messages: Message[]): void {
	try {
		const trimmed = messages
			.slice(-MAX_MESSAGES)
			.map((m) => ({ ...m, text: m.full, streaming: false }));
		sessionStorage.setItem(KEY, JSON.stringify(trimmed));
	} catch {
		// Over quota or blocked: the conversation stays in memory for this page only.
	}
}

export function clearMessages(): void {
	try {
		sessionStorage.removeItem(KEY);
	} catch {
		// Blocked storage has nothing to clear.
	}
}

/**
 * Whether the panel is open, as an external store for `useSyncExternalStore`. The server has no
 * session, so its snapshot is always closed and hydration never mismatches.
 */
const listeners = new Set<() => void>();

export function subscribeOpen(cb: () => void): () => void {
	listeners.add(cb);
	return () => listeners.delete(cb);
}

export function getOpen(): boolean {
	try {
		return sessionStorage.getItem(OPEN_KEY) === "1";
	} catch {
		return false;
	}
}

export function getOpenOnServer(): boolean {
	return false;
}

export function setOpen(open: boolean): void {
	try {
		sessionStorage.setItem(OPEN_KEY, open ? "1" : "0");
	} catch {
		// The panel still opens; it just will not survive a navigation.
	}
	for (const cb of listeners) cb();
}
