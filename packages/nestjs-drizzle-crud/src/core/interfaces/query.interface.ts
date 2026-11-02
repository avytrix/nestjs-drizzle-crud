import type { SortColumn, SortOrder } from "../types/sql.types";
import type {
	RelationsConfig,
	SqlOperationOptions,
	SqlSearchOptions,
} from "./sql-crud-config.interface";

// The operators a column filter accepts: `{ age: { gte: 18, lt: 65 } }`.
// Pattern operators (`startsWith`, `endsWith`, `contains` and their `i`
// variants) escape `%`, `_` and `\` in the value, so they match it literally.
// `arrayContains`, `arrayOverlaps` and `jsonContains` are PostgreSQL only.
export interface FilterOperators {
	eq?: unknown;
	neq?: unknown;
	gt?: unknown;
	gte?: unknown;
	lt?: unknown;
	lte?: unknown;
	/** A LIKE pattern you write yourself, wildcards included. */
	like?: string;
	/** An ILIKE pattern (LIKE on MySQL), wildcards included. */
	ilike?: string;
	in?: unknown[];
	notIn?: unknown[];
	/** Inclusive range, `[from, to]`. */
	between?: [unknown, unknown];
	isNull?: boolean | "true" | "false";
	isNotNull?: boolean | "true" | "false";
	/** Follows `sql.caseSensitive`, like an exact match. */
	startsWith?: string;
	endsWith?: string;
	contains?: string;
	/** Always case-insensitive. */
	iStartsWith?: string;
	iEndsWith?: string;
	iContains?: string;
	/** PostgreSQL arrays: the column holds every value (`@>`). */
	arrayContains?: unknown[];
	/** PostgreSQL arrays: the column holds at least one of the values (`&&`). */
	arrayOverlaps?: unknown[];
	/** PostgreSQL jsonb: the column contains this JSON value (`@>`). */
	jsonContains?: unknown;
}

export type FilterOperator = keyof FilterOperators;

export type FilterScalar = string | number | boolean | bigint | Date;

// What one column accepts: a value (exact match), an array (IN), `null` and
// `undefined` (skipped), or an object of operators.
export type ColumnFilter =
	| FilterScalar
	| FilterScalar[]
	| FilterOperators
	| null
	| undefined;

// Boolean groups. Every key of a filter object is ANDed; `or`, `and` and `not`
// nest, and their members are filter objects in their own right, so they can
// hold column, relation and collection filters and further groups.
export interface FilterGroup {
	and?: CrudFilter[];
	or?: CrudFilter[];
	not?: CrudFilter;
}

// The filter object `findAll`, `findByCursor` and `count` take. A key is a
// column, a relation (whose value filters the related table's columns) or a
// group key.
export type CrudFilter = FilterGroup & {
	[key: string]: ColumnFilter | CrudFilter | CrudFilter[];
};

// A caller sort: one column, a list of columns, or a list of SortColumn. In a
// list, a `-` prefix sorts that column descending and anything else ascending.
// A dotted name sorts by a column of a top-level belongs-to relation:
// `["region.name", "-name"]`.
export type SortInput = string | Array<string | SortColumn>;

// Keyset pagination for `findByCursor`. Pass no cursor (or `null`) for the
// first page, then the `nextCursor` of each page to get the next one.
export interface CursorPaginationOptions {
	/** The opaque `nextCursor` from the previous page. */
	cursor?: string | null;
	/** Alias of `cursor`. */
	after?: string | null;
	limit?: number;
	sortBy?: SortInput;
	sortOrder?: SortOrder;
	/** Also run the count query and return `total`. Off by default. */
	count?: boolean;
}

export interface CursorPage<T> {
	data: T[];
	limit: number;
	/** Pass it as `cursor` to get the next page; `null` on the last page. */
	nextCursor: string | null;
	/** Only present when `count: true` was asked for. */
	total?: number;
}

// Which columns and relations a caller may touch. Every list is optional, and
// an unset list allows everything, which is the 3.3 behaviour. A request that
// names something outside a set list is a 400. Relation columns are written
// with a dot: "region.name".
export interface CrudAllowlists {
	/** Columns (and "relation.column") a filter may use. */
	filterableColumns?: string[];
	/** Columns (and "belongsTo.column") a caller may sort by. */
	sortableColumns?: string[];
	/** Columns (and "relation.column", any depth) `select` may name. */
	selectableColumns?: string[];
	/** Columns `search` and `fullTextSearch` may search. */
	searchableColumns?: string[];
	/** Relation paths `relations` may load. "states.cities" also allows "states". */
	loadableRelations?: string[];
	/**
	 * Columns create, update and upsert may write. Unset, the package ignores
	 * the columns it manages itself (see the docs); set, any other column is a
	 * 400.
	 */
	writableColumns?: string[];
}

// How a mass write runs. "set" (the default) is one statement for the whole
// batch. "perItem" runs every item through the single-row method in its own
// savepoint, hooks and all, as 3.3 did.
export type BulkMode = "set" | "perItem";

export interface UpsertOptions {
	/** The unique column(s) that decide "already exists". Defaults to the primary key. Ignored on MySQL, which uses every unique key. */
	conflictTarget?: string | string[];
	/** Columns to overwrite when the row exists. Defaults to every column you sent except the conflict target, the primary key and the createdAt column. */
	update?: string[];
}

// Options for parseCrudQuery. The allowlists work as they do on the service.
export interface ParseCrudQueryOptions extends CrudAllowlists {
	/** The entity's relations, so `region[name]=Asia` and `with=region` resolve. */
	relations?: RelationsConfig;
	primaryKey?: string;
	/** Columns `?search=` looks in. Defaults to `searchableColumns`. */
	searchColumns?: string[];
	/** Accept `withDeleted` and `onlyDeleted`. Off by default. */
	allowTrash?: boolean;
	/** Query keys to leave alone, for parameters your controller reads itself. */
	ignore?: string[];
}

export interface ParsedCrudQuery {
	filters: CrudFilter;
	pagination: {
		page?: number;
		limit?: number;
		sortBy?: SortColumn[];
		cursor?: string | null;
		count?: boolean;
	};
	sort: SortColumn[];
	select?: string[];
	relations?: string[];
	search?: SqlSearchOptions;
	/** `select`, `relations`, `search`, `withDeleted` and `onlyDeleted`, ready to pass. */
	options: SqlOperationOptions;
	/** True when the query asked for keyset pagination (`cursor` or `after`). */
	isCursor: boolean;
}
