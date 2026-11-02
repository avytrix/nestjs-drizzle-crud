import type { CrudContextValue } from "./scope.interface";

// The writes that raise events. Mass calls raise the same operation with
// `bulk: true`, once for the whole batch.
export type CrudWriteOperation =
	| "create"
	| "update"
	| "upsert"
	| "softDelete"
	| "restore"
	| "delete"
	| "attach"
	| "detach"
	| "sync";

export type CrudEventPhase = "before" | "after";

// One write, as a subscriber sees it.
export interface CrudEvent<T = any> {
	/** The table name of the entity, as Drizzle reports it. */
	entity: string;
	operation: CrudWriteOperation;
	phase: CrudEventPhase;
	/** True for massCreate, massUpdate, massUpsert, massSoftDelete, massRestore and massDelete. */
	bulk: boolean;
	/** The primary keys the write targets. Empty before a create or upsert. */
	ids: unknown[];
	/** What the caller passed: the DTO, the array of DTOs, or the related ids of attach / detach / sync. */
	input?: unknown;
	/** After the write: the rows as stored (create, update, upsert, restore, attach, detach, sync). Empty for deletes. */
	rows: T[];
	/** The transaction the write runs in, when there is one. */
	transaction?: unknown;
	/** The context of the call (`options.context` or `CrudContext`). */
	context?: CrudContextValue;
}

type Listener<T> = (event: CrudEvent<T>) => void | Promise<void>;

// A module-level subscriber. Every method is optional. `beforeWrite` and
// `afterWrite` see every operation; the named methods see one. A before
// listener that throws stops the write; an after listener that throws inside a
// transaction (every mass call) rolls it back.
export interface CrudSubscriber<T = any> {
	/** Only these entities (table names). Unset, every entity. */
	entities?: string[];
	beforeWrite?: Listener<T>;
	afterWrite?: Listener<T>;
	beforeCreate?: Listener<T>;
	afterCreate?: Listener<T>;
	beforeUpdate?: Listener<T>;
	afterUpdate?: Listener<T>;
	beforeUpsert?: Listener<T>;
	afterUpsert?: Listener<T>;
	beforeSoftDelete?: Listener<T>;
	afterSoftDelete?: Listener<T>;
	beforeRestore?: Listener<T>;
	afterRestore?: Listener<T>;
	beforeDelete?: Listener<T>;
	afterDelete?: Listener<T>;
	beforeAttach?: Listener<T>;
	afterAttach?: Listener<T>;
	beforeDetach?: Listener<T>;
	afterDetach?: Listener<T>;
	beforeSync?: Listener<T>;
	afterSync?: Listener<T>;
}
