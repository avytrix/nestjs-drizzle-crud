import type {
	PrimaryKeyType,
	SortColumn,
	SqlDialect,
} from "../types/sql.types";
import type { CrudEventBus } from "../events/crud-event-bus";
import type {
	BulkMode,
	CrudAllowlists,
	RelationCounts,
} from "./query.interface";
import type { CrudContextValue, CrudScope } from "./scope.interface";

// "belongsTo" (default): many-to-one / one-to-one, loaded with a LEFT JOIN.
// "hasMany": one-to-many, loaded with one extra batched query per relation.
// "manyToMany": through a join table, also one extra batched query.
export type RelationType = "belongsTo" | "hasMany" | "manyToMany";

// A relation declared on an entity, keyed by relation name.
//
// belongsTo: this table's `localKey` references `references` (default "id") on
// `table`, and the relation resolves to a single object or null.
//
// hasMany: `table`'s `foreignKey` points back at this table's `parentKey`
// (default the configured primary key), and the relation resolves to an array.
//
// manyToMany: `through` holds `throughLocalKey` (matching this table's
// `parentKey`) and `throughForeignKey` (matching `references` on `table`), and
// the relation resolves to an array.
export interface RelationConfig {
	table: any;
	type?: RelationType;
	// belongsTo: the column on THIS table holding the foreign key.
	localKey?: string;
	// belongsTo / manyToMany: the column on the target table being referenced.
	references?: string;
	// hasMany: the column on the TARGET table that points back at this table.
	foreignKey?: string;
	// hasMany / manyToMany: the column on THIS table being pointed at.
	parentKey?: string;
	// manyToMany: the join table, and its two foreign-key columns.
	through?: any;
	throughLocalKey?: string;
	throughForeignKey?: string;
	// hasMany / manyToMany: how to order the collection. Applied in order.
	orderBy?: SortColumn[];
	// Relations of the RELATED table, so a caller can eager-load a relation of a
	// relation with a dotted path: options.relations: ['state', 'state.country'].
	relations?: RelationsConfig;
}

// One resolved node in an eager-loading plan, built from the dotted paths in
// options.relations.
export interface RelationNode {
	name: string;
	config: RelationConfig;
	children: RelationNode[];
	// Set when the relation is folded into the main query as a LEFT JOIN rather
	// than loaded by its own batched query.
	joined?: boolean;
}

// Columns requested for a table, plus the columns requested for its relations.
// Built from `options.select`, where a dotted entry addresses a relation.
export interface SelectTree {
	base: string[];
	relations: Record<string, SelectTree>;
}

export type RelationsConfig = Record<string, RelationConfig>;

export type SqlSearchMode = "ilike" | "fullText";

export interface SqlSearchOptions {
	term: string;
	columns: string[];
	mode?: SqlSearchMode;
}

// The allowlists (filterableColumns, sortableColumns, selectableColumns,
// searchableColumns, loadableRelations, writableColumns) come from
// CrudAllowlists. Unset, each allows everything.
export interface SqlCrudConfig extends CrudAllowlists {
	// Database configuration
	dialect: SqlDialect;
	db: any; // Drizzle database instance
	table: any; // Drizzle table

	// Primary key configuration
	primaryKey: string;
	/**
	 * @deprecated Has no effect: the key type comes from the Drizzle column.
	 * Still accepted so existing configs compile; it will be removed in the next
	 * major version.
	 */
	primaryKeyType?: PrimaryKeyType;

	// Soft delete
	softDelete?: {
		enabled: boolean;
		column: string;
	};

	// Timestamps
	timestamps?: {
		createdAt: string;
		updatedAt: string;
	};

	// Pagination
	pagination?: {
		defaultLimit: number;
		maxLimit: number;
	};

	// Default ORDER BY applied by findAll() when the caller passes no sortBy.
	// Columns are applied in order (primary sort first, then tiebreakers).
	defaultSort?: SortColumn[];

	// SQL-specific optimizations
	sql?: {
		caseSensitive: boolean;
		useReturning: boolean;
		/** @deprecated Has no effect. Nothing reads it; it will be removed in the next major version. */
		jsonSupport: boolean;
		/** @deprecated Has no effect. Full-text search works on PostgreSQL whatever this is set to; it will be removed in the next major version. */
		enableFullTextSearch: boolean;
	};

	// Relations keyed by relation name: belongs-to (default) and has-many.
	// Enables eager loading (options.relations) and filtering by related columns
	// (filters: { <relationName>: { <col>: value } }).
	relations?: RelationsConfig;

	// Tenant or ownership scope: `column: value` pairs ANDed into every read,
	// count and write, and set on every row a create or upsert inserts. A
	// function reads the call's context: `(ctx) => ({ tenant_id: ctx.tenantId })`.
	scope?: CrudScope;

	// Optimistic locking: an integer column that starts at 1 and goes up by one
	// on every write. An update, soft delete, restore or delete that names a
	// stale version (in the body under this key, or `options.expectedVersion`)
	// is a 409.
	versionColumn?: string;

	// The module-level event bus. Set by DrizzleCrudModule when
	// `hooks.enableGlobalHooks` is on; pass your own when you build a service
	// by hand.
	events?: CrudEventBus;
}

export interface SqlOperationOptions {
	transaction?: any;
	relations?: string[];
	// Columns to return instead of every column. A dotted entry narrows an
	// eager-loaded relation: ["id", "name", "region.code"].
	select?: string[];
	search?: SqlSearchOptions;
	hooks?: {
		skipBefore?: boolean;
		skipAfter?: boolean;
	};
	lock?: "update" | "share" | "none";
	forNoKeyUpdate?: boolean;
	// Soft delete scope for reads (and for the existence check of delete): also
	// return soft-deleted rows, or return only them. Related tables keep
	// hiding their own deleted rows.
	withDeleted?: boolean;
	onlyDeleted?: boolean;
	// Skip the per-entity allowlists for a trusted, server-side call.
	skipAllowlists?: boolean;
	// Mass writes: one statement for the batch ("set", the default) or the
	// single-row method per item in its own savepoint ("perItem").
	bulkMode?: BulkMode;
	// Relation counts put on each row under `_count`, one grouped query per
	// relation for the whole result: ["posts"] gives `_count: { posts: 3 }`.
	counts?: RelationCounts;
	// The context a function `scope` reads. Defaults to `CrudContext.current()`.
	context?: CrudContextValue;
	// Run this trusted, server-side call without the entity's scope.
	skipScope?: boolean;
	// Do not raise module-level events for this call. The per-service hooks
	// follow `hooks.skipBefore` / `hooks.skipAfter` as before.
	skipEvents?: boolean;
	// Optimistic locking: the version the caller last read. A row at another
	// version is a 409.
	expectedVersion?: number;
	// Optimistic locking for mass writes: the version per id, keyed by the id
	// as a string. Any id at another version is a 409 for that id.
	expectedVersions?: Record<string, number>;
}
