import type {
	PrimaryKeyType,
	SortColumn,
	SqlDialect,
} from "../types/sql.types";

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

export interface SqlCrudConfig {
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
}
