import { AsyncLocalStorage } from "node:async_hooks";
import type { CrudContextValue } from "../interfaces/scope.interface";

const storage = new AsyncLocalStorage<CrudContextValue>();

// The per-request context a scope resolver reads, kept in Node's
// AsyncLocalStorage so it follows the request through every await without
// being passed by hand. `options.context` on a call wins over it.
export const CrudContext = {
	/** Run `fn` with `context` as the current context. */
	run<R>(context: CrudContextValue, fn: () => R): R {
		return storage.run(context, fn);
	},

	/** The context of the code that is running, or undefined outside one. */
	current(): CrudContextValue | undefined {
		return storage.getStore();
	},

	/**
	 * An Express style middleware that resolves the context from the request
	 * and runs the rest of the request inside it:
	 *
	 *   consumer.apply(CrudContext.middleware((req) => ({
	 *     tenantId: req.user?.tenantId,
	 *   }))).forRoutes("*");
	 */
	middleware<Req = any>(
		resolve: (request: Req) => CrudContextValue,
	): (
		request: Req,
		response: unknown,
		next: (error?: unknown) => void,
	) => void {
		return (request, _response, next) => {
			let context: CrudContextValue;
			try {
				context = resolve(request);
			} catch (error) {
				next(error);
				return;
			}
			storage.run(context, () => next());
		};
	},
};
