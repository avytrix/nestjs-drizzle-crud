import { BadRequestException } from "@nestjs/common";
import { getTableColumns } from "drizzle-orm";
import type {
	CrudAllowlists,
	CrudFilter,
	ParseCrudQueryOptions,
	ParsedCrudQuery,
} from "../interfaces/query.interface";
import type {
	RelationsConfig,
	SqlOperationOptions,
} from "../interfaces/sql-crud-config.interface";
import type { SortColumn, SortOrder } from "../types/sql.types";
import { isPlainObject } from "./merge-config";

// Turns an HTTP query string into the arguments findAll, findByCursor and
// count take:
//
//   ?status=active&age[gte]=18&region[name]=Asia&or[0][role]=admin
//    &sortBy=-created_at,name&page=2&limit=20&fields=id,name&with=region
//    &search=jo&withCount=false&counts=posts
//    &state[country][code]=IN&posts[none][status]=draft
//
// Values are coerced by the Drizzle column type (numbers, bigints, booleans,
// dates), and anything the table does not have is a 400, as in the service.
// It reads both the flat `age[gte]` keys of Express 5's default parser and the
// nested objects of the `qs` ("extended") parser.

// Query keys the parser reads itself instead of treating as filters.
const PARAMS = new Set([
	"page",
	"limit",
	"sortBy",
	"sortOrder",
	"search",
	"fields",
	"with",
	"cursor",
	"after",
	"count",
	"withCount",
	"counts",
]);
const TRASH_PARAMS = new Set(["withDeleted", "onlyDeleted"]);
const GROUP_KEYS = new Set(["and", "or", "not"]);
const QUANTIFIERS = new Set(["some", "none", "every"]);
const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

// Operators and the shape of their operand in a query string.
const OPERATORS: Record<string, "value" | "list" | "flag" | "text" | "json"> = {
	eq: "value",
	neq: "value",
	gt: "value",
	gte: "value",
	lt: "value",
	lte: "value",
	like: "text",
	ilike: "text",
	in: "list",
	notIn: "list",
	between: "list",
	isNull: "flag",
	isNotNull: "flag",
	startsWith: "text",
	endsWith: "text",
	contains: "text",
	iStartsWith: "text",
	iEndsWith: "text",
	iContains: "text",
	arrayContains: "list",
	arrayOverlaps: "list",
	jsonContains: "json",
};

const bad = (message: string) => new BadRequestException(message);

// The deepest filter accepted, counted in nested objects. Real filters stay
// well under ten; a thousand `not[not]...` levels would overflow the stack in
// the recursive compilers and answer with a 500.
export const MAX_FILTER_DEPTH = 32;

// Throws a 400 when `filters` nests deeper than MAX_FILTER_DEPTH. Iterative, so
// the check itself cannot overflow.
export function assertFilterDepth(filters: unknown): void {
	const stack: Array<[unknown, number]> = [[filters, 0]];
	while (stack.length > 0) {
		const [node, depth] = stack.pop()!;
		if (depth > MAX_FILTER_DEPTH) {
			throw bad(`Filter is nested too deeply (max ${MAX_FILTER_DEPTH} levels)`);
		}
		// One push per child: spreading a 300,000 item IN list into push()
		// would overflow the call stack.
		const children = Array.isArray(node)
			? node
			: isPlainObject(node)
				? Object.values(node)
				: [];
		const next = Array.isArray(node) ? depth : depth + 1;
		for (const child of children) stack.push([child, next]);
	}
}

export function parseCrudQuery(
	query: Record<string, unknown> | null | undefined,
	table: any,
	options: ParseCrudQueryOptions = {},
): ParsedCrudQuery {
	const tree = normalizeQuery(query);
	for (const key of options.ignore ?? []) delete tree[key];

	const params: Record<string, unknown> = {};
	for (const key of Object.keys(tree)) {
		if (PARAMS.has(key) || (options.allowTrash && TRASH_PARAMS.has(key))) {
			params[key] = tree[key];
			delete tree[key];
		}
	}

	const context: Context = { table, options };
	const pagination: ParsedCrudQuery["pagination"] = {};
	const page = positiveInt(params.page, "page");
	if (page !== undefined) pagination.page = page;
	const limit = positiveInt(params.limit, "limit");
	if (limit !== undefined) pagination.limit = limit;

	const sort = parseSort(params.sortBy, params.sortOrder, context);
	if (sort.length > 0) pagination.sortBy = sort;

	const isCursor = "cursor" in params || "after" in params;
	if (isCursor) {
		const cursor = single(params.cursor ?? params.after, "cursor");
		pagination.cursor = cursor ? cursor : null;
	}
	if (params.count !== undefined) {
		pagination.count = flag(params.count, "count");
	}
	if (params.withCount !== undefined) {
		pagination.withCount = flag(params.withCount, "withCount");
	}

	const operation: SqlOperationOptions = {};
	const select = list(params.fields, "fields");
	if (select) {
		for (const path of select) checkSelectPath(path, context);
		operation.select = select;
	}
	const relations = list(params.with, "with");
	if (relations) {
		for (const path of relations) checkRelationPath(path, context);
		operation.relations = relations;
	}
	const counts = list(params.counts, "counts");
	if (counts) {
		for (const name of counts) checkCountPath(name, context);
		operation.counts = counts;
	}
	const term = single(params.search, "search")?.trim();
	if (term) {
		const columns = options.searchColumns ?? options.searchableColumns;
		if (!columns || columns.length === 0) {
			throw bad("Search is not enabled for this resource");
		}
		operation.search = { term, columns };
	}
	if (params.withDeleted !== undefined) {
		operation.withDeleted = flag(params.withDeleted, "withDeleted");
	}
	if (params.onlyDeleted !== undefined) {
		operation.onlyDeleted = flag(params.onlyDeleted, "onlyDeleted");
	}

	const filters = parseFilter(tree, context, {
		table,
		relations: relationsOf(context),
	});
	return {
		filters,
		pagination,
		sort,
		select: operation.select,
		relations: operation.relations,
		search: operation.search,
		counts,
		options: operation,
		isCursor,
	};
}

interface Context {
	table: any;
	options: ParseCrudQueryOptions;
}

// ---- Query normalization ----

// Fold every key into one nested object: `age[gte]=18`, `region.name=Asia`
// and qs's `{ age: { gte: "18" } }` all end up the same. An object whose keys
// are all indexes (`or[0]`, `or[1]`) becomes an array.
function normalizeQuery(
	query: Record<string, unknown> | null | undefined,
): Record<string, any> {
	const root: Record<string, any> = {};
	if (query === null || query === undefined) return root;
	if (typeof query !== "object") throw bad("The query must be an object");
	assertFilterDepth(query);
	for (const [key, value] of Object.entries(query)) {
		if (value === undefined) continue;
		assign(root, splitKey(key), value);
	}
	return arrayify(root);
}

function splitKey(key: string): string[] {
	const match = /^([^[\]]*)((?:\[[^[\]]*\])*)$/.exec(key);
	if (!match) throw bad(`Malformed query parameter: ${key}`);
	const head = match[1]!.split(".");
	const brackets = Array.from(
		match[2]!.matchAll(/\[([^[\]]*)\]/g),
		(m) => m[1]!,
	);
	const path = [...head, ...brackets];
	if (path.length > MAX_FILTER_DEPTH) {
		throw bad(`Filter is nested too deeply (max ${MAX_FILTER_DEPTH} levels)`);
	}
	for (const segment of path) {
		if (UNSAFE_KEYS.has(segment)) {
			throw bad(`Malformed query parameter: ${key}`);
		}
	}
	return path;
}

function assign(root: Record<string, any>, path: string[], value: unknown) {
	// `name[]=a&name[]=b`: the empty last segment only says "this is a list".
	if (path.length > 1 && path[path.length - 1] === "") {
		path = path.slice(0, -1);
		value = Array.isArray(value) ? value : [value];
	}
	let node = root;
	for (let i = 0; i < path.length - 1; i++) {
		const key = path[i]!;
		if (!key) throw bad(`Malformed query parameter: ${path.join(".")}`);
		if (node[key] === undefined) node[key] = {};
		else if (!isPlainObject(node[key])) {
			throw bad(
				`Conflicting query parameters for "${path.slice(0, i + 1).join(".")}"`,
			);
		}
		node = node[key];
	}
	const last = path[path.length - 1]!;
	if (!last) throw bad(`Malformed query parameter: ${path.join(".")}`);
	if (isPlainObject(value)) {
		for (const [key, inner] of Object.entries(value)) {
			if (UNSAFE_KEYS.has(key)) throw bad(`Malformed query parameter: ${last}`);
			if (inner === undefined) continue;
			assign(node, [last, key], inner);
		}
		return;
	}
	if (node[last] !== undefined) {
		throw bad(`Conflicting query parameters for "${path.join(".")}"`);
	}
	node[last] = value;
}

function arrayify(node: any): any {
	if (Array.isArray(node)) return node.map(arrayify);
	if (!isPlainObject(node)) return node;
	const keys = Object.keys(node);
	if (keys.length > 0 && keys.every((key) => /^\d+$/.test(key))) {
		return keys
			.sort((a, b) => Number(a) - Number(b))
			.map((key) => arrayify(node[key]));
	}
	const out: Record<string, any> = {};
	for (const key of keys) out[key] = arrayify(node[key]);
	return out;
}

// ---- Parameters ----

function single(value: unknown, name: string): string | undefined {
	if (value === undefined) return undefined;
	if (Array.isArray(value)) throw bad(`"${name}" was given more than once`);
	if (typeof value === "number" || typeof value === "boolean") {
		return String(value);
	}
	if (typeof value !== "string") throw bad(`"${name}" must be a single value`);
	return value;
}

function list(value: unknown, name: string): string[] | undefined {
	if (value === undefined) return undefined;
	const parts = (Array.isArray(value) ? value : [value]).flatMap((item) => {
		if (typeof item !== "string")
			throw bad(`"${name}" must be a list of names`);
		return item.split(",");
	});
	const out = parts.map((part) => part.trim()).filter(Boolean);
	return out.length > 0 ? out : undefined;
}

function positiveInt(value: unknown, name: string): number | undefined {
	const raw = single(value, name);
	if (raw === undefined || raw === "") return undefined;
	const number = Number(raw);
	if (!Number.isInteger(number) || number < 1) {
		throw bad(`"${name}" must be a positive integer`);
	}
	return number;
}

function flag(value: unknown, name: string): boolean {
	const raw = single(value, name);
	if (raw === "" || raw === "true" || raw === "1") return true;
	if (raw === "false" || raw === "0") return false;
	throw bad(`"${name}" must be true or false`);
}

// ---- Allowlists and paths ----

function columnOf(table: any, name: string): any | undefined {
	const columns = getTableColumns(table) ?? table;
	return Object.hasOwn(columns, name) ? columns[name] : undefined;
}

function allow(
	context: Context,
	list: keyof CrudAllowlists,
	path: string,
	label: string,
) {
	const allowed = context.options[list];
	if (!allowed || allowed.includes(path)) return;
	if (
		path === (context.options.primaryKey ?? "id") &&
		(list === "selectableColumns" || list === "sortableColumns")
	) {
		return;
	}
	if (
		list === "loadableRelations" &&
		allowed.some((entry) => entry.startsWith(`${path}.`))
	) {
		return;
	}
	throw bad(`${label} "${path}" is not allowed`);
}

function relationsOf(context: Context): RelationsConfig {
	return context.options.relations ?? {};
}

// Walk a dotted relation path; returns the related table of the last segment.
function walkRelations(path: string[], context: Context, full: string): any {
	let level = relationsOf(context);
	let table = context.table;
	for (const name of path) {
		const relation = Object.hasOwn(level, name) ? level[name] : undefined;
		if (!relation) throw bad(`Unknown relation: ${full}`);
		table = relation.table;
		level = relation.relations ?? {};
	}
	return table;
}

function checkRelationPath(path: string, context: Context) {
	walkRelations(path.split("."), context, path);
	allow(context, "loadableRelations", path, "Loading the relation");
}

function checkCountPath(name: string, context: Context) {
	const relations = relationsOf(context);
	const relation = Object.hasOwn(relations, name) ? relations[name] : undefined;
	if (!relation) throw bad(`Unknown relation to count: ${name}`);
	if (relation.type !== "hasMany" && relation.type !== "manyToMany") {
		throw bad(
			`Cannot count "${name}": only a has-many or many-to-many relation has a count`,
		);
	}
	allow(context, "loadableRelations", name, "Loading the relation");
}

function checkSelectPath(path: string, context: Context) {
	const segments = path.split(".");
	const table = walkRelations(segments.slice(0, -1), context, path);
	if (!columnOf(table, segments[segments.length - 1]!)) {
		throw bad(`Unknown column: ${path}`);
	}
	allow(context, "selectableColumns", path, "Selecting");
}

// ---- Sort ----

function parseSort(
	sortBy: unknown,
	sortOrder: unknown,
	context: Context,
): SortColumn[] {
	const order = single(sortOrder, "sortOrder");
	if (order !== undefined && order !== "asc" && order !== "desc") {
		throw bad(`Invalid sortOrder: ${order} (expected 'asc' or 'desc')`);
	}
	const entries = list(sortBy, "sortBy") ?? [];
	return entries.map((entry) => {
		let column = entry;
		let direction: SortOrder = (order as SortOrder | undefined) ?? "asc";
		if (entry.startsWith("-")) {
			column = entry.slice(1);
			direction = "desc";
		} else if (entry.startsWith("+")) {
			column = entry.slice(1);
			direction = "asc";
		}
		checkSortPath(column, context);
		return { column, order: direction };
	});
}

function checkSortPath(path: string, context: Context) {
	const dot = path.indexOf(".");
	if (dot < 0) {
		if (!columnOf(context.table, path)) {
			throw bad(`Unknown sort column: ${path}`);
		}
	} else {
		const name = path.slice(0, dot);
		const relations = relationsOf(context);
		const relation = Object.hasOwn(relations, name)
			? relations[name]
			: undefined;
		if (!relation || !columnOf(relation.table, path.slice(dot + 1))) {
			throw bad(`Unknown sort column: ${path}`);
		}
		if (relation.type === "hasMany" || relation.type === "manyToMany") {
			throw bad(
				`Cannot sort by "${path}": only a belongs-to relation column can be sorted on`,
			);
		}
	}
	allow(context, "sortableColumns", path, "Sorting by");
}

// ---- Filters ----

interface Scope {
	table: any;
	// The relations of `table`, so a filter can go on through them.
	relations: RelationsConfig;
	// The dotted relation path when the filter is on a related table.
	prefix?: string;
}

function parseFilter(
	node: unknown,
	context: Context,
	scope: Scope,
): CrudFilter {
	if (!isPlainObject(node)) {
		throw bad("Each member of a filter group must be an object of filters");
	}
	const out: CrudFilter = {};
	const relations = scope.relations;
	for (const [key, raw] of Object.entries(node)) {
		const column = columnOf(scope.table, key);
		const relation =
			!column && Object.hasOwn(relations, key) ? relations[key] : undefined;

		if (!column && !relation && GROUP_KEYS.has(key)) {
			if (key === "not") {
				out.not = parseFilter(raw, context, scope);
			} else {
				const members = Array.isArray(raw) ? raw : [raw];
				out[key as "and" | "or"] = members.map((member) =>
					parseFilter(member, context, scope),
				);
			}
			continue;
		}

		if (relation) {
			const path = scope.prefix ? `${scope.prefix}.${key}` : key;
			if (!isPlainObject(raw)) {
				throw bad(
					`Filter on relation "${path}" needs a column, as in ${key}[column]=value`,
				);
			}
			const inner: Scope = {
				table: relation.table,
				relations: relation.relations ?? {},
				prefix: path,
			};
			const collection =
				relation.type === "hasMany" || relation.type === "manyToMany";
			const keys = Object.keys(raw);
			if (
				collection &&
				keys.length > 0 &&
				keys.every(
					(name) => QUANTIFIERS.has(name) && !columnOf(relation.table, name),
				)
			) {
				const quantified: Record<string, CrudFilter> = {};
				for (const [quantifier, member] of Object.entries(raw)) {
					// `?posts[some]` with no column means "has at least one". It names
					// no column, so the relation, or one of its columns, must be
					// filterable.
					if (member === "") {
						const allowed = context.options.filterableColumns;
						if (
							allowed &&
							!allowed.some(
								(entry) => entry === path || entry.startsWith(`${path}.`),
							)
						) {
							throw bad(`Filtering on "${path}" is not allowed`);
						}
						quantified[quantifier] = {};
					} else {
						quantified[quantifier] = parseFilter(member, context, inner);
					}
				}
				out[key] = quantified;
			} else {
				out[key] = parseFilter(raw, context, inner);
			}
			continue;
		}

		const path = scope.prefix ? `${scope.prefix}.${key}` : key;
		if (!column) throw bad(`Unknown filter column: ${path}`);
		allow(context, "filterableColumns", path, "Filtering on");
		out[key] = parseColumnFilter(column, raw, path);
	}
	return out;
}

function parseColumnFilter(column: any, raw: unknown, path: string): any {
	if (Array.isArray(raw)) {
		return raw.map((item) => coerce(column, item, path));
	}
	if (!isPlainObject(raw)) return coerce(column, raw, path);

	const out: Record<string, unknown> = {};
	for (const [op, value] of Object.entries(raw)) {
		const shape = OPERATORS[op];
		if (!shape || !Object.hasOwn(OPERATORS, op)) {
			throw bad(`Unknown filter operator: ${op}`);
		}
		const label = `${path}[${op}]`;
		switch (shape) {
			case "value":
				out[op] = coerce(column, scalar(value, label), label);
				break;
			case "text":
				out[op] = scalar(value, label);
				break;
			case "flag":
				out[op] = flag(value, label);
				break;
			case "json": {
				const text = scalar(value, label);
				try {
					out[op] = typeof text === "string" ? JSON.parse(text) : text;
				} catch {
					throw bad(`"${label}" must be JSON`);
				}
				break;
			}
			default: {
				const element =
					op === "arrayContains" || op === "arrayOverlaps"
						? column?.baseColumn
						: column;
				const items = (list(value, label) ?? []).map((item) =>
					coerce(element, item, label),
				);
				if (op === "between" && items.length !== 2) {
					throw bad(`"${label}" expects two values: from,to`);
				}
				out[op] = items;
			}
		}
	}
	return out;
}

function scalar(value: unknown, label: string): unknown {
	if (Array.isArray(value)) throw bad(`"${label}" was given more than once`);
	if (isPlainObject(value)) throw bad(`"${label}" must be a single value`);
	return value;
}

// Coerce one query string value by the column's Drizzle type. Strings for
// text, uuid and enum columns stay strings; the database checks those.
function coerce(column: any, value: unknown, label: string): unknown {
	if (typeof value !== "string" || !column) return value;
	const invalid = (what: string) =>
		bad(`Invalid ${what} for "${label}": ${value}`);
	const text = value.trim();
	switch (column.dataType) {
		case "number": {
			const number = Number(text);
			if (!text || !Number.isFinite(number)) throw invalid("number");
			return number;
		}
		case "bigint":
			try {
				if (!text) throw invalid("integer");
				return BigInt(text);
			} catch {
				throw invalid("integer");
			}
		case "boolean":
			if (text === "true" || text === "1") return true;
			if (text === "false" || text === "0") return false;
			throw invalid("boolean");
		case "date": {
			const date = new Date(text);
			if (!text || Number.isNaN(date.getTime())) throw invalid("date");
			return date;
		}
	}
	const type: string = column.columnType ?? "";
	// numeric/decimal in string mode: checked as a number, kept as the exact
	// string so no precision is lost on the way to the database.
	if (/Numeric|Decimal/.test(type)) {
		if (!text || !Number.isFinite(Number(text))) throw invalid("number");
		return text;
	}
	if (/DateString|TimestampString|DateTimeString/.test(type)) {
		if (!text || Number.isNaN(new Date(text).getTime())) throw invalid("date");
		return text;
	}
	return value;
}
