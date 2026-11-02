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
// column, a relation (whose value filters the related table's columns, and
// may name the related table's own relations: `{ state: { country: { code:
// "IN" } } }`) or a group key.
export type CrudFilter = FilterGroup & {
	[key: string]: ColumnFilter | CrudFilter | CrudFilter[] | CollectionFilter;
};

// How a filter on a collection (has-many or many-to-many) relation counts the
// related rows. A plain filter object means `some`. Each one compiles to a
// subquery, never a join, so parent rows are not multiplied.
//   some:  at least one related row matches (`{ some: {} }`: has any)
//   none:  no related row matches (`{ none: {} }`: has none at all)
//   every: every related row matches; true for a parent with no rows
export interface CollectionFilter {
	some?: CrudFilter;
	none?: CrudFilter;
	every?: CrudFilter;
}

export type CollectionQuantifier = keyof CollectionFilter;

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
	/** Direction for a single `sortBy` column without a prefix. Default "asc". */
	sortOrder?: SortOrder;
	/** Also run the count query and return `total`. Off by default. */
	count?: boolean;
}

// The envelope of `findAll`. `total` is the number of matching rows, or
// `null` when the call passed `withCount: false`; `hasMore` is only present
// then, and says whether another page follows.
export interface CrudPage<T, Total extends number | null = number> {
	data: T[];
	total: Total;
	page: number;
	limit: number;
	hasMore?: boolean;
}

// What `findAll` returns with `withCount: false`: no COUNT(*), and `hasMore`
// from fetching one row past the page.
export interface UncountedCrudPage<T> extends CrudPage<T, null> {
	hasMore: boolean;
}

// Relation counts to put on each row under `_count`. A list counts every live
// related row; an object can narrow each count with a filter on the related
// table: `{ posts: { status: "published" }, tags: true }`.
export type RelationCounts = string[] | Record<string, true | CrudFilter>;

// One group of `countBy`: a value of the column and how many rows have it.
export interface CountByRow<V = unknown> {
	value: V;
	count: number;
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
	/** Relation paths `relations` may load. "states.cities" also allows "states". Also governs `counts`. */
	loadableRelations?: string[];
	/**
	 * Relations a create body may write (nested create), and that `attach`,
	 * `detach` and `sync` may change. Unset, nested writes are off (a relation
	 * key in a body is ignored, as before 3.5) and attach / detach / sync work
	 * on any many-to-many relation.
	 */
	writableRelations?: string[];
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
		/** `?withCount=false`: skip the COUNT(*) of an offset list. */
		withCount?: boolean;
	};
	sort: SortColumn[];
	select?: string[];
	relations?: string[];
	search?: SqlSearchOptions;
	/** Relation counts from `?counts=posts,tags`. */
	counts?: string[];
	/** `select`, `relations`, `counts`, `search`, `withDeleted` and `onlyDeleted`, ready to pass. */
	options: SqlOperationOptions;
	/** True when the query asked for keyset pagination (`cursor` or `after`). */
	isCursor: boolean;
}
