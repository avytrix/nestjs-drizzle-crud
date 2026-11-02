import type { CrudEvent, CrudSubscriber } from "../interfaces/events.interface";

// The module-level event bus behind `hooks.enableGlobalHooks`. DrizzleCrudModule
// provides one instance and hands it to every service when global hooks are
// on. Inject it to subscribe:
//
//   constructor(bus: CrudEventBus) {
//     bus.subscribe({ afterWrite: (e) => audit.log(e) });
//   }
//
// Listeners run one after another, in the order they subscribed, and are
// awaited, so an audit row written in `afterWrite` with `event.transaction`
// commits or rolls back with the write.
export class CrudEventBus {
	private readonly subscribers = new Set<CrudSubscriber>();

	/** Add a subscriber. Returns a function that removes it again. */
	subscribe(subscriber: CrudSubscriber): () => void {
		this.subscribers.add(subscriber);
		return () => {
			this.subscribers.delete(subscriber);
		};
	}

	get size(): number {
		return this.subscribers.size;
	}

	async emit(event: CrudEvent): Promise<void> {
		if (this.subscribers.size === 0) return;
		const named = `${event.phase}${event.operation[0]!.toUpperCase()}${event.operation.slice(1)}`;
		const general = event.phase === "before" ? "beforeWrite" : "afterWrite";
		for (const subscriber of Array.from(this.subscribers)) {
			if (subscriber.entities && !subscriber.entities.includes(event.entity)) {
				continue;
			}
			await subscriber[general]?.(event);
			await (subscriber as Record<string, any>)[named]?.(event);
		}
	}
}
