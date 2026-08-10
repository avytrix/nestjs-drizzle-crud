import type { PrimaryKeyType, SortColumn, SqlDialect } from "../types/sql.types";

// "belongsTo" (default): many-to-one / one-to-one, loaded with a LEFT JOIN.
// "hasMany": one-to-many, loaded with one extra batched query per relation.
export type RelationType = "belongsTo" | "hasMany";

// A relation declared on an entity, keyed by relation name.
//
// belongsTo: this table's `localKey` references `references` (default "id") on
// `table`, and the relation resolves to a single object or null.
//
// hasMany: `table`'s `foreignKey` points back at this table's `parentKey`
// (default the configured primary key), and the relation resolves to an array.
export interface RelationConfig {
	table: any;
	type?: RelationType;
	// belongsTo: the column on THIS table holding the foreign key.
	localKey?: string;
	// belongsTo: the column on the target table that `localKey` points at.
	references?: string;
	// hasMany: the column on the TARGET table that points back at this table.
	foreignKey?: string;
	// hasMany: the column on THIS table that `foreignKey` points at.
	parentKey?: string;
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
	primaryKeyType: PrimaryKeyType;

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
		jsonSupport: boolean;
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
