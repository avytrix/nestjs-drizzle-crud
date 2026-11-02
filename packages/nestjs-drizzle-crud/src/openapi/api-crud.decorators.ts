import { getTableColumns } from "drizzle-orm";
import type { ParseCrudQueryOptions } from "../core/interfaces/query.interface";
import type { RelationsConfig } from "../core/interfaces/sql-crud-config.interface";

// OpenAPI (Swagger) docs for list queries. `@nestjs/swagger` is an optional
// peer: it is required the first time one of these decorators runs, so an
// app that never uses them never loads it.

// What the decorators describe: the table and the same allowlists and
// relations the service has. Either pass them, or pass a service class
// decorated with @CrudService, whose metadata already holds them.
export type ApiCrudSource =
	| (ParseCrudQueryOptions & { table: any })
	| (abstract new (
			...args: any[]
	  ) => unknown);

export interface ApiCrudQueryOptions {
	/** Document `cursor` / `after` and `count`. On by default. */
	cursor?: boolean;
	/** The route lists the trash: drop `withDeleted` / `onlyDeleted`. */
	trash?: boolean;
}

let swagger: any;
function loadSwagger(): any {
	if (swagger) return swagger;
	try {
		// A plain require keeps the dependency optional: it only runs when a
		// decorator is applied.
		swagger = require("@nestjs/swagger");
	} catch {
		throw new Error(
			"[nestjs-drizzle-crud] ApiCrudQuery and ApiCrudList need @nestjs/swagger. Install it, or remove the decorators.",
		);
	}
	return swagger;
}

function resolveSource(source: ApiCrudSource): ParseCrudQueryOptions & {
	table: any;
} {
	if (typeof source === "function") {
		const config = Reflect.getMetadata?.("crud:config", source);
		if (!config?.table) {
			throw new Error(
				`[nestjs-drizzle-crud] ${source.name} has no @CrudService({ table }) metadata; pass { table, ...allowlists } to the decorator instead.`,
			);
		}
		return config;
	}
	if (!source?.table) {
		throw new Error(
			"[nestjs-drizzle-crud] ApiCrudQuery needs the entity's table",
		);
	}
	return source;
}

// The OpenAPI type of a Drizzle column.
function schemaOf(column: any): Record<string, unknown> {
	switch (column?.dataType) {
		case "number":
			return /Serial|Integer|SmallInt|Int$/.test(column.columnType ?? "")
				? { type: "integer" }
				: { type: "number" };
		case "bigint":
			return { type: "string", format: "int64" };
		case "boolean":
			return { type: "boolean" };
		case "date":
			return { type: "string", format: "date-time" };
		case "array":
			return { type: "array", items: schemaOf(column.baseColumn) };
		case "json":
			return { type: "object" };
	}
	if (/UUID/i.test(column?.columnType ?? "")) {
		return { type: "string", format: "uuid" };
	}
	if (Array.isArray(column?.enumValues) && column.enumValues.length > 0) {
		return { type: "string", enum: column.enumValues };
	}
	return { type: "string" };
}

function columnsOf(table: any): Record<string, any> {
	try {
		return getTableColumns(table) ?? {};
	} catch {
		return {};
	}
}

// Resolve "region.name" (any depth) to its column.
function columnAt(
	table: any,
	relations: RelationsConfig,
	path: string,
): any | undefined {
	const parts = path.split(".");
	let current = table;
	let level = relations;
	for (const name of parts.slice(0, -1)) {
		const relation = Object.hasOwn(level, name) ? level[name] : undefined;
		if (!relation) return undefined;
		current = relation.table;
		level = relation.relations ?? {};
	}
	return columnsOf(current)[parts[parts.length - 1]!];
}

const OPERATORS =
	"eq, neq, gt, gte, lt, lte, in, notIn, between, isNull, isNotNull, like, ilike, startsWith, endsWith, contains, iStartsWith, iEndsWith, iContains";

// `region.name` is sent as `region[name]` in a query string.
function queryName(path: string): string {
	const [head, ...rest] = path.split(".");
	return head + rest.map((part) => `[${part}]`).join("");
}

function queryParams(
	source: ParseCrudQueryOptions & { table: any },
	options: ApiCrudQueryOptions,
): Array<Record<string, unknown>> {
	const columns = columnsOf(source.table);
	const relations = source.relations ?? {};
	const list = (names: string[] | undefined, fallback: string[]) =>
		(names ?? fallback).join(", ");
	const own = Object.keys(columns);
	const params: Array<Record<string, unknown>> = [
		{
			name: "page",
			schema: { type: "integer", minimum: 1 },
			description: "Page number, from 1.",
		},
		{
			name: "limit",
			schema: { type: "integer", minimum: 1 },
			description: "Rows per page, capped by the entity's maxLimit.",
		},
		{
			name: "sortBy",
			schema: { type: "string" },
			description: `Comma-separated columns; a leading "-" sorts descending. Sortable: ${list(source.sortableColumns, own)}.`,
		},
		{
			name: "sortOrder",
			schema: { type: "string", enum: ["asc", "desc"] },
			description: "Direction for a single sortBy column without a prefix.",
		},
		{
			name: "withCount",
			schema: { type: "boolean" },
			description:
				"false skips the COUNT(*): total is null and hasMore says whether another page follows.",
		},
		{
			name: "fields",
			schema: { type: "string" },
			description: `Comma-separated columns to return ("relation.column" for a relation). Selectable: ${list(source.selectableColumns, own)}.`,
		},
	];
	const relationNames = Object.keys(relations);
	if (relationNames.length > 0) {
		params.push(
			{
				name: "with",
				schema: { type: "string" },
				description: `Comma-separated relations to load (dotted for nested). Loadable: ${list(source.loadableRelations, relationNames)}.`,
			},
			{
				name: "counts",
				schema: { type: "string" },
				description:
					"Comma-separated has-many or many-to-many relations to count, returned under _count.",
			},
		);
	}
	const searchColumns = source.searchColumns ?? source.searchableColumns;
	if (searchColumns && searchColumns.length > 0) {
		params.push({
			name: "search",
			schema: { type: "string" },
			description: `Case-insensitive search in ${searchColumns.join(", ")}.`,
		});
	}
	if (options.cursor !== false) {
		params.push(
			{
				name: "cursor",
				schema: { type: "string" },
				description:
					"Keyset pagination: empty for the first page, then the nextCursor of the previous page.",
			},
			{
				name: "count",
				schema: { type: "boolean" },
				description: "With cursor: also return total.",
			},
		);
	}
	if (source.allowTrash && !options.trash) {
		params.push(
			{
				name: "withDeleted",
				schema: { type: "boolean" },
				description: "Include soft-deleted rows.",
			},
			{
				name: "onlyDeleted",
				schema: { type: "boolean" },
				description: "Only soft-deleted rows.",
			},
		);
	}
	for (const path of source.filterableColumns ?? own) {
		const column = path.includes(".")
			? columnAt(source.table, relations, path)
			: columns[path];
		if (!column) continue;
		const name = queryName(path);
		params.push({
			name,
			schema: schemaOf(column),
			description: `Filter on ${path}: an exact value, or an operator as ${name}[gte]=... (${OPERATORS}).`,
		});
	}
	return params.map((param) => ({ required: false, ...param }));
}

// One ApiQuery per list parameter: pagination, sort, cursor, withCount,
// fields, with, counts, search, the trash flags when allowed, and every
// filterable column with its type.
export function ApiCrudQuery(
	source: ApiCrudSource,
	options: ApiCrudQueryOptions = {},
): MethodDecorator {
	const { ApiQuery } = loadSwagger();
	const resolved = resolveSource(source);
	const decorators: MethodDecorator[] = queryParams(resolved, options).map(
		(param) => ApiQuery(param),
	);
	return (target, key, descriptor) => {
		for (const decorate of decorators) decorate(target, key, descriptor);
	};
}

// ApiCrudQuery plus the 200 response: the page envelope with the row schema
// built from the table's columns.
export function ApiCrudList(
	source: ApiCrudSource,
	options: ApiCrudQueryOptions = {},
): MethodDecorator {
	const { ApiOkResponse } = loadSwagger();
	const resolved = resolveSource(source);
	const properties: Record<string, unknown> = {};
	for (const [name, column] of Object.entries(columnsOf(resolved.table))) {
		properties[name] = {
			...schemaOf(column),
			...(column?.notNull ? {} : { nullable: true }),
		};
	}
	const query = ApiCrudQuery(source, options);
	const response = ApiOkResponse({
		description:
			"A page of rows. Offset pages carry total (null with withCount=false), page, limit and hasMore; cursor pages carry nextCursor.",
		schema: {
			type: "object",
			properties: {
				data: { type: "array", items: { type: "object", properties } },
				total: { type: "integer", nullable: true },
				page: { type: "integer" },
				limit: { type: "integer" },
				hasMore: { type: "boolean" },
				nextCursor: { type: "string", nullable: true },
			},
			required: ["data", "limit"],
		},
	});
	return (target, key, descriptor) => {
		query(target, key, descriptor);
		response(target, key, descriptor);
	};
}
