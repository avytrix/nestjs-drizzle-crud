// Drizzle imports
import {
	aliasedTable,
	and,
	arrayContains,
	arrayOverlaps,
	asc,
	between,
	desc,
	eq,
	exists,
	getTableColumns,
	getTableName,
	gt,
	gte,
	ilike,
	inArray,
	isNotNull,
	isNull,
	like,
	lt,
	lte,
	ne,
	not,
	notExists,
	notInArray,
	or,
	sql,
} from "drizzle-orm";
import {
	BadRequestException,
	ParseIntPipe,
	ParseUUIDPipe,
} from "@nestjs/common";
import {
	BulkOperationException,
	DuplicateEntityException,
	EntityInUseException,
	EntityNotFoundException,
	ForeignKeyViolationException,
	MissingScopeException,
	StaleVersionException,
	ValidationFailedException,
} from "../../exceptions/crud.exceptions";
import { CrudContext } from "../context/crud-context";
import type {
	ICrudService,
	PaginationOptions,
} from "../interfaces/crud-service.interface";
import type { CrudWriteOperation } from "../interfaces/events.interface";
import type {
	CountByRow,
	CrudAllowlists,
	CrudPage,
	CursorPage,
	CursorPaginationOptions,
	ParseCrudQueryOptions,
	ParsedCrudQuery,
	RelationCounts,
	SortInput,
	UncountedCrudPage,
	UpsertOptions,
} from "../interfaces/query.interface";
import type { CrudScopeValues } from "../interfaces/scope.interface";
import type {
	RelationConfig,
	RelationNode,
	RelationsConfig,
	RelationType,
	SelectTree,
	SqlCrudConfig,
	SqlOperationOptions,
} from "../interfaces/sql-crud-config.interface";
import type { SortColumn, SortOrder } from "../types/sql.types";
import { decodeCursor, encodeCursor } from "../utils/cursor";
import { isPlainObject, mergeCrudConfig } from "../utils/merge-config";
import { parseCrudQuery } from "../utils/query-parser";

// Alias a many-to-many row carries its join-table key under while it is being
// grouped. Prefixed so it cannot collide with a real column name.
const JOIN_KEY = "__crudJoinKey";

// Prefix of the hidden fields a keyset page selects to build its cursor.
const CURSOR_KEY = "__crudCursor";

// Thrown inside a savepoint to roll it back on purpose; never escapes.
const ROLLBACK = Symbol("rollback");

// One resolved ORDER BY entry. `key` is what the caller wrote ("name",
// "region.name"), `relation` the belongs-to it needs joined.
interface SortSpec {
	key: string;
	column: any;
	order: SortOrder;
	relation?: string;
}

// The group keys of a filter object.
const GROUP_KEYS = new Set(["and", "or", "not"]);

// The quantifier keys of a collection filter.
const QUANTIFIERS = new Set(["some", "none", "every"]);

// Where a filter object's keys point: the table (an alias inside a subquery),
// the Drizzle table it stands for, that table's relations, and the dotted path
// used in messages and the filterableColumns check. `root` is the service's
// own table in the main query, the only place a belongs-to is joined.
interface FilterHost {
	table: any;
	source: any;
	relations: RelationsConfig;
	prefix: string;
	root: boolean;
}

// Hidden field a count query groups by.
const COUNT_KEY = "__crudCountKey";

// Each correlated subquery gets its own table alias, so a relation back to a
// table already in the query (a self relation) still resolves.
let aliasSeq = 0;
function subqueryAlias(table: any): any {
	aliasSeq = (aliasSeq + 1) % 1_000_000;
	return typeof aliasedTable === "function"
		? aliasedTable(table, `crud_sq${aliasSeq}`)
		: table;
}

export abstract class SqlBaseCrudService<
	T extends Record<string, any>,
	CreateDto,
	UpdateDto,
	FilterDto,
> implements ICrudService<T, CreateDto, UpdateDto, FilterDto>
{
	protected readonly defaultConfig: SqlCrudConfig = {
		dialect: "postgresql",
		db: null,
		table: null,
		primaryKey: "id",
		primaryKeyType: "serial",
		softDelete: { enabled: true, column: "deleted_at" },
		timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
		pagination: { defaultLimit: 20, maxLimit: 100 },
		sql: {
			caseSensitive: false,
			useReturning: true,
			jsonSupport: true,
			enableFullTextSearch: false,
		},
	};
	// Builds a Drizzle partial-select field map from a list of column names.
	// Returns undefined when no selection is requested (select all columns).
	protected buildSelectFields(
		select: string[],
	): Record<string, any> | undefined {
		if (!select || select.length === 0) return undefined;
		const fields: Record<string, any> = {};
		for (const field of select) {
			const column = this.config.table[field];
			if (column) fields[field] = column;
		}
		return Object.keys(fields).length > 0 ? fields : undefined;
	}

	// Normalizes the various driver result shapes (postgres-js, node-postgres,
	// mysql2) into a simple "did this mutation affect any rows" boolean.
	protected wasAffected(result: any): boolean {
		if (result == null) return false;
		if (Array.isArray(result)) {
			// postgres-js exposes affected count on `.count`; otherwise use rows.
			if (typeof (result as any).count === "number")
				return (result as any).count > 0;
			// mysql2 returns [ResultSetHeader, ...]
			if (result[0] && typeof result[0].affectedRows === "number")
				return result[0].affectedRows > 0;
			return result.length > 0;
		}
		if (typeof result.rowCount === "number") return result.rowCount > 0; // node-postgres
		if (typeof result.rowsAffected === "number") return result.rowsAffected > 0;
		if (typeof result.affectedRows === "number") return result.affectedRows > 0;
		return false;
	}

	// The WHERE for findOne. A lookup that ends up with no condition would run
	// `LIMIT 1` over the whole table and hand back somebody else's row, so it is
	// a 400 instead, and so is a key that is not a column. `undefined` is
	// skipped (an absent DTO field), `null` means IS NULL, and a value is an
	// exact, case-sensitive match. An operator object works as it does in
	// findAll.
	protected buildWhereConditionsFromPartial(where: Partial<T>): any[] {
		const conditions: any[] = [];

		for (const [key, value] of Object.entries(where ?? {})) {
			if (value === undefined) continue;

			const column = this.columnOf(this.config.table, key);
			if (!column) {
				throw new BadRequestException(`Unknown filter column: ${key}`);
			}
			if (value === null) conditions.push(isNull(column));
			else this.pushColumnCondition(conditions, column, value, false);
		}

		if (conditions.length === 0) {
			throw new BadRequestException(
				"findOne needs at least one condition; every value was undefined",
			);
		}
		return conditions;
	}

	// The column stored under `name` on a Drizzle table, or undefined. Only own
	// keys count, so `constructor` or `toString` in a filter is never mistaken
	// for a column. Plain objects (test mocks) are read the same way.
	protected columnOf(table: any, name: string): any | undefined {
		if (!table || typeof name !== "string") return undefined;
		const columns = getTableColumns(table) ?? table;
		return Object.hasOwn(columns, name) ? columns[name] : undefined;
	}

	// The JS key of a table's primary key column, for tables other than the
	// service's own (nested relations). Falls back to "id" when no column is
	// flagged, as with a composite key.
	protected primaryKeyOf(table: any): string {
		if (table === this.config.table) return this.config.primaryKey;
		const columns = getTableColumns(table) ?? {};
		for (const [key, column] of Object.entries<any>(columns)) {
			if (column?.primary) return key;
		}
		return "id";
	}

	// Text-like columns (text, varchar, char) are the only ones lower() accepts.
	// Postgres rejects lower(integer), lower(uuid) and lower(enum).
	protected isTextColumn(column: any): boolean {
		return /(Text|VarChar|Varchar|Char)$/.test(column?.columnType ?? "");
	}

	// HTTP query values are strings, but a date-mode Drizzle column maps its
	// parameter with toISOString(). Turn the string into a Date, and answer a
	// value that is not a date with a 400 instead of a driver crash.
	protected coerceFilterValue(column: any, value: any): any {
		if (column?.dataType !== "date" || value instanceof Date) return value;
		if (typeof value === "string" || typeof value === "number") {
			const date = new Date(value);
			if (!Number.isNaN(date.getTime())) return date;
		}
		throw new BadRequestException(`Invalid date filter value: ${value}`);
	}

	// ---- Allowlists, soft delete scope, writable columns ----

	private static readonly ALLOWLIST_LABELS: Record<
		keyof CrudAllowlists,
		string
	> = {
		filterableColumns: "Filtering on",
		sortableColumns: "Sorting by",
		selectableColumns: "Selecting",
		searchableColumns: "Searching",
		loadableRelations: "Loading the relation",
		writableColumns: "Writing",
		writableRelations: "Writing the relation",
	};

	// A 400 when `path` is outside a configured allowlist. An unset list allows
	// everything. The primary key may always be selected and sorted on, since
	// every page sorts on it anyway. A relation path is allowed when a longer
	// listed path goes through it ("states.cities" allows "states").
	protected assertAllowed(
		list: keyof CrudAllowlists,
		path: string,
		options?: SqlOperationOptions,
	): void {
		if (options?.skipAllowlists) return;
		const allowed = this.config[list];
		if (!allowed) return;
		if (
			path === this.config.primaryKey &&
			(list === "selectableColumns" || list === "sortableColumns")
		) {
			return;
		}
		if (allowed.includes(path)) return;
		if (
			list === "loadableRelations" &&
			allowed.some((entry) => entry.startsWith(`${path}.`))
		) {
			return;
		}
		throw new BadRequestException(
			`${SqlBaseCrudService.ALLOWLIST_LABELS[list]} "${path}" is not allowed`,
		);
	}

	// Check the caller-supplied parts of a read against the allowlists.
	protected checkReadOptions(options?: SqlOperationOptions): void {
		if (options?.skipAllowlists) return;
		for (const path of options?.relations ?? []) {
			if (path) this.assertAllowed("loadableRelations", path, options);
		}
		for (const path of options?.select ?? []) {
			if (path) this.assertAllowed("selectableColumns", path, options);
		}
		for (const column of options?.search?.columns ?? []) {
			this.assertAllowed("searchableColumns", column, options);
		}
		for (const name of this.countNames(options?.counts)) {
			this.assertAllowed("loadableRelations", name, options);
		}
	}

	// Every predicate a row of this entity must pass for this call: the tenant
	// scope and the soft delete scope. Every read, count and existence check
	// goes through here, so a new path cannot forget one of them.
	protected rowScope(options?: SqlOperationOptions): any[] {
		const out = this.scopeConditions(options);
		const softDeleted = this.softDeleteScope(options);
		if (softDeleted) out.push(softDeleted);
		return out;
	}

	// The tenant scope of this call as `column: value` pairs, or null when the
	// entity has none, the call skips it, or the resolver returned null. A
	// value that is `undefined` is a context the request did not provide: that
	// fails closed with a 403 rather than running unscoped.
	protected resolveScope(
		options?: SqlOperationOptions,
	): CrudScopeValues | null {
		const scope = this.config.scope;
		if (!scope || options?.skipScope) return null;
		const values =
			typeof scope === "function"
				? scope(options?.context ?? CrudContext.current() ?? {})
				: scope;
		if (values === null) return null;
		if (!isPlainObject(values)) {
			throw new Error(
				`[nestjs-drizzle-crud] ${this.getEntityName()}: scope must return an object of column values, or null`,
			);
		}
		for (const [key, value] of Object.entries(values)) {
			if (!this.columnOf(this.config.table, key)) {
				throw new Error(
					`[nestjs-drizzle-crud] ${this.getEntityName()}: scope names "${key}", which is not a column`,
				);
			}
			if (value === undefined) {
				throw new MissingScopeException(this.getEntityName(), key);
			}
		}
		return values;
	}

	// The tenant scope as WHERE conditions on `table` (an alias of the
	// service's table inside a subquery, or the table itself).
	protected scopeConditions(
		options?: SqlOperationOptions,
		table: any = this.config.table,
	): any[] {
		const values = this.resolveScope(options);
		if (!values) return [];
		return Object.entries(values).map(([key, value]) =>
			value === null ? isNull(table[key]) : eq(table[key], value),
		);
	}

	// Write the scope onto a row about to be inserted, over whatever the body
	// said, so a create can only ever land in the caller's own tenant.
	protected applyScopeToRow(
		row: Record<string, any>,
		options?: SqlOperationOptions,
	): void {
		const values = this.resolveScope(options);
		if (values) Object.assign(row, values);
	}

	// The soft delete predicate for the service's own table: deleted rows are
	// hidden unless the caller asks for them with withDeleted or onlyDeleted.
	protected softDeleteScope(options?: SqlOperationOptions): any | undefined {
		const softDelete = this.config.softDelete;
		if (options?.onlyDeleted) {
			if (!softDelete?.enabled) {
				throw new BadRequestException(
					"onlyDeleted needs soft delete, which is off for this entity",
				);
			}
			return isNotNull(this.config.table[softDelete.column]);
		}
		if (!softDelete?.enabled || options?.withDeleted) return undefined;
		return isNull(this.config.table[softDelete.column]);
	}

	// The columns the package manages itself, which a create or update body may
	// not set unless writableColumns names them: the soft delete column, and on
	// update the primary key and the createdAt timestamp.
	protected managedColumns(operation: "create" | "update"): string[] {
		const out: string[] = [];
		if (this.config.softDelete?.enabled)
			out.push(this.config.softDelete.column);
		if (this.config.versionColumn) out.push(this.config.versionColumn);
		if (operation === "update") {
			out.push(this.config.primaryKey);
			if (this.config.timestamps?.createdAt) {
				out.push(this.config.timestamps.createdAt);
			}
		}
		return out;
	}

	// Apply writableColumns to an entity about to be written. With the list set,
	// a column outside it is a 400. Without it, the managed columns are dropped
	// so a body cannot move a primary key or resurrect a row by accident. Keys
	// that are not columns are left alone; Drizzle ignores them.
	protected filterWritable(
		entity: Record<string, any>,
		operation: "create" | "update",
		options?: SqlOperationOptions,
	): Record<string, any> {
		const out = { ...entity };
		const allowed = this.config.writableColumns;
		if (allowed && !options?.skipAllowlists) {
			for (const [key, value] of Object.entries(out)) {
				if (value === undefined || !this.columnOf(this.config.table, key)) {
					continue;
				}
				if (!allowed.includes(key)) {
					throw new ValidationFailedException(
						`the column "${key}" is not writable`,
					);
				}
			}
			return out;
		}
		if (allowed) return out;
		for (const key of this.managedColumns(operation)) delete out[key];
		return out;
	}

	// A comparable key for a primary key value: route params arrive as strings
	// while the driver hands back numbers, and uuids may differ in case.
	protected keyOf(value: unknown): string {
		const column = this.columnOf(this.config.table, this.config.primaryKey);
		const key = String(value);
		return column?.columnType === "PgUUID" ? key.toLowerCase() : key;
	}

	constructor(protected readonly config: SqlCrudConfig) {
		this.config = mergeCrudConfig(this.defaultConfig, config);
		this.validateConfiguration();
	}

	private validateConfiguration(): void {
		if (!this.config.db) throw new Error("Database instance is required");
		if (!this.config.table) throw new Error("Table configuration is required");

		if (this.config.dialect === "mysql" && this.config.sql?.useReturning) {
			console.warn(
				"MySQL does not support RETURNING clause, disabling useReturning",
			);
			this.config.sql.useReturning = false;
		}

		this.validateColumns();
		this.validateRelations(this.config.relations);
	}

	// A soft-delete or timestamp setting that names a key the table does not
	// have breaks every read (isNull(undefined)) or is silently ignored on write.
	// Fail at startup instead, and point at the key when the column exists under
	// a camelCase name.
	private validateColumns(): void {
		const table = this.config.table;
		const check = (setting: string, name?: string) => {
			if (!name || this.columnOf(table, name)) return;
			const declared = Object.entries<any>(getTableColumns(table) ?? {}).find(
				([, column]) => column?.name === name,
			)?.[0];
			const hint = declared
				? `The column "${name}" is declared under the key "${declared}"; set ${setting} to "${declared}".`
				: `Set ${setting} to the key of an existing column, or turn it off for this entity.`;
			throw new Error(
				`[nestjs-drizzle-crud] ${this.getEntityName()}: ${setting} is "${name}", but the table has no column under that key. ${hint}`,
			);
		};
		if (this.config.softDelete?.enabled) {
			check("softDelete.column", this.config.softDelete.column);
		}
		if (this.config.timestamps) {
			check("timestamps.createdAt", this.config.timestamps.createdAt);
			check("timestamps.updatedAt", this.config.timestamps.updatedAt);
		}
		if (this.config.versionColumn) {
			check("versionColumn", this.config.versionColumn);
		}
		const scope = this.config.scope;
		if (scope && typeof scope !== "function") {
			for (const key of Object.keys(scope)) check(`scope.${key}`, key);
		}
	}

	// A relation missing its key column would silently produce no join and no
	// children, which reads as "the data is wrong". Fail at startup instead.
	// Nested relations are validated with their parent's path in the message.
	private validateRelations(relations?: RelationsConfig, path = ""): void {
		for (const [name, relation] of Object.entries(relations || {})) {
			const label = path ? `${path}.${name}` : name;
			if (!relation?.table) {
				throw new Error(`Relation "${label}" is missing its table`);
			}
			switch (this.relationType(relation)) {
				case "hasMany":
					if (!relation.foreignKey) {
						throw new Error(
							`Relation "${label}" is hasMany and requires a foreignKey (the column on the related table pointing back here)`,
						);
					}
					break;
				case "manyToMany":
					if (
						!relation.through ||
						!relation.throughLocalKey ||
						!relation.throughForeignKey
					) {
						throw new Error(
							`Relation "${label}" is manyToMany and requires through, throughLocalKey and throughForeignKey (the join table and its two foreign-key columns)`,
						);
					}
					break;
				default:
					if (!relation.localKey) {
						throw new Error(
							`Relation "${label}" is belongsTo and requires a localKey (the foreign-key column on this table)`,
						);
					}
			}
			this.validateRelations(relation.relations, label);
		}
	}

	// Overridable hooks for validation and DTO -> entity mapping. Defaults are
	// no-op / pass-through so a concrete service only needs to declare its
	// table; override these when an entity needs custom behaviour.
	protected async validateCreate(_data: CreateDto): Promise<void> {}
	protected async validateUpdate(_id: any, _data: UpdateDto): Promise<void> {}
	protected mapCreateDtoToEntity(data: CreateDto): Record<string, any> {
		return { ...(data as Record<string, any>) };
	}
	protected mapUpdateDtoToEntity(data: UpdateDto): Record<string, any> {
		return { ...(data as Record<string, any>) };
	}

	// Optional hooks
	protected async beforeCreate(data: CreateDto): Promise<CreateDto> {
		return data;
	}
	protected async afterCreate(_entity: T): Promise<void> {}
	protected async beforeUpdate(_id: any, data: UpdateDto): Promise<UpdateDto> {
		return data;
	}
	protected async afterUpdate(_entity: T): Promise<void> {}
	protected async beforeDelete(_id: any): Promise<void> {}
	protected async afterDelete(_id: any): Promise<void> {}
	protected async beforeSoftDelete(_id: any): Promise<void> {}
	protected async afterSoftDelete(_id: any): Promise<void> {}
	protected async beforeRestore(_id: any): Promise<void> {}
	protected async afterRestore(_entity: T): Promise<void> {}

	// ---- Relation helpers ----

	protected relationType(relation: RelationConfig): RelationType {
		if (relation.type === "hasMany" || relation.type === "manyToMany")
			return relation.type;
		return "belongsTo";
	}

	// True when the relation resolves to an array rather than a single object.
	protected isCollection(relation: RelationConfig): boolean {
		return this.relationType(relation) !== "belongsTo";
	}

	// Keep only the requested relation names that are actually configured. Kept
	// for subclasses that filtered flat names before nested paths existed; the
	// loader itself walks relationTree().
	protected eagerRelations(relations: string[]): string[] {
		const configured = this.config.relations || {};
		return (relations || []).filter((name) => !!configured[name]);
	}

	// Turn the requested relation paths into a plan. A dotted path addresses a
	// relation of a relation, resolved through that relation's own `relations`
	// config: ['state', 'state.country'] gives one node with one child. Unknown
	// names are dropped, along with the rest of their path.
	protected relationTree(
		paths: string[],
		configured: RelationsConfig = this.config.relations || {},
	): RelationNode[] {
		const roots: RelationNode[] = [];
		for (const path of paths || []) {
			let level = configured;
			let siblings = roots;
			for (const name of (path || "").split(".").filter(Boolean)) {
				const config = level?.[name];
				if (!config) break;
				let node = siblings.find((candidate) => candidate.name === name);
				if (!node) {
					node = { name, config, children: [] };
					siblings.push(node);
				}
				level = config.relations || {};
				siblings = node.children;
			}
		}
		return roots;
	}

	// Split a `select` list into per-table column lists. A dotted entry addresses
	// a relation at any depth: ['id', 'region.code', 'states.cities.name'].
	// An empty `base` means "all columns of that table", so selecting only
	// relation columns still returns the full parent row.
	protected parseSelect(select?: string[]): SelectTree {
		const root: SelectTree = { base: [], relations: {} };
		for (const entry of select || []) {
			const segments = (entry || "").split(".").filter(Boolean);
			if (segments.length === 0) continue;
			let node = root;
			for (const name of segments.slice(0, -1)) {
				if (!node.relations[name])
					node.relations[name] = { base: [], relations: {} };
				node = node.relations[name];
			}
			node.base.push(segments[segments.length - 1]!);
		}
		return root;
	}

	protected selectFor(select: SelectTree, name: string): SelectTree {
		return select.relations[name] ?? { base: [], relations: {} };
	}

	// The columns a projection of `hostTable` must keep so the given child
	// relations can still be loaded from its rows.
	protected keysForChildren(
		nodes: RelationNode[],
		hostTable: any = this.config.table,
	): string[] {
		return nodes
			.map((node) =>
				this.relationType(node.config) === "belongsTo"
					? node.config.localKey
					: this.parentKeyOf(node.config, hostTable),
			)
			.filter((key): key is string => !!key);
	}

	// The host column a collection groups on: `parentKey` when configured,
	// otherwise the host table's own primary key. At a nested level the host is
	// the related table, so the service's primary key name does not apply.
	protected parentKeyOf(
		relation: RelationConfig,
		hostTable: any = this.config.table,
	): string {
		return relation.parentKey ?? this.primaryKeyOf(hostTable);
	}

	// Batch-loading a relation needs its key in the row, so add the keys back when
	// the caller narrowed the base columns. Joined relations need nothing extra:
	// their key only appears in the ON clause.
	protected withRequiredKeys(base: string[], nodes: RelationNode[]): string[] {
		if (base.length === 0) return base;
		const keys = this.keysForChildren(nodes.filter((node) => !node.joined));
		return keys.length > 0 ? Array.from(new Set([...base, ...keys])) : base;
	}

	// Build the SELECT projection: base columns (optionally narrowed by
	// `select`) plus a nested object of columns for each joined relation.
	protected buildSelection(
		base: string[],
		joined: RelationNode[],
		select: SelectTree = { base: [], relations: {} },
	): Record<string, any> {
		const allColumns = getTableColumns(this.config.table);
		let fields: Record<string, any>;
		if (base.length > 0) {
			fields = {};
			for (const name of base) {
				if (allColumns[name]) fields[name] = allColumns[name];
			}
		} else {
			fields = { ...allColumns };
		}
		for (const node of joined) {
			const relColumns = getTableColumns(node.config.table);
			const wanted = this.selectFor(select, node.name).base;
			if (wanted.length > 0) {
				const picked: Record<string, any> = {};
				for (const name of [
					...wanted,
					...this.keysForChildren(node.children, node.config.table),
				]) {
					if (relColumns[name]) picked[name] = relColumns[name];
				}
				fields[node.name] =
					Object.keys(picked).length > 0 ? picked : relColumns;
			} else {
				fields[node.name] = relColumns;
			}
		}
		return fields;
	}

	// Start a SELECT with the right projection. An explicit projection is needed
	// whenever a JOIN is applied (eager load OR relation filter), otherwise a
	// plain `select()` + join makes Drizzle nest rows per table
	// ({ table: {...}, joined: {...} }). When there are no joins this matches the
	// original all-columns / partial-select behaviour.
	protected startSelect(
		db: any,
		base: string[],
		joined: RelationNode[],
		hasJoins = false,
		select: SelectTree = { base: [], relations: {} },
	): any {
		if (joined.length > 0 || hasJoins) {
			return db
				.select(this.buildSelection(base, joined, select))
				.from(this.config.table);
		}
		const fields = this.buildSelectFields(base);
		return fields
			? db.select(fields).from(this.config.table)
			: db.select().from(this.config.table);
	}

	// Mark the relations that ride along in the main query as a LEFT JOIN. Only
	// top-level belongs-to relations qualify: a collection would multiply the
	// parent rows, and a nested relation has no row to join to yet.
	protected planJoins(nodes: RelationNode[]): RelationNode[] {
		const joined: RelationNode[] = [];
		for (const node of nodes) {
			if (this.isCollection(node.config) || !node.config.localKey) continue;
			node.joined = true;
			joined.push(node);
		}
		return joined;
	}

	// ORDER BY for a collection relation, from its `orderBy` config.
	protected collectionOrderBy(relation: RelationConfig): any[] {
		const out: any[] = [];
		for (const spec of relation.orderBy ?? []) {
			const column = relation.table[spec.column];
			if (!column) {
				console.warn(
					`[nestjs-drizzle-crud] relation orderBy references unknown column "${spec.column}"; skipping.`,
				);
				continue;
			}
			out.push(spec.order === "desc" ? desc(column) : asc(column));
		}
		return out;
	}

	// The soft-delete predicate for a related table, but only when that table
	// actually has the configured column (sibling tables often differ).
	protected softDeleteCondition(table: any): any | undefined {
		const softDelete = this.config.softDelete;
		if (!softDelete?.enabled) return undefined;
		const column = table[softDelete.column];
		return column ? isNull(column) : undefined;
	}

	// Projection for a batched relation query: the requested columns plus the keys
	// the loader and this relation's own children need. `undefined` means "select
	// every column", which is what an empty request means.
	protected relationProjection(
		table: any,
		wanted: string[],
		requiredKeys: string[],
	): Record<string, any> | undefined {
		if (wanted.length === 0) return undefined;
		const fields: Record<string, any> = {};
		for (const name of [...wanted, ...requiredKeys]) {
			const column = table[name];
			if (column) fields[name] = column;
		}
		return Object.keys(fields).length > 0 ? fields : undefined;
	}

	// Eager-load a plan against rows that have already been fetched.
	//
	// This is the N+1 fix: every relation, at every nesting level, costs exactly
	// ONE query for the whole set of host rows, and siblings run concurrently. A
	// page of 50 parents costs the same as a page of 5. Rows are mutated in place.
	protected async loadRelations(
		db: any,
		hosts: any[],
		nodes: RelationNode[],
		select: SelectTree = { base: [], relations: {} },
		hostTable: any = this.config.table,
	): Promise<void> {
		if (!nodes.length || !Array.isArray(hosts)) return;
		const rows = hosts.filter((row) => row && typeof row === "object");
		if (rows.length === 0) return;

		await Promise.all(
			nodes.map(async (node) => {
				const childSelect = this.selectFor(select, node.name);
				if (!node.joined) {
					switch (this.relationType(node.config)) {
						case "hasMany":
							await this.loadHasMany(db, rows, node, childSelect, hostTable);
							break;
						case "manyToMany":
							await this.loadManyToMany(db, rows, node, childSelect, hostTable);
							break;
						default:
							await this.loadBelongsTo(db, rows, node, childSelect);
					}
				}
				if (node.children.length === 0) return;
				// Recurse into whatever the relation produced: the single object for a
				// belongs-to, every element for a collection.
				const nextHosts = this.isCollection(node.config)
					? rows.flatMap((row) => row[node.name] ?? [])
					: rows.map((row) => row[node.name]);
				await this.loadRelations(
					db,
					nextHosts,
					node.children,
					childSelect,
					node.config.table,
				);
			}),
		);
	}

	// One query per relation: WHERE <referenced> IN (host foreign keys).
	protected async loadBelongsTo(
		db: any,
		hosts: any[],
		node: RelationNode,
		select: SelectTree,
	): Promise<void> {
		const { localKey, references } = node.config;
		if (!localKey) return;
		const target = node.config.table;
		const referencedName = references ?? "id";
		const referenced = target[referencedName];
		if (!referenced) return;

		const ids = Array.from(
			new Set(hosts.map((host) => host[localKey]).filter((v) => v != null)),
		);
		if (ids.length === 0) {
			for (const host of hosts) host[node.name] = null;
			return;
		}

		const fields = this.relationProjection(target, select.base, [
			referencedName,
			...this.keysForChildren(node.children, target),
		]);
		const conditions = [inArray(referenced, ids)];
		const softDeleted = this.softDeleteCondition(target);
		if (softDeleted) conditions.push(softDeleted);

		const related = await (fields ? db.select(fields) : db.select())
			.from(target)
			.where(and(...conditions));

		const byKey = new Map<any, any>();
		for (const row of related ?? []) byKey.set(row?.[referencedName], row);
		for (const host of hosts) {
			host[node.name] = byKey.get(host[localKey]) ?? null;
		}
	}

	// One query per relation: WHERE <foreignKey> IN (host parent keys).
	protected async loadHasMany(
		db: any,
		hosts: any[],
		node: RelationNode,
		select: SelectTree,
		hostTable: any = this.config.table,
	): Promise<void> {
		const { foreignKey } = node.config;
		if (!foreignKey) return;
		const target = node.config.table;
		const foreign = target[foreignKey];
		if (!foreign) return;
		const parentKey = this.parentKeyOf(node.config, hostTable);

		const ids = Array.from(
			new Set(hosts.map((host) => host[parentKey]).filter((v) => v != null)),
		);
		if (ids.length === 0) {
			for (const host of hosts) host[node.name] = [];
			return;
		}

		// The foreign key always travels with the child: it is what maps the child
		// back to its parent.
		const fields = this.relationProjection(target, select.base, [
			foreignKey,
			...this.keysForChildren(node.children, target),
		]);
		const conditions = [inArray(foreign, ids)];
		const softDeleted = this.softDeleteCondition(target);
		if (softDeleted) conditions.push(softDeleted);

		let query = (fields ? db.select(fields) : db.select())
			.from(target)
			.where(and(...conditions));
		const orderBy = this.collectionOrderBy(node.config);
		if (orderBy.length > 0) query = query.orderBy(...orderBy);

		const children = await query;
		this.groupCollection(hosts, node.name, parentKey, children, foreignKey);
	}

	// One query per relation, through the join table:
	// SELECT target.* FROM through JOIN target ... WHERE <throughLocalKey> IN (...).
	protected async loadManyToMany(
		db: any,
		hosts: any[],
		node: RelationNode,
		select: SelectTree,
		hostTable: any = this.config.table,
	): Promise<void> {
		const { through, throughLocalKey, throughForeignKey, references } =
			node.config;
		if (!through || !throughLocalKey || !throughForeignKey) return;
		const target = node.config.table;
		const referencedName = references ?? "id";
		const referenced = target[referencedName];
		const joinLocal = through[throughLocalKey];
		const joinForeign = through[throughForeignKey];
		if (!referenced || !joinLocal || !joinForeign) return;
		const parentKey = this.parentKeyOf(node.config, hostTable);

		const ids = Array.from(
			new Set(hosts.map((host) => host[parentKey]).filter((v) => v != null)),
		);
		if (ids.length === 0) {
			for (const host of hosts) host[node.name] = [];
			return;
		}

		// The join-table key has to travel with each row to group it back onto its
		// parent, under a name a real column will not collide with. It is stripped
		// again before the rows are handed out.
		const columns = getTableColumns(target);
		const wanted =
			select.base.length > 0
				? [...select.base, ...this.keysForChildren(node.children, target)]
				: Object.keys(columns);
		const fields: Record<string, any> = { [JOIN_KEY]: joinLocal };
		for (const name of wanted) {
			if (columns[name]) fields[name] = columns[name];
		}

		const conditions = [inArray(joinLocal, ids)];
		const softDeleted = this.softDeleteCondition(target);
		if (softDeleted) conditions.push(softDeleted);

		let query = db
			.select(fields)
			.from(through)
			.innerJoin(target, eq(joinForeign, referenced))
			.where(and(...conditions));
		const orderBy = this.collectionOrderBy(node.config);
		if (orderBy.length > 0) query = query.orderBy(...orderBy);

		const rows = await query;
		this.groupCollection(hosts, node.name, parentKey, rows, JOIN_KEY, true);
	}

	// Group loaded rows onto their hosts by key, defaulting to an empty array so
	// callers can iterate without a guard. Keys are scalars (int / uuid / text),
	// so a strict-equality Map is the right match.
	private groupCollection(
		hosts: any[],
		name: string,
		parentKey: string,
		rows: any[],
		groupBy: string,
		stripGroupKey = false,
	): void {
		const grouped = new Map<any, any[]>();
		for (const row of rows ?? []) {
			if (!row) continue;
			const key = row[groupBy];
			if (stripGroupKey) delete row[groupBy];
			const bucket = grouped.get(key);
			if (bucket) bucket.push(row);
			else grouped.set(key, [row]);
		}
		for (const host of hosts) {
			host[name] = grouped.get(host[parentKey]) ?? [];
		}
	}

	// LEFT JOIN each belongs-to relation onto the query. Collections are never
	// joined: one parent row would become one row per child, which breaks `total`
	// and pagination. They are loaded by loadRelations instead.
	protected applyJoins(query: any, relationNames: string[]): any {
		const configured = this.config.relations || {};
		let q = query;
		for (const name of relationNames) {
			const rel = configured[name];
			if (!rel?.localKey || this.isCollection(rel)) continue;
			// The soft-delete predicate sits in the ON clause, not the WHERE: a
			// deleted parent then reads as "no match" (null), and the child row
			// still comes back, as with any LEFT JOIN miss.
			const on = eq(
				this.config.table[rel.localKey],
				rel.table[rel.references ?? "id"],
			);
			const softDeleted = this.softDeleteCondition(rel.table);
			q = q.leftJoin(rel.table, softDeleted ? and(on, softDeleted) : on);
		}
		return q;
	}

	// A LEFT JOIN with no match yields a relation object full of nulls; collapse
	// those to a single `null` so callers get a clean shape.
	protected normalizeRelations(rows: any[], eager: string[]): any[] {
		if (!eager.length || !Array.isArray(rows)) return rows;
		return rows.map((row) => {
			if (!row || typeof row !== "object") return row;
			const out = { ...row };
			for (const name of eager) {
				const related = out[name];
				if (
					related &&
					typeof related === "object" &&
					Object.values(related).every((v) => v === null)
				) {
					out[name] = null;
				}
			}
			return out;
		});
	}

	// Build the ORDER BY expressions for findAll. An explicit caller `sortBy`
	// wins and fully replaces the configured default; otherwise the entity's
	// `defaultSort` (possibly multi-column) is applied in order.
	// The primary key always comes last, so rows that tie on the sort columns
	// (or a query with no sort at all) still page in the same order every time.
	protected buildOrderBy(
		sortBy?: SortInput,
		sortOrder: SortOrder = "desc",
	): any[] {
		return this.resolveSort(sortBy, sortOrder).map((spec) =>
			this.orderOf(spec),
		);
	}

	protected orderOf(spec: SortSpec): any {
		return spec.order === "desc" ? desc(spec.column) : asc(spec.column);
	}

	// Resolve a caller sort (or the configured defaultSort) into ORDER BY
	// entries, primary key last. A single string keeps its 3.3 meaning: one
	// column in `sortOrder` (default "desc"). A list, or a string with commas,
	// sorts by each entry in turn, ascending unless it starts with "-".
	// A caller column that does not exist, or sits outside sortableColumns, is
	// a 400. An unknown column in defaultSort is a config mistake, so it is
	// warned about and skipped instead.
	protected resolveSort(
		sortBy?: SortInput,
		sortOrder: SortOrder = "desc",
		options?: SqlOperationOptions,
	): SortSpec[] {
		// Fail fast on a bad sortOrder; anything other than "desc" used to sort
		// ascending silently.
		if (sortOrder !== "asc" && sortOrder !== "desc") {
			throw new BadRequestException(
				`Invalid sortOrder: ${sortOrder} (expected 'asc' or 'desc')`,
			);
		}
		const specs: SortSpec[] = [];
		const add = (spec: SortSpec) => {
			if (!specs.some((existing) => existing.column === spec.column)) {
				specs.push(spec);
			}
		};
		const entries = this.sortEntries(sortBy, sortOrder);
		if (entries.length > 0) {
			for (const entry of entries) {
				this.assertAllowed("sortableColumns", entry.column, options);
				add(this.resolveSortColumn(entry.column, entry.order ?? "asc"));
			}
		} else {
			for (const entry of this.config.defaultSort ?? []) {
				try {
					add(this.resolveSortColumn(entry.column, entry.order ?? "asc"));
				} catch {
					console.warn(
						`[nestjs-drizzle-crud] defaultSort references unknown column "${entry.column}"; skipping.`,
					);
				}
			}
		}
		const pk = this.columnOf(this.config.table, this.config.primaryKey);
		if (pk) add({ key: this.config.primaryKey, column: pk, order: "asc" });
		return specs;
	}

	// Normalize the accepted sortBy shapes into SortColumn entries.
	private sortEntries(sortBy: SortInput | undefined, sortOrder: SortOrder) {
		const fromString = (entry: string): SortColumn => {
			const name = entry.trim();
			if (name.startsWith("-")) return { column: name.slice(1), order: "desc" };
			if (name.startsWith("+")) return { column: name.slice(1), order: "asc" };
			return { column: name, order: "asc" };
		};
		if (typeof sortBy === "string") {
			if (!sortBy.trim()) return [];
			if (!sortBy.includes(",")) {
				const entry = fromString(sortBy);
				return [
					sortBy.trim().startsWith("-") || sortBy.trim().startsWith("+")
						? entry
						: { column: entry.column, order: sortOrder },
				];
			}
			return sortBy
				.split(",")
				.filter((part) => part.trim())
				.map(fromString);
		}
		if (!Array.isArray(sortBy)) return [];
		return sortBy.map((entry) => {
			if (typeof entry === "string") return fromString(entry);
			if (
				!isPlainObject(entry) ||
				typeof entry.column !== "string" ||
				(entry.order !== undefined &&
					entry.order !== "asc" &&
					entry.order !== "desc")
			) {
				throw new BadRequestException(
					"Each sortBy entry is a column name or { column, order }",
				);
			}
			return entry;
		});
	}

	// A sort column of the service's table, or of a top-level belongs-to
	// relation written as "relation.column". A collection cannot be sorted on:
	// it has many values per row.
	protected resolveSortColumn(key: string, order: SortOrder): SortSpec {
		const dot = key.indexOf(".");
		if (dot < 0) {
			const column = this.columnOf(this.config.table, key);
			if (!column) throw new BadRequestException(`Unknown sort column: ${key}`);
			return { key, column, order };
		}
		const name = key.slice(0, dot);
		const relations = this.config.relations || {};
		const relation = Object.hasOwn(relations, name)
			? relations[name]
			: undefined;
		const column = relation
			? this.columnOf(relation.table, key.slice(dot + 1))
			: undefined;
		if (!relation || !column) {
			throw new BadRequestException(`Unknown sort column: ${key}`);
		}
		if (this.isCollection(relation) || !relation.localKey) {
			throw new BadRequestException(
				`Cannot sort by "${key}": only a belongs-to relation column can be sorted on`,
			);
		}
		return { key, column, order, relation: name };
	}

	// Clamp pagination input to safe bounds: page >= 1 and 1 <= limit <= maxLimit.
	// Shared by findAll and fullTextSearch so bad input (page<1, limit<=0,
	// limit>maxLimit) can never produce a negative OFFSET or a LIMIT 0 / LIMIT -n.
	protected resolvePagination(
		page?: number,
		limit?: number,
	): { page: number; limit: number; offset: number } {
		const maxLimit = this.config.pagination?.maxLimit ?? 100;
		const defaultLimit = this.config.pagination?.defaultLimit ?? 20;
		const rawPage =
			page == null || Number.isNaN(Number(page)) ? 1 : Math.floor(Number(page));
		const rawLimit =
			limit == null || Number.isNaN(Number(limit))
				? defaultLimit
				: Math.floor(Number(limit));
		const safePage = Math.max(1, rawPage);
		const safeLimit = Math.min(Math.max(1, rawLimit), maxLimit);
		return {
			page: safePage,
			limit: safeLimit,
			offset: (safePage - 1) * safeLimit,
		};
	}

	// Detect a Postgres unique-constraint violation across driver shapes:
	// postgres-js sets `.code` on the error; Drizzle wraps it under `.cause`.
	protected isUniqueViolation(error: any): boolean {
		const code = error?.code ?? error?.cause?.code;
		return code === "23505"; // Postgres unique_violation
	}

	// Turn a Postgres unique violation into a typed 409 exception, parsing the
	// offending field/value out of the driver `detail` when available
	// (e.g. "Key (code)=(EU) already exists.").
	protected toDuplicateException(error: any): DuplicateEntityException {
		const detail: string = error?.detail ?? error?.cause?.detail ?? "";
		const m = detail.match(/Key \((?<field>.+?)\)=\((?<value>.+?)\)/);
		return new DuplicateEntityException(
			this.getEntityName(),
			m?.groups?.field ?? "unique field",
			m?.groups?.value ?? "",
		);
	}

	// Postgres data-integrity violations caused by bad CLIENT INPUT rather than a
	// server fault: value too long (22001), failed CHECK (23514), numeric out of
	// range (22003), a value the column type cannot parse such as "abc" for an
	// integer or an unknown enum label (22P02), and a malformed or out of range
	// date (22007, 22008). These otherwise surface as a raw 500; map them to 400
	// so the caller sees a client error (mirrors the unique-violation -> 409
	// mapping). (NOT-NULL violations are intentionally left to bubble: they
	// usually indicate a programming/config error, not a recoverable bad value.
	// FK violations are handled separately below.)
	private static readonly DATA_ERRORS: Record<string, string> = {
		"22001": "a value is too long for its column",
		"23514": "a value violates a column check constraint",
		"22003": "a numeric value is out of range",
		"22P02": "a value does not match its column type",
		"22007": "a date or time value has an invalid format",
		"22008": "a date or time value is out of range",
		"21000": "the same key appears more than once in one upsert",
	};

	protected isDataException(error: any): boolean {
		const code = error?.code ?? error?.cause?.code;
		return Object.hasOwn(SqlBaseCrudService.DATA_ERRORS, code ?? "");
	}

	protected toDataException(error: any): ValidationFailedException {
		const code = error?.code ?? error?.cause?.code;
		return new ValidationFailedException(
			SqlBaseCrudService.DATA_ERRORS[code] ?? "invalid value",
		);
	}

	// Translate a driver error caused by bad input into the matching HTTP
	// exception; anything else comes back unchanged. On a delete, a foreign key
	// violation means other rows still point here (409), on a write it means the
	// row points at a parent that does not exist (400).
	protected toClientError(
		error: any,
		operation: "read" | "write" | "delete" = "write",
	): unknown {
		if (this.isUniqueViolation(error)) return this.toDuplicateException(error);
		if (this.isDataException(error)) return this.toDataException(error);
		if (this.isForeignKeyViolation(error)) {
			return operation === "delete"
				? new EntityInUseException(this.getEntityName())
				: this.toForeignKeyException(error);
		}
		return error;
	}

	// Await a read query, turning bad input (22P02 and friends) into a 400.
	protected async runRead<R>(query: PromiseLike<R>): Promise<R> {
		try {
			return await query;
		} catch (error) {
			throw this.toClientError(error, "read");
		}
	}

	// Postgres foreign-key violation (23503). The direction decides the status:
	// on create/update the caller referenced a parent row that does not exist
	// (400), on delete other rows still reference this one (409).
	protected isForeignKeyViolation(error: any): boolean {
		const code = error?.code ?? error?.cause?.code;
		return code === "23503";
	}

	protected toForeignKeyException(error: any): ForeignKeyViolationException {
		const detail: string = error?.detail ?? error?.cause?.detail ?? "";
		const m = detail.match(/Key \((?<field>.+?)\)=/);
		return new ForeignKeyViolationException(
			this.getEntityName(),
			m?.groups?.field ?? "reference",
		);
	}

	// Apply a row-level lock to a SELECT builder (Postgres only; no-op elsewhere).
	protected applyLock(query: any, options?: SqlOperationOptions): any {
		if (this.config.dialect !== "postgresql") return query;
		// `OF <table>` locks the base rows only. Without it Postgres tries to lock
		// every joined table too, and refuses on the nullable side of a LEFT JOIN.
		const of = { of: this.config.table };
		if (options?.forNoKeyUpdate) return query.for("no key update", of);
		if (options?.lock && options.lock !== "none")
			return query.for(options.lock, of);
		return query;
	}

	protected buildSearchCondition(search?: SqlOperationOptions["search"]): any {
		if (!search?.term || !search.columns?.length) return undefined;

		const term = String(search.term).trim();
		if (!term) return undefined;

		const columns = search.columns
			.map((columnName) => this.config.table[columnName])
			.filter(Boolean);
		if (columns.length === 0) return undefined;

		if (search.mode === "fullText") {
			if (this.config.dialect !== "postgresql") {
				throw new Error("Full-text search only supported in PostgreSQL");
			}
			const tsVector = sql.join(
				columns.map((column) => sql`to_tsvector('english', ${column})`),
				sql` || `,
			);
			const tsQuery = sql`plainto_tsquery('english', ${term})`;
			return sql`${tsVector} @@ ${tsQuery}`;
		}

		const pattern = `%${term.replace(/[\\%_]/g, "\\$&")}%`;
		const conditions = columns.map((column) =>
			this.caseInsensitiveLike(column, pattern),
		);
		return conditions.length === 1 ? conditions[0] : or(...conditions);
	}

	// ILIKE on Postgres. MySQL has no ILIKE, and its default collations already
	// compare case-insensitively, so LIKE gives the same result there.
	protected caseInsensitiveLike(column: any, pattern: string): any {
		return this.config.dialect === "mysql"
			? like(column, pattern)
			: ilike(column, pattern);
	}

	// Parse an HTTP query (`@Query()`) into filters, pagination and options for
	// this entity: its table, relations, primary key and allowlists. Pass
	// `allowTrash: true` to accept withDeleted / onlyDeleted.
	parseQuery(
		query: Record<string, unknown> | null | undefined,
		options: ParseCrudQueryOptions = {},
	): ParsedCrudQuery {
		const config = this.config;
		return parseCrudQuery(query, config.table, {
			relations: config.relations,
			primaryKey: config.primaryKey,
			filterableColumns: config.filterableColumns,
			sortableColumns: config.sortableColumns,
			selectableColumns: config.selectableColumns,
			searchableColumns: config.searchableColumns,
			loadableRelations: config.loadableRelations,
			...options,
		});
	}

	// What kind of value the primary key holds, from its Drizzle column: "int"
	// for an integer, "bigint", "uuid", or "string" for anything else.
	idKind(): "int" | "bigint" | "uuid" | "string" {
		const column = this.columnOf(this.config.table, this.config.primaryKey);
		if (column?.dataType === "bigint") return "bigint";
		if (column?.dataType === "number") {
			return /Numeric|Decimal|Real|Double|Float/.test(column.columnType ?? "")
				? "string"
				: "int";
		}
		if (/UUID/i.test(column?.columnType ?? "")) return "uuid";
		return "string";
	}

	// Parse a route id the way the matching Nest pipe would: ParseIntPipe for
	// an integer key, ParseUUIDPipe for a uuid, a digit check for a bigint, and
	// the string as is otherwise. Bad input is a 400.
	async parseId(raw: unknown): Promise<unknown> {
		const value = String(raw);
		const metadata = { type: "param" as const, data: "id" };
		switch (this.idKind()) {
			case "int":
				return new ParseIntPipe().transform(value, metadata);
			case "uuid":
				return new ParseUUIDPipe().transform(value, metadata);
			case "bigint":
				if (!/^-?\d+$/.test(value)) {
					throw new BadRequestException(
						"Validation failed (numeric string is expected)",
					);
				}
				return BigInt(value);
			default:
				return value;
		}
	}

	// The existence check that guards update / softDelete / delete only needs to
	// know whether the row is there, so it drops the caller's relations and
	// columns: joining or batch-loading children to throw them away would be an
	// extra query per write.
	// With optimistic locking it also reads the version, and a row at another
	// version than the caller expects is a 409 before anything is written.
	private async findForGuard(
		id: any,
		options?: SqlOperationOptions,
	): Promise<T | null> {
		const version = this.config.versionColumn;
		const row = await this.find(id, {
			...options,
			relations: [],
			counts: undefined,
			select: version
				? [this.config.primaryKey, version]
				: [this.config.primaryKey],
			skipAllowlists: true,
		});
		if (row && version) {
			this.assertVersion(id, row[version], options?.expectedVersion);
		}
		return row;
	}

	// A 409 when the caller named a version and the row is at another one.
	protected assertVersion(id: any, actual: unknown, expected: unknown): void {
		if (expected === undefined || expected === null) return;
		if (Number(actual) !== Number(expected)) {
			throw new StaleVersionException(this.getEntityName(), id);
		}
	}

	// `pk = id` for a write, ANDed with the tenant scope and, when the caller
	// named one, the version: the statement itself refuses a row the guard
	// read a moment ago but that someone changed since.
	protected writeWhere(
		ids: any[],
		options?: SqlOperationOptions,
		table: any = this.config.table,
	): any {
		const pk = table[this.config.primaryKey];
		const conditions = [
			ids.length === 1 ? eq(pk, ids[0]) : inArray(pk, ids),
			...this.scopeConditions(options, table),
		];
		const version = this.config.versionColumn;
		if (version) {
			// A mass write passes expectedVersions; a single write passes
			// expectedVersion. Never apply one version to a whole set.
			if (
				ids.length === 1 &&
				options?.expectedVersion != null &&
				!options.expectedVersions
			) {
				conditions.push(eq(table[version], options.expectedVersion));
			} else if (options?.expectedVersions) {
				const checks = ids.flatMap((id) => {
					const expected = options.expectedVersions?.[this.keyOf(id)];
					return expected == null
						? [eq(pk, id)]
						: [and(eq(pk, id), eq(table[version], expected))];
				});
				conditions.push(checks.length === 1 ? checks[0] : or(...checks));
			}
		}
		return and(...conditions);
	}

	// SET version = version + 1, merged into a write's SET.
	protected withVersionBump(set: Record<string, any>): Record<string, any> {
		const version = this.config.versionColumn;
		if (!version) return set;
		return {
			...set,
			[version]: sql`${this.config.table[version]} + 1`,
		};
	}

	// Single Operations
	async find(id: any, options?: SqlOperationOptions): Promise<T | null> {
		this.checkReadOptions(options);
		return this.findFirst(
			[eq(this.config.table[this.config.primaryKey], id)],
			options,
		);
	}

	async findOne(
		where: Partial<T>,
		options?: SqlOperationOptions,
	): Promise<T | null> {
		this.checkReadOptions(options);
		return this.findFirst(this.buildWhereConditionsFromPartial(where), options);
	}

	// The first row matching `conditions`, with the soft delete scope, joins,
	// lock and eager loads of `options` applied.
	private async findFirst(
		conditions: any[],
		options?: SqlOperationOptions,
	): Promise<T | null> {
		const { transaction, relations = [], select = [] } = options || {};
		const db = transaction || this.config.db;
		const nodes = this.relationTree(relations);
		const joined = this.planJoins(nodes);
		const selection = this.parseSelect(select);
		const baseSelect = this.withCountKeys(
			this.withRequiredKeys(selection.base, nodes),
			options?.counts,
		);

		conditions.push(...this.rowScope(options));

		let query = this.startSelect(db, baseSelect, joined, false, selection);
		query = this.applyJoins(
			query,
			joined.map((node) => node.name),
		)
			.where(and(...conditions))
			.limit(1);
		query = this.applyLock(query, options);

		const result = await this.runRead<any[]>(query);
		const rows = this.normalizeRelations(
			result,
			joined.map((node) => node.name),
		);
		await Promise.all([
			this.loadRelations(db, rows, nodes, selection),
			this.loadCounts(db, rows, options?.counts, options),
		]);
		return rows[0] || null;
	}

	// Everything a list read needs before it builds its queries: the eager
	// load plan, the WHERE (filters, search, soft delete scope), the sort and
	// the relations to join. Shared by findAll and findByCursor.
	private planList(
		filters: any,
		sortBy: SortInput | undefined,
		sortOrder: SortOrder,
		options?: SqlOperationOptions,
	) {
		this.checkReadOptions(options);
		const { transaction, relations = [], select = [] } = options || {};
		const db = transaction || this.config.db;
		const nodes = this.relationTree(relations);
		const joined = this.planJoins(nodes);
		const selection = this.parseSelect(select);
		const baseSelect = this.withCountKeys(
			this.withRequiredKeys(selection.base, nodes),
			options?.counts,
		);

		const { conditions, relations: filterRelations } = this.listConditions(
			filters,
			db,
			options,
		);

		const sort = this.resolveSort(sortBy, sortOrder, options);
		// Join everything needed for eager-loading, relation filters and
		// relation sorts. The count query only joins the filter relations.
		const joinRelations = Array.from(
			new Set([
				...joined.map((node) => node.name),
				...filterRelations,
				...sort.flatMap((spec) => (spec.relation ? [spec.relation] : [])),
			]),
		);
		return {
			db,
			nodes,
			joined,
			selection,
			baseSelect,
			conditions,
			filterRelations,
			sort,
			joinRelations,
		};
	}

	// The WHERE of a list or a count: filters, search, tenant scope and soft
	// delete scope, plus the belongs-to relations the filters need joined.
	private listConditions(
		filters: any,
		db: any,
		options?: SqlOperationOptions,
	): { conditions: any[]; relations: string[] } {
		const built = this.buildFilterConditions(filters, db, options);
		const searchCondition = this.buildSearchCondition(options?.search);
		if (searchCondition) built.conditions.push(searchCondition);
		built.conditions.push(...this.rowScope(options));
		return built;
	}

	private buildCountQuery(
		db: any,
		conditions: any[],
		filterRelations: string[],
	): any {
		let query = db
			.select({ count: sql<number>`count(*)` })
			.from(this.config.table);
		query = this.applyJoins(query, filterRelations);
		if (conditions.length > 0) query = query.where(and(...conditions));
		return query;
	}

	// `withCount: false` skips the COUNT(*): `total` is then null, and the page
	// fetches one row more than it returns to set `hasMore`.
	async findAll(
		filters: FilterDto | undefined,
		pagination: PaginationOptions & { withCount: false },
		options?: SqlOperationOptions,
	): Promise<UncountedCrudPage<T>>;
	async findAll(
		filters?: FilterDto,
		pagination?: PaginationOptions & { withCount?: true },
		options?: SqlOperationOptions,
	): Promise<CrudPage<T>>;
	async findAll(
		filters?: FilterDto,
		pagination?: PaginationOptions,
		options?: SqlOperationOptions,
	): Promise<CrudPage<T, number | null>>;
	async findAll(
		filters?: FilterDto,
		pagination?: PaginationOptions,
		options?: SqlOperationOptions,
	): Promise<CrudPage<T, number | null>> {
		const { sortBy, sortOrder = "desc" } = pagination || {};
		const withCount = pagination?.withCount !== false;
		const {
			page,
			limit: safeLimit,
			offset,
		} = this.resolvePagination(pagination?.page, pagination?.limit);
		const plan = this.planList(filters, sortBy, sortOrder, options);

		let dataQuery = this.startSelect(
			plan.db,
			plan.baseSelect,
			plan.joined,
			plan.joinRelations.length > 0,
			plan.selection,
		);
		dataQuery = this.applyJoins(dataQuery, plan.joinRelations);
		if (plan.conditions.length > 0) {
			dataQuery = dataQuery.where(and(...plan.conditions));
		}
		if (plan.sort.length > 0) {
			dataQuery = dataQuery.orderBy(
				...plan.sort.map((spec) => this.orderOf(spec)),
			);
		}
		dataQuery = dataQuery
			.limit(withCount ? safeLimit : safeLimit + 1)
			.offset(offset);
		dataQuery = this.applyLock(dataQuery, options);

		const countQuery = withCount
			? this.buildCountQuery(plan.db, plan.conditions, plan.filterRelations)
			: Promise.resolve(undefined);
		const [fetched, totalResult] = await this.runRead(
			Promise.all([dataQuery, countQuery]),
		);
		const data = (fetched as any[]).slice(0, safeLimit);

		// One batched query per relation for the whole page, never one per row.
		const rows = this.normalizeRelations(
			data,
			plan.joined.map((node) => node.name),
		);
		await Promise.all([
			this.loadRelations(plan.db, rows, plan.nodes, plan.selection),
			this.loadCounts(plan.db, rows, options?.counts, options),
		]);

		if (!withCount) {
			return {
				data: rows,
				total: null,
				page,
				limit: safeLimit,
				hasMore: (fetched as any[]).length > safeLimit,
			};
		}
		return {
			data: rows,
			total: parseInt((totalResult as any[])[0]?.count?.toString() || "0", 10),
			page,
			limit: safeLimit,
		};
	}

	// Keyset pagination. Each page is `WHERE (sort columns) > (last row's
	// values)` instead of an OFFSET, so a deep page costs the same as the first
	// and a row inserted on an earlier page does not shift the next one. The
	// primary key is always the last sort column, which makes every position
	// unique. The count query only runs when `count: true` is passed.
	async findByCursor(
		filters?: FilterDto,
		pagination?: CursorPaginationOptions,
		options?: SqlOperationOptions,
	): Promise<CursorPage<T>> {
		const { sortBy, sortOrder = "desc", count = false } = pagination || {};
		const { limit } = this.resolvePagination(1, pagination?.limit);
		const plan = this.planList(filters, sortBy, sortOrder, options);
		const signature = plan.sort
			.map((spec) => `${spec.key}:${spec.order}`)
			.join(",");

		const cursor = pagination?.cursor ?? pagination?.after;
		const conditions = [...plan.conditions];
		if (cursor !== undefined && cursor !== null && cursor !== "") {
			if (typeof cursor !== "string") {
				throw new BadRequestException("Invalid cursor");
			}
			const values = decodeCursor(cursor, signature, plan.sort.length);
			conditions.push(this.keysetCondition(plan.sort, values));
		}

		// The sort values travel in hidden fields so the cursor can be built
		// whatever `select` narrowed the row to. They are removed below.
		const fields = this.buildSelection(
			plan.baseSelect,
			plan.joined,
			plan.selection,
		);
		plan.sort.forEach((spec, i) => {
			fields[`${CURSOR_KEY}${i}`] = this.cursorField(spec.column);
		});
		let dataQuery = plan.db.select(fields).from(this.config.table);
		dataQuery = this.applyJoins(dataQuery, plan.joinRelations);
		if (conditions.length > 0) dataQuery = dataQuery.where(and(...conditions));
		dataQuery = dataQuery
			.orderBy(...plan.sort.map((spec) => this.orderOf(spec)))
			// One row more than the page shows whether there is a next page.
			.limit(limit + 1);
		dataQuery = this.applyLock(dataQuery, options);

		const [data, totalResult] = await this.runRead(
			Promise.all([
				dataQuery,
				count
					? this.buildCountQuery(plan.db, plan.conditions, plan.filterRelations)
					: Promise.resolve(undefined),
			]),
		);
		const page: any[] = (data as any[]).slice(0, limit);
		const last = page[page.length - 1];
		const nextCursor =
			(data as any[]).length > limit && last
				? encodeCursor(
						plan.sort.map((_, i) => last[`${CURSOR_KEY}${i}`]),
						signature,
					)
				: null;
		for (const row of page) {
			plan.sort.forEach((_, i) => {
				delete row[`${CURSOR_KEY}${i}`];
			});
		}

		const rows = this.normalizeRelations(
			page,
			plan.joined.map((node) => node.name),
		);
		await Promise.all([
			this.loadRelations(plan.db, rows, plan.nodes, plan.selection),
			this.loadCounts(plan.db, rows, options?.counts, options),
		]);

		const out: CursorPage<T> = { data: rows, limit, nextCursor };
		if (count) {
			out.total = parseInt(
				(totalResult as any[])?.[0]?.count?.toString() || "0",
				10,
			);
		}
		return out;
	}

	// The value a cursor stores for a sort column. A date column is read as
	// text: a JavaScript Date keeps milliseconds, Postgres keeps microseconds,
	// and a cursor rounded down would show the same row twice.
	protected cursorField(column: any): any {
		if (column?.dataType !== "date") return column;
		return this.config.dialect === "mysql"
			? sql`cast(${column} as char)`
			: sql`cast(${column} as text)`;
	}

	// Compare a sort column with a cursor value. Date columns compare with the
	// text the cursor holds, which the database casts to the column's type.
	private compareCursor(column: any, op: ">" | "<" | "=", value: any): any {
		if (column?.dataType === "date") {
			return sql`${column} ${sql.raw(op)} ${value}`;
		}
		if (op === ">") return gt(column, value);
		if (op === "<") return lt(column, value);
		return eq(column, value);
	}

	// "Comes after the cursor row" for a list of sort columns: the first column
	// is past the cursor value, or it ties and the next one is past, and so on.
	// NULLs sort last ascending and first descending on Postgres, the other
	// way round on MySQL, and the comparison follows the same rule.
	protected keysetCondition(specs: SortSpec[], values: unknown[]): any {
		const branches: any[] = [];
		specs.forEach((spec, i) => {
			const after = this.afterCursor(spec, values[i]);
			if (!after) return;
			const ties = specs
				.slice(0, i)
				.map((previous, j) =>
					values[j] === null
						? isNull(previous.column)
						: this.compareCursor(previous.column, "=", values[j]),
				);
			branches.push(ties.length > 0 ? and(...ties, after) : after);
		});
		return branches.length > 0 ? or(...branches) : sql`false`;
	}

	private afterCursor(spec: SortSpec, value: unknown): any | undefined {
		const postgres = this.config.dialect !== "mysql";
		const nullsFirst = postgres ? spec.order === "desc" : spec.order === "asc";
		if (value === null) {
			return nullsFirst ? isNotNull(spec.column) : undefined;
		}
		const past = this.compareCursor(
			spec.column,
			spec.order === "asc" ? ">" : "<",
			value,
		);
		return nullsFirst ? past : or(past, isNull(spec.column));
	}

	// ---- Events, relations on writes ----

	// Raise a module-level event, when the module wired a bus in
	// (`hooks.enableGlobalHooks`) and the call did not opt out.
	protected async emitEvent(
		phase: "before" | "after",
		operation: CrudWriteOperation,
		bulk: boolean,
		payload: {
			ids?: unknown[];
			input?: unknown;
			rows?: T[];
			transaction?: unknown;
		},
		options?: SqlOperationOptions,
	): Promise<void> {
		const bus = this.config.events;
		if (!bus || options?.skipEvents) return;
		await bus.emit({
			entity: this.getEntityName(),
			operation,
			phase,
			bulk,
			ids: payload.ids ?? [],
			input: payload.input,
			rows: payload.rows ?? [],
			transaction: payload.transaction,
			context: options?.context ?? CrudContext.current(),
		});
	}

	private idsOf(rows: T[]): unknown[] {
		return rows.map((row) => row?.[this.config.primaryKey]);
	}

	// Load `options.relations` and `options.counts` onto rows a write returned,
	// with the same batched loaders as a read: one query per relation for all
	// the rows, whatever their number.
	protected async loadWriteRelations(
		db: any,
		rows: T[],
		options?: SqlOperationOptions,
	): Promise<void> {
		const nodes = this.relationTree(options?.relations ?? []);
		if (nodes.length === 0 && this.countNames(options?.counts).length === 0) {
			return;
		}
		const hosts = rows.filter(Boolean);
		await Promise.all([
			this.loadRelations(db, hosts, nodes),
			this.loadCounts(db, hosts, options?.counts, options),
		]);
	}

	// The version a write expects: `options.expectedVersion`, or the version
	// column sent in the body. A value that is not an integer is a 400.
	private expectedVersionOf(
		data: unknown,
		options?: SqlOperationOptions,
	): number | undefined {
		const column = this.config.versionColumn;
		if (!column) return undefined;
		const raw =
			options?.expectedVersion ??
			(isPlainObject(data) ? (data as Record<string, any>)[column] : undefined);
		if (raw === undefined || raw === null || raw === "") return undefined;
		const version = Number(raw);
		if (!Number.isInteger(version)) {
			throw new ValidationFailedException(
				`"${column}" must be an integer version`,
			);
		}
		return version;
	}

	// Validate, run the before hook and map one create DTO into the row to
	// insert: timestamps, the tenant scope and the first version included.
	protected async prepareCreate(
		data: CreateDto,
		options?: SqlOperationOptions,
	): Promise<Record<string, any>> {
		const hooks = options?.hooks ?? {};
		await this.validateCreate(data);
		const processedData = hooks.skipBefore
			? data
			: await this.beforeCreate(data);
		const mapped = this.mapCreateDtoToEntity(processedData);
		const version = this.config.versionColumn;
		if (version) delete mapped[version];
		const entityData = this.filterWritable(mapped, "create", options);

		const now = new Date();
		if (this.config.timestamps?.createdAt)
			entityData[this.config.timestamps.createdAt] = now;
		if (this.config.timestamps?.updatedAt)
			entityData[this.config.timestamps.updatedAt] = now;
		if (version) entityData[version] = 1;
		this.applyScopeToRow(entityData, options);
		return entityData;
	}

	// Insert one prepared row and return it as stored.
	private async insertOne(
		db: any,
		entityData: Record<string, any>,
		options?: SqlOperationOptions,
	): Promise<T> {
		const insertQuery = db.insert(this.config.table).values(entityData);
		if (this.config.sql?.useReturning) {
			const result = await insertQuery.returning();
			return result[0];
		}
		const result = await insertQuery;
		// Without RETURNING (e.g. MySQL): prefer a client-supplied primary key
		// (required for uuid / non-auto-increment keys), otherwise fall back to
		// the driver's auto-increment insertId.
		const lastInsertId =
			entityData[this.config.primaryKey] ?? result?.[0]?.insertId;
		const createdEntity = await this.find(lastInsertId, {
			...options,
			relations: [],
			counts: undefined,
			transaction: db,
		});
		if (!createdEntity) throw new Error("Failed to create entity");
		return createdEntity;
	}

	async create(data: CreateDto, options?: SqlOperationOptions): Promise<T> {
		const { transaction, hooks = {} } = options || {};
		this.checkReadOptions(options);
		const entityData = await this.prepareCreate(data, options);
		const nested = this.takeNested(entityData, options);
		const db = transaction || this.config.db;
		await this.emitEvent(
			"before",
			"create",
			false,
			{ input: data, transaction },
			options,
		);
		try {
			const createdEntity =
				nested.length === 0
					? await this.insertOne(db, entityData, options)
					: await this.executeSqlTransaction(
							(tx) =>
								this.insertNested(tx, entityData, nested, {
									...options,
									transaction: tx,
								}),
							transaction,
						);
			if (!hooks.skipAfter) await this.afterCreate(createdEntity);
			await this.emitEvent(
				"after",
				"create",
				false,
				{
					ids: this.idsOf([createdEntity]),
					input: data,
					rows: [createdEntity],
					transaction,
				},
				options,
			);
			await this.loadWriteRelations(db, [createdEntity], options);
			return createdEntity;
		} catch (error) {
			// Unique violation -> 409, bad input (too long, failed check, wrong
			// type) -> 400, a reference to a row that does not exist -> 400.
			throw this.toClientError(error, "write");
		}
	}

	// ---- Nested create ----

	// Pull the relation keys out of a create body. Only relations listed in
	// writableRelations are written; with the list unset, nested writes are off
	// and a relation key stays in the row, where Drizzle ignores it.
	private takeNested(
		entity: Record<string, any>,
		options?: SqlOperationOptions,
	): Array<{ name: string; relation: RelationConfig; value: unknown }> {
		const allowed = this.config.writableRelations;
		if (!allowed) return [];
		const relations = this.config.relations || {};
		const out: Array<{
			name: string;
			relation: RelationConfig;
			value: unknown;
		}> = [];
		for (const [key, value] of Object.entries(entity)) {
			if (
				value === undefined ||
				this.columnOf(this.config.table, key) ||
				!Object.hasOwn(relations, key)
			) {
				continue;
			}
			if (!allowed.includes(key) && !options?.skipAllowlists) {
				throw new ValidationFailedException(
					`the relation "${key}" is not writable`,
				);
			}
			delete entity[key];
			if (value !== null)
				out.push({ name: key, relation: relations[key]!, value });
		}
		return out;
	}

	// The row itself plus its nested relations, inside the caller's
	// transaction: belongs-to parents first (their key goes on the row), then
	// one multi-row INSERT per has-many relation, and for a many-to-many the
	// new targets in one INSERT and the links in one more.
	private async insertNested(
		tx: any,
		row: Record<string, any>,
		nested: Array<{ name: string; relation: RelationConfig; value: unknown }>,
		options: SqlOperationOptions,
	): Promise<T> {
		if (!this.config.sql?.useReturning) {
			throw new ValidationFailedException(
				"nested writes need RETURNING, which this dialect does not have",
			);
		}
		for (const { name, relation, value } of nested) {
			if (this.isCollection(relation)) continue;
			if (!isPlainObject(value)) {
				throw new ValidationFailedException(
					`the relation "${name}" takes an object to create`,
				);
			}
			const [parent] = await tx
				.insert(relation.table)
				.values(this.relatedRow(relation.table, value, options))
				.returning();
			row[relation.localKey!] = parent[relation.references ?? "id"];
		}
		const created = await this.insertOne(tx, row, options);
		for (const { name, relation, value } of nested) {
			if (!this.isCollection(relation)) continue;
			if (!Array.isArray(value)) {
				throw new ValidationFailedException(
					`the relation "${name}" takes an array`,
				);
			}
			const parentValue = created[this.parentKeyOf(relation)];
			if (this.relationType(relation) === "hasMany") {
				const children = value.map((item) => {
					if (!isPlainObject(item)) {
						throw new ValidationFailedException(
							`each "${name}" entry must be an object`,
						);
					}
					return {
						...this.relatedRow(relation.table, item, options),
						[relation.foreignKey!]: parentValue,
					};
				});
				if (children.length > 0) {
					await tx.insert(relation.table).values(children);
				}
				continue;
			}
			// Many-to-many: ids link existing rows, objects create new ones.
			const ids = value.filter((item) => !isPlainObject(item));
			const fresh = value.filter((item) => isPlainObject(item));
			if (fresh.length > 0) {
				const inserted = await tx
					.insert(relation.table)
					.values(
						fresh.map((item) => this.relatedRow(relation.table, item, options)),
					)
					.returning();
				ids.push(...inserted.map((r: any) => r[relation.references ?? "id"]));
			}
			await this.linkTargets(tx, relation, parentValue, ids, options);
		}
		return created;
	}

	// A row for a related table from a nested body: only its own columns,
	// never its soft delete column, with its timestamps and the tenant scope
	// set when the table has those columns.
	private relatedRow(
		table: any,
		value: Record<string, any>,
		options?: SqlOperationOptions,
	): Record<string, any> {
		const out: Record<string, any> = {};
		for (const [key, item] of Object.entries(value)) {
			if (item !== undefined && this.columnOf(table, key)) out[key] = item;
		}
		const softDelete = this.config.softDelete;
		if (softDelete?.enabled) delete out[softDelete.column];
		const now = new Date();
		for (const key of [
			this.config.timestamps?.createdAt,
			this.config.timestamps?.updatedAt,
		]) {
			if (key && this.columnOf(table, key)) out[key] = now;
		}
		for (const [key, item] of Object.entries(
			this.resolveScope(options) ?? {},
		)) {
			if (this.columnOf(table, key)) out[key] = item;
		}
		return out;
	}

	// ---- Many-to-many links: attach, detach, sync ----

	// Link `ids` of the related table to this row, through the join table. Set
	// based: one SELECT checks every id exists (live, and in the tenant scope
	// when the related table has the scope column), one SELECT finds the links
	// already there, one INSERT adds the rest. An unknown id is a 404 entry of
	// a BulkOperationException.
	private async linkTargets(
		tx: any,
		relation: RelationConfig,
		parentValue: unknown,
		ids: unknown[],
		options?: SqlOperationOptions,
	): Promise<void> {
		const wanted = this.uniqueValues(ids);
		if (wanted.length === 0) return;
		const target = relation.table;
		const referenced = target[relation.references ?? "id"];
		const through = relation.through;
		const local = through[relation.throughLocalKey!];
		const foreign = through[relation.throughForeignKey!];

		const conditions = [inArray(referenced, wanted)];
		const softDeleted = this.softDeleteCondition(target);
		if (softDeleted) conditions.push(softDeleted);
		for (const [key, value] of Object.entries(
			this.resolveScope(options) ?? {},
		)) {
			if (!this.columnOf(target, key)) continue;
			conditions.push(
				value === null ? isNull(target[key]) : eq(target[key], value),
			);
		}
		const found: any[] = await tx
			.select({ id: referenced })
			.from(target)
			.where(and(...conditions));
		const present = new Set(found.map((row) => this.valueKey(row.id)));
		const missing = wanted.filter((id) => !present.has(this.valueKey(id)));
		if (missing.length > 0) {
			const name = this.tableName(target);
			throw new BulkOperationException(
				"Unknown related ids",
				missing.map((id) => ({
					id,
					error: new EntityNotFoundException(name, id),
				})),
			);
		}

		const linked: any[] = await tx
			.select({ id: foreign })
			.from(through)
			.where(and(eq(local, parentValue), inArray(foreign, wanted)));
		const already = new Set(linked.map((row) => this.valueKey(row.id)));
		const add = wanted.filter((id) => !already.has(this.valueKey(id)));
		if (add.length > 0) {
			await tx.insert(through).values(
				add.map((id) => ({
					[relation.throughLocalKey!]: parentValue,
					[relation.throughForeignKey!]: id,
				})),
			);
		}
	}

	// Link related rows to this row through a many-to-many relation. Ids that
	// are already linked are left alone. Returns the row with the relation
	// loaded.
	async attach(
		id: any,
		relation: string,
		relatedIds: unknown[],
		options?: SqlOperationOptions,
	): Promise<T> {
		return this.changeLinks("attach", id, relation, relatedIds, options);
	}

	// Unlink related rows, or every related row when `relatedIds` is left out.
	// The related rows themselves are not touched.
	async detach(
		id: any,
		relation: string,
		relatedIds?: unknown[],
		options?: SqlOperationOptions,
	): Promise<T> {
		return this.changeLinks("detach", id, relation, relatedIds, options);
	}

	// Make the links exactly `relatedIds`: add the missing, remove the rest.
	async sync(
		id: any,
		relation: string,
		relatedIds: unknown[],
		options?: SqlOperationOptions,
	): Promise<T> {
		return this.changeLinks("sync", id, relation, relatedIds, options);
	}

	private async changeLinks(
		operation: "attach" | "detach" | "sync",
		id: any,
		name: string,
		relatedIds: unknown[] | undefined,
		options?: SqlOperationOptions,
	): Promise<T> {
		const relations = this.config.relations || {};
		const relation = Object.hasOwn(relations, name)
			? relations[name]
			: undefined;
		if (!relation || this.relationType(relation) !== "manyToMany") {
			throw new BadRequestException(
				`"${name}" is not a many-to-many relation of ${this.getEntityName()}`,
			);
		}
		const allowed = this.config.writableRelations;
		if (allowed && !allowed.includes(name) && !options?.skipAllowlists) {
			throw new ValidationFailedException(
				`the relation "${name}" is not writable`,
			);
		}
		if (
			relatedIds !== undefined &&
			(!Array.isArray(relatedIds) ||
				relatedIds.some((item) => item === null || typeof item === "object"))
		) {
			throw new BadRequestException(`${operation} takes an array of ids`);
		}
		if (operation !== "detach" && relatedIds === undefined) {
			throw new BadRequestException(`${operation} takes an array of ids`);
		}
		this.checkReadOptions(options);
		const ids = this.uniqueValues(relatedIds ?? []);
		const parentKey = this.parentKeyOf(relation);

		return this.executeSqlTransaction(async (tx) => {
			const opts = { ...options, transaction: tx };
			const parent = await this.find(id, {
				...opts,
				relations: [],
				counts: undefined,
				select: [this.config.primaryKey, parentKey],
				skipAllowlists: true,
			});
			if (!parent) throw new EntityNotFoundException(this.getEntityName(), id);
			await this.emitEvent(
				"before",
				operation,
				false,
				{ ids: [id], input: relatedIds, transaction: tx },
				options,
			);
			const parentValue = (parent as Record<string, any>)[parentKey];
			const through = relation.through;
			const local = through[relation.throughLocalKey!];
			const foreign = through[relation.throughForeignKey!];
			if (operation === "detach") {
				if (relatedIds === undefined) {
					await tx.delete(through).where(eq(local, parentValue));
				} else if (ids.length > 0) {
					await tx
						.delete(through)
						.where(and(eq(local, parentValue), inArray(foreign, ids)));
				}
			} else {
				await this.linkTargets(tx, relation, parentValue, ids, opts);
				if (operation === "sync") {
					await tx
						.delete(through)
						.where(
							ids.length > 0
								? and(eq(local, parentValue), notInArray(foreign, ids))
								: eq(local, parentValue),
						);
				}
			}
			const row = (await this.find(id, {
				...opts,
				relations: Array.from(new Set([name, ...(options?.relations ?? [])])),
				skipAllowlists: true,
			})) as T;
			await this.emitEvent(
				"after",
				operation,
				false,
				{ ids: [id], input: relatedIds, rows: [row], transaction: tx },
				options,
			);
			return row;
		}, options?.transaction);
	}

	// A comparable key for any id: numbers from the driver against strings
	// from a request, uuids in either case.
	private valueKey(value: unknown): string {
		return String(value).toLowerCase();
	}

	private uniqueValues(values: unknown[]): unknown[] {
		const seen = new Set<string>();
		return values.filter((value) => {
			const key = this.valueKey(value);
			if (seen.has(key)) return false;
			seen.add(key);
			return true;
		});
	}

	private tableName(table: any): string {
		try {
			return getTableName(table) || "Entity";
		} catch {
			return "Entity";
		}
	}

	// Map an update DTO into the columns to SET, after writableColumns. An
	// update with no column left is a 400: Drizzle would send an empty SET (a
	// raw 500), or with timestamps on quietly bump updated_at instead. The
	// version column and the scope columns are never SET from a body.
	protected prepareUpdate(
		data: UpdateDto,
		options?: SqlOperationOptions,
	): Record<string, any> {
		const mapped = this.mapUpdateDtoToEntity(data);
		if (this.config.versionColumn) delete mapped[this.config.versionColumn];
		for (const key of Object.keys(this.resolveScope(options) ?? {})) {
			delete mapped[key];
		}
		const entityData = this.filterWritable(mapped, "update", options);
		const settable = Object.keys(entityData).filter(
			(key) =>
				entityData[key] !== undefined &&
				!!this.columnOf(this.config.table, key),
		);
		if (settable.length === 0) {
			throw new ValidationFailedException("there are no columns to update");
		}
		return entityData;
	}

	async update(
		id: any,
		data: UpdateDto,
		options?: SqlOperationOptions,
	): Promise<T> {
		const { transaction, hooks = {} } = options || {};
		this.checkReadOptions(options);
		const expected = this.expectedVersionOf(data, options);
		const opts: SqlOperationOptions = { ...options, expectedVersion: expected };
		const existing = await this.findForGuard(id, opts);
		if (!existing) throw new EntityNotFoundException(this.getEntityName(), id);

		await this.validateUpdate(id, data);
		const processedData = hooks.skipBefore
			? data
			: await this.beforeUpdate(id, data);
		const entityData = this.prepareUpdate(processedData, opts);

		if (this.config.timestamps?.updatedAt) {
			entityData[this.config.timestamps.updatedAt] = new Date();
		}

		const db = transaction || this.config.db;
		await this.emitEvent(
			"before",
			"update",
			false,
			{ ids: [id], input: data, transaction },
			options,
		);
		try {
			const [updatedEntity] = await this.updateWhereIn(
				db,
				this.withVersionBump(entityData),
				[id],
				opts,
			);
			if (!updatedEntity) {
				if (expected !== undefined) {
					throw new StaleVersionException(this.getEntityName(), id);
				}
				throw new Error("Failed to update entity");
			}
			if (!hooks.skipAfter) await this.afterUpdate(updatedEntity);
			await this.emitEvent(
				"after",
				"update",
				false,
				{ ids: [id], input: data, rows: [updatedEntity], transaction },
				options,
			);
			await this.loadWriteRelations(db, [updatedEntity], options);
			return updatedEntity;
		} catch (error) {
			throw this.toClientError(error, "write");
		}
	}

	// UPDATE ... WHERE pk IN (ids) AND <scope> [AND version], returning the
	// rows in the order of `ids`. Without RETURNING the rows are read back with
	// one SELECT.
	private async updateWhereIn(
		db: any,
		set: Record<string, any>,
		ids: any[],
		options?: SqlOperationOptions,
	): Promise<T[]> {
		const query = db
			.update(this.config.table)
			.set(set)
			.where(this.writeWhere(ids, options));
		if (this.config.sql?.useReturning) {
			return this.inIdOrder(await query.returning(), ids);
		}
		const result = await query;
		if (!this.wasAffected(result)) return [];
		return this.fetchByIds(db, ids, options);
	}

	// Every row whose primary key is in `ids`, deleted or not, in `ids` order,
	// within the tenant scope.
	private async fetchByIds(
		db: any,
		ids: any[],
		options?: SqlOperationOptions,
	): Promise<T[]> {
		const pk = this.config.table[this.config.primaryKey];
		const rows = await db
			.select()
			.from(this.config.table)
			.where(
				and(
					ids.length === 1 ? eq(pk, ids[0]) : inArray(pk, ids),
					...this.scopeConditions(options),
				),
			);
		return this.inIdOrder(rows, ids);
	}

	private inIdOrder(rows: any[], ids: any[]): T[] {
		const byKey = new Map<string, any>();
		for (const row of rows ?? []) {
			byKey.set(this.keyOf(row?.[this.config.primaryKey]), row);
		}
		return ids
			.map((id) => byKey.get(this.keyOf(id)))
			.filter((row): row is T => !!row);
	}

	async softDelete(id: any, options?: SqlOperationOptions): Promise<boolean> {
		if (!this.config.softDelete?.enabled) {
			throw new Error("Soft delete is not enabled for this entity");
		}

		const { transaction, hooks = {} } = options || {};
		const existing = await this.findForGuard(id, {
			...options,
			withDeleted: false,
			onlyDeleted: false,
		});
		if (!existing) throw new EntityNotFoundException(this.getEntityName(), id);

		if (!hooks.skipBefore) await this.beforeSoftDelete(id);
		await this.emitEvent(
			"before",
			"softDelete",
			false,
			{ ids: [id], transaction },
			options,
		);

		const db = transaction || this.config.db;
		let updateQuery = db
			.update(this.config.table)
			.set(this.softDeleteSet(new Date()))
			.where(this.writeWhere([id], options));

		if (this.config.sql?.useReturning) updateQuery = updateQuery.returning();
		const result = await this.runRead(updateQuery);
		const success = this.wasAffected(result);
		if (!success && options?.expectedVersion != null) {
			throw new StaleVersionException(this.getEntityName(), id);
		}

		if (success && !hooks.skipAfter) await this.afterSoftDelete(id);
		if (success) {
			await this.emitEvent(
				"after",
				"softDelete",
				false,
				{ ids: [id], transaction },
				options,
			);
		}
		return success;
	}

	// The SET of a soft delete (a Date) or a restore (null), which also moves
	// the version on.
	private softDeleteSet(deletedAt: Date | null): Record<string, any> {
		return this.withVersionBump({
			[this.config.softDelete!.column]: deletedAt,
			...(this.config.timestamps?.updatedAt && {
				[this.config.timestamps.updatedAt]: new Date(),
			}),
		});
	}

	async restore(id: any, options?: SqlOperationOptions): Promise<T> {
		if (!this.config.softDelete?.enabled) {
			throw new Error("Soft delete is not enabled for this entity");
		}

		const { transaction, hooks = {} } = options || {};
		if (options?.expectedVersion != null && this.config.versionColumn) {
			const existing = await this.findForGuard(id, {
				...options,
				withDeleted: true,
				onlyDeleted: false,
			});
			if (!existing)
				throw new EntityNotFoundException(this.getEntityName(), id);
		}
		if (!hooks.skipBefore) await this.beforeRestore(id);
		await this.emitEvent(
			"before",
			"restore",
			false,
			{ ids: [id], transaction },
			options,
		);

		const db = transaction || this.config.db;
		const [restoredEntity] = await this.runRead(
			this.updateWhereIn(db, this.softDeleteSet(null), [id], options),
		);
		if (!restoredEntity) {
			if (options?.expectedVersion != null && this.config.versionColumn) {
				throw new StaleVersionException(this.getEntityName(), id);
			}
			throw new EntityNotFoundException(this.getEntityName(), id);
		}
		if (!hooks.skipAfter) await this.afterRestore(restoredEntity);
		await this.emitEvent(
			"after",
			"restore",
			false,
			{ ids: [id], rows: [restoredEntity], transaction },
			options,
		);
		await this.loadWriteRelations(db, [restoredEntity], options);
		return restoredEntity;
	}

	async delete(id: any, options?: SqlOperationOptions): Promise<boolean> {
		const { transaction, hooks = {} } = options || {};
		const existing = await this.findForGuard(id, options);
		if (!existing) throw new EntityNotFoundException(this.getEntityName(), id);

		if (!hooks.skipBefore) await this.beforeDelete(id);
		await this.emitEvent(
			"before",
			"delete",
			false,
			{ ids: [id], transaction },
			options,
		);

		const db = transaction || this.config.db;
		const deleteQuery = db
			.delete(this.config.table)
			.where(this.writeWhere([id], options));

		try {
			const result = await deleteQuery;
			const success = this.wasAffected(result);
			if (!success && options?.expectedVersion != null) {
				throw new StaleVersionException(this.getEntityName(), id);
			}

			if (success && !hooks.skipAfter) await this.afterDelete(id);
			if (success) {
				await this.emitEvent(
					"after",
					"delete",
					false,
					{ ids: [id], transaction },
					options,
				);
			}
			return success;
		} catch (error) {
			// Dependent rows still reference this one (ON DELETE RESTRICT /
			// NO ACTION), which is a conflict, not a server fault -> 409.
			throw this.toClientError(error, "delete");
		}
	}

	// Hard delete, whether or not the row is soft-deleted: the purge half of a
	// trash view. Runs the delete hooks.
	async forceDelete(id: any, options?: SqlOperationOptions): Promise<boolean> {
		return this.delete(id, {
			...options,
			withDeleted: true,
			onlyDeleted: false,
		});
	}

	// Insert or update by a unique key in one statement: ON CONFLICT DO UPDATE
	// on Postgres, ON DUPLICATE KEY UPDATE on MySQL. Runs validateCreate,
	// beforeCreate and mapCreateDtoToEntity, since it starts as an insert.
	// A unique violation on another key is still a 409. On a scoped entity a
	// conflict with another tenant's row updates nothing and is a 404.
	async upsert(
		data: CreateDto,
		upsert: UpsertOptions = {},
		options?: SqlOperationOptions,
	): Promise<T> {
		this.checkReadOptions(options);
		const entityData = await this.prepareCreate(data, options);
		const db = options?.transaction || this.config.db;
		await this.emitEvent(
			"before",
			"upsert",
			false,
			{ input: data, transaction: options?.transaction },
			options,
		);
		let row: T | undefined;
		try {
			[row] = await this.upsertRows(db, [entityData], upsert, options);
		} catch (error) {
			throw this.toClientError(error, "write");
		}
		if (!row) {
			throw new EntityNotFoundException(
				this.getEntityName(),
				this.conflictValue(entityData, upsert),
			);
		}
		await this.emitEvent(
			"after",
			"upsert",
			false,
			{
				ids: this.idsOf([row]),
				input: data,
				rows: [row],
				transaction: options?.transaction,
			},
			options,
		);
		await this.loadWriteRelations(db, [row], options);
		return row;
	}

	// One INSERT ... ON CONFLICT for the whole batch, in a transaction.
	async massUpsert(
		data: CreateDto[],
		upsert: UpsertOptions = {},
		options?: SqlOperationOptions,
	): Promise<T[]> {
		this.checkReadOptions(options);
		const message = "Mass upsert errors";
		return this.executeSqlTransaction(async (tx) => {
			const opts = { ...options, transaction: tx };
			const rows = await this.eachItem(
				data.map((item, index) => ({
					index,
					run: () => this.prepareCreate(item, opts),
				})),
				message,
			);
			if (rows.length === 0) return [];
			await this.emitEvent(
				"before",
				"upsert",
				true,
				{ input: data, transaction: tx },
				options,
			);
			const written = await this.runSet(
				tx,
				message,
				(sp) => this.upsertRows(sp, rows, upsert, opts),
				rows.map((row, index) => ({
					index,
					run: (sp: any) => this.upsertRows(sp, [row], upsert, opts),
				})),
				"write",
			);
			if (written.length < rows.length) {
				// A row of another tenant owns the key: nothing was written for
				// those items, so the whole batch is refused.
				const keys = this.conflictKeys(upsert);
				const seen = new Set(
					written.map((row: any) =>
						keys.map((k) => this.valueKey(row[k])).join("|"),
					),
				);
				throw new BulkOperationException(
					message,
					rows.flatMap((row, index) =>
						seen.has(keys.map((k) => this.valueKey(row[k])).join("|"))
							? []
							: [
									{
										index,
										error: new EntityNotFoundException(
											this.getEntityName(),
											this.conflictValue(row, upsert),
										),
									},
								],
					),
				);
			}
			await this.emitEvent(
				"after",
				"upsert",
				true,
				{
					ids: this.idsOf(written),
					input: data,
					rows: written,
					transaction: tx,
				},
				options,
			);
			await this.loadWriteRelations(tx, written, options);
			return written;
		}, options?.transaction);
	}

	private conflictKeys(upsert: UpsertOptions): string[] {
		return upsert.conflictTarget === undefined
			? [this.config.primaryKey]
			: ([] as string[]).concat(upsert.conflictTarget);
	}

	private conflictValue(
		row: Record<string, any>,
		upsert: UpsertOptions,
	): string {
		return this.conflictKeys(upsert)
			.map((key) => String(row[key]))
			.join(", ");
	}

	// The upsert statement itself. `update` names the columns to overwrite on a
	// conflict; by default every column sent except the conflict target, the
	// primary key, createdAt, the version and the scope columns. With nothing
	// to overwrite the target is set to itself, so the existing row still
	// comes back. The version goes up by one on a conflict, and on a scoped
	// entity the update only applies to a row of the caller's tenant.
	private async upsertRows(
		db: any,
		rows: Record<string, any>[],
		upsert: UpsertOptions,
		options?: SqlOperationOptions,
	): Promise<T[]> {
		const table = this.config.table;
		const targetKeys = this.conflictKeys(upsert);
		if (targetKeys.length === 0) {
			throw new BadRequestException("upsert needs a conflictTarget");
		}
		const targets = targetKeys.map((key) => {
			const column = this.columnOf(table, key);
			if (!column) {
				throw new BadRequestException(`Unknown conflict target column: ${key}`);
			}
			return column;
		});
		const scope = this.resolveScope(options);
		const version = this.config.versionColumn;
		const keep = new Set(
			[
				...targetKeys,
				this.config.primaryKey,
				this.config.timestamps?.createdAt,
				version,
				...Object.keys(scope ?? {}),
			].filter(Boolean),
		);
		const updateKeys = (
			upsert.update ??
			Array.from(
				new Set(
					rows.flatMap((row) =>
						Object.keys(row).filter(
							(key) =>
								row[key] !== undefined &&
								!keep.has(key) &&
								!!this.columnOf(table, key),
						),
					),
				),
			)
		).filter((key) => key !== version && !(scope && Object.hasOwn(scope, key)));
		const set: Record<string, any> = {};
		for (const key of updateKeys) {
			const column = this.columnOf(table, key);
			if (!column) {
				throw new BadRequestException(`Unknown upsert column: ${key}`);
			}
			set[key] = this.excludedValue(column);
		}
		if (Object.keys(set).length === 0) {
			set[targetKeys[0]!] = this.excludedValue(targets[0]);
		}
		if (version) set[version] = sql`${table[version]} + 1`;

		const readBack = !this.config.sql?.useReturning;
		if (readBack) {
			for (const row of rows) {
				for (const key of targetKeys) {
					if (row[key] === undefined) {
						throw new ValidationFailedException(
							`upsert needs a value for "${key}" to read the row back`,
						);
					}
				}
			}
		}

		const insert = db.insert(table).values(rows);
		let statement: any;
		if (this.config.dialect === "mysql") {
			// ON DUPLICATE KEY UPDATE has no WHERE, so it cannot keep a conflict
			// inside the tenant. Refuse rather than overwrite another tenant.
			if (scope) {
				throw new BadRequestException(
					"upsert on a scoped entity needs PostgreSQL",
				);
			}
			statement = insert.onDuplicateKeyUpdate({ set });
		} else {
			const scoped = this.scopeConditions(options);
			statement = insert.onConflictDoUpdate({
				target: targets.length === 1 ? targets[0] : targets,
				set,
				// `where` renders after the SET (DO UPDATE SET ... WHERE), the same
				// as `setWhere`, and every Drizzle version in the peer range has it.
				...(scoped.length > 0 && { where: and(...scoped) }),
			});
		}
		if (!readBack) return statement.returning();
		await statement;
		const match = rows.map((row) =>
			and(...targetKeys.map((key, i) => eq(targets[i], row[key]))),
		);
		return db
			.select()
			.from(table)
			.where(match.length === 1 ? match[0] : or(...match));
	}

	// The value a row would have had: excluded.col on Postgres, VALUES(col) on
	// MySQL.
	private excludedValue(column: any): any {
		return this.config.dialect === "mysql"
			? sql`values(${sql.identifier(column.name)})`
			: sql`excluded.${sql.identifier(column.name)}`;
	}

	// ---- Bulk operations ----
	//
	// Every mass write runs in one transaction and costs a fixed number of
	// statements whatever the number of ids: a SELECT that checks every id
	// exists (in the tenant scope, at the expected version), then one INSERT,
	// UPDATE or DELETE for the whole set. Hooks still run once per item, in
	// JavaScript; module-level events fire once for the batch. When the set
	// statement fails, the batch is replayed one item at a time inside a
	// savepoint that is rolled back, only to name the items that fail; the 400
	// then lists them in `errors` as before. `bulkMode: "perItem"` keeps the
	// 3.3 behaviour of one single-row call per item.

	async massCreate(
		data: CreateDto[],
		options?: SqlOperationOptions,
	): Promise<T[]> {
		if (options?.bulkMode === "perItem") {
			return this.massCreatePerItem(data, options);
		}
		this.checkReadOptions(options);
		return this.executeSqlTransaction(async (tx) => {
			const opts = { ...options, transaction: tx };
			const rows = await this.eachItem(
				data.map((item, index) => ({
					index,
					run: () => this.prepareCreate(item, opts),
				})),
				"Mass create errors",
			);
			if (rows.length === 0) return [];
			await this.emitEvent(
				"before",
				"create",
				true,
				{ input: data, transaction: tx },
				options,
			);
			const created = await this.runSet(
				tx,
				"Mass create errors",
				(sp) => this.insertMany(sp, rows, opts),
				rows.map((row, index) => ({
					index,
					run: (sp: any) => this.insertOne(sp, row, opts),
				})),
				"write",
			);
			if (!options?.hooks?.skipAfter) {
				for (const entity of created) await this.afterCreate(entity);
			}
			await this.emitEvent(
				"after",
				"create",
				true,
				{
					ids: this.idsOf(created),
					input: data,
					rows: created,
					transaction: tx,
				},
				options,
			);
			await this.loadWriteRelations(tx, created, options);
			return created;
		}, options?.transaction);
	}

	// One multi-row INSERT. Without RETURNING the rows are read back by their
	// primary keys, which works when the caller supplied them. MySQL only
	// reports the first auto-increment id of a batch and InnoDB does not
	// promise the rest are consecutive, so that one case inserts row by row.
	private async insertMany(
		db: any,
		rows: Record<string, any>[],
		options?: SqlOperationOptions,
	): Promise<T[]> {
		if (this.config.sql?.useReturning) {
			return db.insert(this.config.table).values(rows).returning();
		}
		const pk = this.config.primaryKey;
		if (rows.every((row) => row[pk] !== undefined)) {
			await db.insert(this.config.table).values(rows);
			return this.fetchByIds(
				db,
				rows.map((row) => row[pk]),
				options,
			);
		}
		const created: T[] = [];
		for (const row of rows)
			created.push(await this.insertOne(db, row, options));
		return created;
	}

	// Ids a set statement did not write although the existence check found
	// them: someone changed the version in between (409), or the row went away
	// (404). Throws a BulkOperationException naming them.
	private assertAllWritten(
		ids: any[],
		written: T[],
		message: string,
		options?: SqlOperationOptions,
	): void {
		if (written.length >= ids.length) return;
		const done = new Set(
			written.map((row) => this.keyOf(row?.[this.config.primaryKey])),
		);
		throw new BulkOperationException(
			message,
			ids
				.filter((id) => !done.has(this.keyOf(id)))
				.map((id) => ({
					id,
					error:
						options?.expectedVersions?.[this.keyOf(id)] != null
							? new StaleVersionException(this.getEntityName(), id)
							: new EntityNotFoundException(this.getEntityName(), id),
				})),
		);
	}

	async massUpdate(
		ids: any[],
		data: UpdateDto,
		options?: SqlOperationOptions,
	): Promise<T[]> {
		if (options?.bulkMode === "perItem") {
			return this.massUpdatePerItem(ids, data, options);
		}
		this.checkReadOptions(options);
		const message = "Mass update errors";
		return this.executeSqlTransaction(async (tx) => {
			const opts = { ...options, transaction: tx };
			const hooks = options?.hooks ?? {};
			const unique = this.uniqueIds(ids);
			if (unique.length === 0) return [];
			await this.assertAllExist(tx, unique, opts, message);

			const sets = await this.eachItem(
				unique.map((id) => ({
					id,
					run: async () => {
						await this.validateUpdate(id, data);
						const processed = hooks.skipBefore
							? data
							: await this.beforeUpdate(id, data);
						return this.prepareUpdate(processed, opts);
					},
				})),
				message,
			);
			await this.emitEvent(
				"before",
				"update",
				true,
				{ ids: unique, input: data, transaction: tx },
				options,
			);
			const now = new Date();
			const stamp = (set: Record<string, any>) =>
				this.withVersionBump(
					this.config.timestamps?.updatedAt
						? { ...set, [this.config.timestamps.updatedAt]: now }
						: set,
				);

			let updated: T[];
			const first = this.fingerprint(sets[0]);
			if (sets.every((set) => this.fingerprint(set) === first)) {
				const set = stamp(sets[0]!);
				updated = await this.runSet(
					tx,
					message,
					(sp) => this.updateWhereIn(sp, set, unique, opts),
					unique.map((id) => ({
						id,
						run: (sp: any) => this.updateWhereIn(sp, set, [id], opts),
					})),
					"write",
				);
			} else {
				// A beforeUpdate hook returned different data per id, which one SET
				// cannot express, so each row gets its own UPDATE.
				const rows = await this.eachItem(
					unique.map((id, i) => ({
						id,
						run: () =>
							this.savepoint(tx, (sp) =>
								this.updateWhereIn(sp, stamp(sets[i]!), [id], opts),
							),
					})),
					message,
					"write",
				);
				updated = rows.flat();
			}
			this.assertAllWritten(unique, updated, message, options);

			if (!hooks.skipAfter) {
				for (const entity of updated) await this.afterUpdate(entity);
			}
			await this.emitEvent(
				"after",
				"update",
				true,
				{ ids: unique, input: data, rows: updated, transaction: tx },
				options,
			);
			await this.loadWriteRelations(tx, updated, options);
			return this.inIdOrder(updated, ids);
		}, options?.transaction);
	}

	// A set UPDATE or DELETE without a row coming back: RETURNING the keys on
	// Postgres, so an id another writer moved past the expected version can be
	// named; MySQL only reports a count.
	private async runKeyed(statement: any, ids: any[]): Promise<T[]> {
		if (this.config.sql?.useReturning) {
			return statement.returning({
				[this.config.primaryKey]: this.config.table[this.config.primaryKey],
			});
		}
		const result = await statement;
		return this.wasAffected(result)
			? ids.map((id) => ({ [this.config.primaryKey]: id }) as unknown as T)
			: [];
	}

	async massSoftDelete(
		ids: any[],
		options?: SqlOperationOptions,
	): Promise<boolean> {
		if (!this.config.softDelete?.enabled)
			throw new Error("Soft delete not enabled");
		if (options?.bulkMode === "perItem") {
			return this.massSoftDeletePerItem(ids, options);
		}
		const message = "Mass soft delete errors";
		return this.executeSqlTransaction(async (tx) => {
			const opts = {
				...options,
				transaction: tx,
				withDeleted: false,
				onlyDeleted: false,
			};
			const hooks = options?.hooks ?? {};
			const unique = this.uniqueIds(ids);
			if (unique.length === 0) return true;
			await this.assertAllExist(tx, unique, opts, message);
			if (!hooks.skipBefore) {
				await this.eachItem(
					unique.map((id) => ({ id, run: () => this.beforeSoftDelete(id) })),
					message,
				);
			}
			await this.emitEvent(
				"before",
				"softDelete",
				true,
				{ ids: unique, transaction: tx },
				options,
			);
			const set = this.softDeleteSet(new Date());
			const written = await this.runSet(
				tx,
				message,
				(sp) =>
					this.runKeyed(
						sp
							.update(this.config.table)
							.set(set)
							.where(this.writeWhere(unique, opts)),
						unique,
					),
				unique.map((id) => ({
					id,
					run: (sp: any) =>
						sp
							.update(this.config.table)
							.set(set)
							.where(this.writeWhere([id], opts)),
				})),
				"write",
			);
			this.assertAllWritten(unique, written, message, options);
			if (!hooks.skipAfter) {
				for (const id of unique) await this.afterSoftDelete(id);
			}
			await this.emitEvent(
				"after",
				"softDelete",
				true,
				{ ids: unique, transaction: tx },
				options,
			);
			return true;
		}, options?.transaction);
	}

	async massRestore(ids: any[], options?: SqlOperationOptions): Promise<T[]> {
		if (!this.config.softDelete?.enabled)
			throw new Error("Soft delete not enabled");
		if (options?.bulkMode === "perItem") {
			return this.massRestorePerItem(ids, options);
		}
		this.checkReadOptions(options);
		const message = "Mass restore errors";
		return this.executeSqlTransaction(async (tx) => {
			const opts = {
				...options,
				transaction: tx,
				withDeleted: true,
				onlyDeleted: false,
			};
			const hooks = options?.hooks ?? {};
			const unique = this.uniqueIds(ids);
			if (unique.length === 0) return [];
			await this.assertAllExist(tx, unique, opts, message);
			if (!hooks.skipBefore) {
				await this.eachItem(
					unique.map((id) => ({ id, run: () => this.beforeRestore(id) })),
					message,
				);
			}
			await this.emitEvent(
				"before",
				"restore",
				true,
				{ ids: unique, transaction: tx },
				options,
			);
			const set = this.softDeleteSet(null);
			const restored = await this.runSet(
				tx,
				message,
				(sp) => this.updateWhereIn(sp, set, unique, opts),
				unique.map((id) => ({
					id,
					run: (sp: any) => this.updateWhereIn(sp, set, [id], opts),
				})),
				"write",
			);
			this.assertAllWritten(unique, restored, message, options);
			if (!hooks.skipAfter) {
				for (const entity of restored) await this.afterRestore(entity);
			}
			await this.emitEvent(
				"after",
				"restore",
				true,
				{ ids: unique, rows: restored, transaction: tx },
				options,
			);
			await this.loadWriteRelations(tx, restored, options);
			return this.inIdOrder(restored, ids);
		}, options?.transaction);
	}

	async massDelete(
		ids: any[],
		options?: SqlOperationOptions,
	): Promise<boolean> {
		if (options?.bulkMode === "perItem") {
			return this.massDeletePerItem(ids, options);
		}
		const message = "Mass delete errors";
		return this.executeSqlTransaction(async (tx) => {
			const opts = { ...options, transaction: tx };
			const hooks = options?.hooks ?? {};
			const unique = this.uniqueIds(ids);
			if (unique.length === 0) return true;
			await this.assertAllExist(tx, unique, opts, message);
			if (!hooks.skipBefore) {
				await this.eachItem(
					unique.map((id) => ({ id, run: () => this.beforeDelete(id) })),
					message,
				);
			}
			await this.emitEvent(
				"before",
				"delete",
				true,
				{ ids: unique, transaction: tx },
				options,
			);
			const written = await this.runSet(
				tx,
				message,
				(sp) =>
					this.runKeyed(
						sp.delete(this.config.table).where(this.writeWhere(unique, opts)),
						unique,
					),
				unique.map((id) => ({
					id,
					run: (sp: any) =>
						sp.delete(this.config.table).where(this.writeWhere([id], opts)),
				})),
				// Dependent rows still reference an id -> 409 for that id.
				"delete",
			);
			this.assertAllWritten(unique, written, message, options);
			if (!hooks.skipAfter) {
				for (const id of unique) await this.afterDelete(id);
			}
			await this.emitEvent(
				"after",
				"delete",
				true,
				{ ids: unique, transaction: tx },
				options,
			);
			return true;
		}, options?.transaction);
	}

	// Hard delete a set of rows, soft-deleted or not, in one statement.
	async massForceDelete(
		ids: any[],
		options?: SqlOperationOptions,
	): Promise<boolean> {
		return this.massDelete(ids, {
			...options,
			withDeleted: true,
			onlyDeleted: false,
		});
	}

	// The ids in input order with duplicates removed.
	private uniqueIds(ids: any[]): any[] {
		const seen = new Set<string>();
		return (ids ?? []).filter((id) => {
			const key = this.keyOf(id);
			if (seen.has(key)) return false;
			seen.add(key);
			return true;
		});
	}

	// A stable string for comparing two SET objects (Dates and bigints included).
	private fingerprint(value: unknown): string {
		return JSON.stringify(value, (_key, v) =>
			typeof v === "bigint" ? `${v}n` : v,
		);
	}

	// One SELECT for every id, in the soft delete scope of `options`. Every id
	// that is not there becomes a 404 entry of the BulkOperationException.
	private async assertAllExist(
		tx: any,
		ids: any[],
		options: SqlOperationOptions,
		message: string,
	): Promise<void> {
		const table = this.config.table;
		const pk = table[this.config.primaryKey];
		const scope = this.rowScope(options);
		const where = (condition: any) => and(condition, ...scope);
		const version = this.config.versionColumn;
		const fields: Record<string, any> = { id: pk };
		if (version) fields.version = table[version];
		const found: any[] = await this.runSet(
			tx,
			message,
			(sp) =>
				sp
					.select(fields)
					.from(table)
					.where(where(inArray(pk, ids))),
			ids.map((id) => ({
				id,
				run: (sp: any) =>
					sp
						.select(fields)
						.from(table)
						.where(where(eq(pk, id))),
			})),
			"write",
		);
		const present = new Map(found.map((row) => [this.keyOf(row.id), row]));
		const errors: Array<{ id: any; error: Error }> = [];
		for (const id of ids) {
			const row = present.get(this.keyOf(id));
			if (!row) {
				errors.push({
					id,
					error: new EntityNotFoundException(this.getEntityName(), id),
				});
				continue;
			}
			const expected = options.expectedVersions?.[this.keyOf(id)];
			if (version && expected != null && Number(row.version) !== expected) {
				errors.push({
					id,
					error: new StaleVersionException(this.getEntityName(), id),
				});
			}
		}
		if (errors.length > 0) throw new BulkOperationException(message, errors);
	}

	// Run one async step per item, collecting every failure instead of stopping
	// at the first. Any failure throws a BulkOperationException listing them.
	private async eachItem<R>(
		items: Array<{ index?: number; id?: any; run: () => Promise<R> }>,
		message: string,
		operation: "write" | "delete" = "write",
	): Promise<R[]> {
		const results: R[] = [];
		const errors: Array<{ id?: any; index?: number; error: Error }> = [];
		for (const item of items) {
			try {
				results.push(await item.run());
			} catch (error) {
				errors.push({
					...this.itemRef(item),
					error: this.toClientError(error, operation) as Error,
				});
			}
		}
		if (errors.length > 0) throw new BulkOperationException(message, errors);
		return results;
	}

	private itemRef(item: { index?: number; id?: any }) {
		return item.index !== undefined ? { index: item.index } : { id: item.id };
	}

	// Run a set statement inside a savepoint. When it fails, find out which
	// items fail on their own and report those; when none does alone (the
	// failure needs two items together), report the statement's own error.
	protected async runSet<R>(
		tx: any,
		message: string,
		statement: (sp: any) => Promise<R>,
		items: Array<{
			index?: number;
			id?: any;
			run: (sp: any) => Promise<unknown>;
		}>,
		operation: "write" | "delete",
	): Promise<R> {
		try {
			return await this.savepoint(tx, statement);
		} catch (error) {
			const failures = await this.diagnose(tx, items, operation);
			if (failures.length > 0) {
				throw new BulkOperationException(message, failures);
			}
			throw this.toClientError(error, operation);
		}
	}

	// Replay items one by one, each in its own savepoint, all inside an outer
	// savepoint that is rolled back at the end, so nothing the replay wrote
	// survives even inside a caller's transaction.
	private async diagnose(
		tx: any,
		items: Array<{
			index?: number;
			id?: any;
			run: (sp: any) => Promise<unknown>;
		}>,
		operation: "write" | "delete",
	): Promise<Array<{ id?: any; index?: number; error: Error }>> {
		const failures: Array<{ id?: any; index?: number; error: Error }> = [];
		try {
			await this.savepoint(tx, async (outer) => {
				for (const item of items) {
					try {
						await this.savepoint(outer, item.run);
					} catch (error) {
						failures.push({
							...this.itemRef(item),
							error: this.toClientError(error, operation) as Error,
						});
					}
				}
				throw ROLLBACK;
			});
		} catch (error) {
			// The rollback above is deliberate; anything else is real.
			if (error !== ROLLBACK) throw error;
		}
		return failures;
	}

	// ---- bulkMode: "perItem", the 3.3 behaviour ----

	private async massCreatePerItem(
		data: CreateDto[],
		options?: SqlOperationOptions,
	): Promise<T[]> {
		return this.executeSqlTransaction(
			(tx) =>
				this.eachItem(
					data.map((item, index) => ({
						index,
						run: () =>
							this.savepoint(tx, (sp) =>
								this.create(item, { ...options, transaction: sp }),
							),
					})),
					"Mass create errors",
				),
			options?.transaction,
		);
	}

	private async massUpdatePerItem(
		ids: any[],
		data: UpdateDto,
		options?: SqlOperationOptions,
	): Promise<T[]> {
		return this.executeSqlTransaction(
			(tx) =>
				this.eachItem(
					ids.map((id) => ({
						id,
						run: () =>
							this.savepoint(tx, (sp) =>
								this.update(id, data, { ...options, transaction: sp }),
							),
					})),
					"Mass update errors",
				),
			options?.transaction,
		);
	}

	private async massSoftDeletePerItem(
		ids: any[],
		options?: SqlOperationOptions,
	): Promise<boolean> {
		await this.executeSqlTransaction(
			(tx) =>
				this.eachItem(
					ids.map((id) => ({
						id,
						run: () =>
							this.savepoint(tx, (sp) =>
								this.softDelete(id, { ...options, transaction: sp }),
							),
					})),
					"Mass soft delete errors",
				),
			options?.transaction,
		);
		return true;
	}

	private async massRestorePerItem(
		ids: any[],
		options?: SqlOperationOptions,
	): Promise<T[]> {
		return this.executeSqlTransaction(
			(tx) =>
				this.eachItem(
					ids.map((id) => ({
						id,
						run: () =>
							this.savepoint(tx, (sp) =>
								this.restore(id, { ...options, transaction: sp }),
							),
					})),
					"Mass restore errors",
				),
			options?.transaction,
		);
	}

	private async massDeletePerItem(
		ids: any[],
		options?: SqlOperationOptions,
	): Promise<boolean> {
		await this.executeSqlTransaction(
			(tx) =>
				this.eachItem(
					ids.map((id) => ({
						id,
						run: () =>
							this.savepoint(tx, (sp) =>
								this.delete(id, { ...options, transaction: sp }),
							),
					})),
					"Mass delete errors",
					"delete",
				),
			options?.transaction,
		);
		return true;
	}

	// Run one bulk item in a nested transaction, which Drizzle turns into a
	// SAVEPOINT. A failed statement then rolls back that item alone; without it
	// Postgres aborts the whole transaction and every later item fails with
	// 25P02 ("current transaction is aborted"). The outer transaction still
	// rolls everything back when any item failed.
	protected savepoint<R>(tx: any, run: (sp: any) => Promise<R>): Promise<R> {
		return typeof tx?.transaction === "function"
			? tx.transaction(run)
			: run(tx);
	}

	// Utility Methods
	async exists(id: any, options?: SqlOperationOptions): Promise<boolean> {
		const entity = await this.find(id, {
			...options,
			select: [this.config.primaryKey],
		});
		return !!entity;
	}

	async count(
		filters?: FilterDto,
		options?: SqlOperationOptions,
	): Promise<number> {
		this.checkReadOptions(options);
		const db = options?.transaction || this.config.db;
		const { conditions, relations: filterRelations } = this.listConditions(
			filters,
			db,
			options,
		);

		const result = await this.runRead<any[]>(
			this.buildCountQuery(db, conditions, filterRelations),
		);
		return parseInt(result[0]?.count?.toString() || "0", 10);
	}

	// Grouped counts: how many rows have each value of `column`, after filters,
	// search, tenant scope and soft delete. `column` is a column of this table
	// or of a top-level belongs-to ("region.name"), and must be filterable.
	// One GROUP BY query, largest group first.
	async countBy<V = unknown>(
		column: string,
		filters?: FilterDto,
		options?: SqlOperationOptions,
	): Promise<CountByRow<V>[]> {
		this.checkReadOptions(options);
		const db = options?.transaction || this.config.db;
		const spec = this.resolveGroupColumn(column, options);
		const { conditions, relations: filterRelations } = this.listConditions(
			filters,
			db,
			options,
		);
		const joins = Array.from(
			new Set([...filterRelations, ...(spec.relation ? [spec.relation] : [])]),
		);
		const total = sql<number>`count(*)`;
		let query = db
			.select({ value: spec.column, count: total })
			.from(this.config.table);
		query = this.applyJoins(query, joins);
		if (conditions.length > 0) query = query.where(and(...conditions));
		query = query.groupBy(spec.column).orderBy(desc(total), asc(spec.column));
		const rows = await this.runRead<any[]>(query);
		return rows.map((row) => ({
			value: row.value as V,
			count: Number(row.count),
		}));
	}

	private resolveGroupColumn(
		key: string,
		options?: SqlOperationOptions,
	): { column: any; relation?: string } {
		if (typeof key !== "string" || !key) {
			throw new BadRequestException("countBy needs a column");
		}
		const dot = key.indexOf(".");
		let resolved: { column: any; relation?: string } | undefined;
		if (dot < 0) {
			const column = this.columnOf(this.config.table, key);
			if (column) resolved = { column };
		} else {
			const name = key.slice(0, dot);
			const relations = this.config.relations || {};
			const relation = Object.hasOwn(relations, name)
				? relations[name]
				: undefined;
			const column =
				relation && !this.isCollection(relation) && relation.localKey
					? this.columnOf(relation.table, key.slice(dot + 1))
					: undefined;
			if (column) resolved = { column, relation: name };
		}
		if (!resolved) {
			throw new BadRequestException(`Unknown countBy column: ${key}`);
		}
		this.assertAllowed("filterableColumns", key, options);
		return resolved;
	}

	// ---- Relation counts (_count) ----

	// The relation names of a `counts` option.
	protected countNames(counts?: RelationCounts): string[] {
		if (!counts) return [];
		if (Array.isArray(counts)) return counts.filter(Boolean);
		if (!isPlainObject(counts)) {
			throw new BadRequestException(
				"counts must be a list of relation names or an object of filters",
			);
		}
		return Object.keys(counts);
	}

	// A narrowed projection still needs the key each count groups on.
	protected withCountKeys(base: string[], counts?: RelationCounts): string[] {
		if (base.length === 0) return base;
		const keys = this.countNames(counts).flatMap((name) => {
			const relation = this.config.relations?.[name];
			return relation ? [this.parentKeyOf(relation)] : [];
		});
		return keys.length > 0 ? Array.from(new Set([...base, ...keys])) : base;
	}

	// Put `_count: { relation: n }` on each row. One GROUP BY query per
	// relation for the whole result set, whatever the number of rows, and the
	// relations run concurrently. Soft-deleted related rows are not counted.
	protected async loadCounts(
		db: any,
		rows: any[],
		counts: RelationCounts | undefined,
		options?: SqlOperationOptions,
	): Promise<void> {
		const names = this.countNames(counts);
		if (names.length === 0 || !Array.isArray(rows)) return;
		const relations = this.config.relations || {};
		const plan = names.map((name) => {
			const relation = Object.hasOwn(relations, name)
				? relations[name]
				: undefined;
			if (!relation) {
				throw new BadRequestException(`Unknown relation to count: ${name}`);
			}
			if (!this.isCollection(relation)) {
				throw new BadRequestException(
					`Cannot count "${name}": only a has-many or many-to-many relation has a count`,
				);
			}
			const filter =
				!Array.isArray(counts) && isPlainObject(counts?.[name])
					? (counts?.[name] as Record<string, any>)
					: undefined;
			return { name, relation, filter };
		});
		const hosts = rows.filter((row) => row && typeof row === "object");
		for (const host of hosts) host._count = {};
		if (hosts.length === 0) return;

		await Promise.all(
			plan.map(async ({ name, relation, filter }) => {
				const parentKey = this.parentKeyOf(relation);
				const ids = Array.from(
					new Set(
						hosts.map((host) => host[parentKey]).filter((v) => v != null),
					),
				);
				const totals = new Map<string, number>();
				if (ids.length > 0) {
					const result = await this.runRead<any[]>(
						this.countQuery(db, relation, ids, name, filter, options),
					);
					for (const row of result) {
						totals.set(String(row[COUNT_KEY]), Number(row.count));
					}
				}
				for (const host of hosts) {
					host._count[name] = totals.get(String(host[parentKey])) ?? 0;
				}
			}),
		);
	}

	// SELECT key, count(*) ... WHERE key IN (parent keys) GROUP BY key, from the
	// related table (has-many) or the join table joined to it (many-to-many).
	private countQuery(
		db: any,
		relation: RelationConfig,
		ids: unknown[],
		name: string,
		filter: Record<string, any> | undefined,
		options?: SqlOperationOptions,
	): any {
		const target = relation.table;
		const conditions: any[] = [];
		if (filter) {
			conditions.push(
				...this.compileFilterAt(
					{
						table: target,
						source: target,
						relations: relation.relations ?? {},
						prefix: name,
						root: false,
					},
					filter,
					db,
					new Set(),
					options,
				),
			);
		}
		const softDeleted = this.softDeleteCondition(target);
		if (softDeleted) conditions.push(softDeleted);
		const total = sql<number>`count(*)`;
		if (this.relationType(relation) === "manyToMany") {
			const joinLocal = relation.through[relation.throughLocalKey!];
			const joinForeign = relation.through[relation.throughForeignKey!];
			const referenced = target[relation.references ?? "id"];
			return db
				.select({ [COUNT_KEY]: joinLocal, count: total })
				.from(relation.through)
				.innerJoin(target, eq(joinForeign, referenced))
				.where(and(inArray(joinLocal, ids), ...conditions))
				.groupBy(joinLocal);
		}
		const foreign = target[relation.foreignKey!];
		return db
			.select({ [COUNT_KEY]: foreign, count: total })
			.from(target)
			.where(and(inArray(foreign, ids), ...conditions))
			.groupBy(foreign);
	}

	// Protected Helper Methods

	// Build a single column condition from a filter value:
	//   array              -> IN (...)
	//   { op: value, ... } -> comparison/pattern operators (see applyComplexFilter)
	//   string on a text column -> case-insensitive exact match (when
	//                        sql.caseSensitive is false)
	//   anything else, a Date included -> eq
	// Date strings are turned into Dates for date columns first.
	protected pushColumnCondition(
		conditions: any[],
		column: any,
		value: any,
		caseInsensitive = this.config.sql?.caseSensitive === false,
	): void {
		if (Array.isArray(value)) {
			conditions.push(
				inArray(
					column,
					value.map((item) => this.coerceFilterValue(column, item)),
				),
			);
		} else if (isPlainObject(value)) {
			this.applyComplexFilter(conditions, column, value);
		} else {
			const coerced = this.coerceFilterValue(column, value);
			if (
				typeof coerced === "string" &&
				caseInsensitive &&
				this.isTextColumn(column)
			) {
				// Case-insensitive *exact* match. Compare `lower(column) = lower(value)`
				// rather than `ilike(column, value)`: ILIKE treats `%`, `_` and `\` in
				// the value as wildcards/escapes, which silently turns an equality
				// filter into a pattern match (returning rows that don't actually
				// equal the value). Use the explicit `{ like: ... }` / `{ ilike: ... }`
				// operators when pattern matching is intended. Only text columns get
				// lower(): Postgres has no lower(integer), lower(uuid) or lower(enum),
				// and a plain `=` lets it cast the string parameter to the column type.
				conditions.push(sql`lower(${column}) = lower(${coerced})`);
			} else {
				conditions.push(eq(column, coerced));
			}
		}
	}

	// Filter by a collection relation (has-many or many-to-many): keep the parents
	// that have at least one matching row. Built as
	// `parentKey IN (SELECT key FROM related WHERE ...)` rather than a JOIN, so
	// parent rows are never duplicated and `total` and pagination stay correct.
	// Returns undefined when nothing usable was given.
	protected buildCollectionFilter(
		relation: RelationConfig,
		value: Record<string, any>,
		db: any = this.config.db,
		name = "relation",
		options?: SqlOperationOptions,
	): any | undefined {
		const targetConditions = this.compileFilterAt(
			this.relationHost(relation, relation.table, name),
			value,
			db,
			new Set(),
			options,
		);
		if (targetConditions.length === 0) return undefined;
		return this.collectionCondition(
			relation,
			targetConditions,
			db,
			this.rootHost(),
		);
	}

	// The IN (SELECT ...) for already compiled conditions on the related table.
	private collectionCondition(
		relation: RelationConfig,
		targetConditions: any[],
		db: any,
		host: FilterHost,
	): any | undefined {
		const target = relation.table;
		const manyToMany = this.relationType(relation) === "manyToMany";
		const joinLocal = manyToMany
			? relation.through?.[relation.throughLocalKey ?? ""]
			: undefined;
		const key = manyToMany ? joinLocal : target[relation.foreignKey ?? ""];
		if (!key) return undefined;

		const conditions = [...targetConditions];
		const softDeleted = this.softDeleteCondition(target);
		if (softDeleted) conditions.push(softDeleted);

		let subquery: any;
		if (manyToMany) {
			const referenced = target[relation.references ?? "id"];
			const joinForeign = relation.through?.[relation.throughForeignKey ?? ""];
			if (!referenced || !joinForeign) return undefined;
			subquery = db
				.select({ value: key })
				.from(relation.through)
				.innerJoin(target, eq(joinForeign, referenced))
				.where(and(...conditions));
		} else {
			subquery = db
				.select({ value: key })
				.from(target)
				.where(and(...conditions));
		}
		const parentKey = this.parentKeyOf(relation, host.source);
		return inArray(host.table[parentKey], subquery);
	}

	// `none` and `every` on a collection: NOT EXISTS over the related rows of
	// this parent, correlated on the parent key. `every` is "no related row
	// fails the filter", so a parent with no related rows passes it. A row
	// whose filter is NULL counts as failing.
	private quantifiedCollection(
		quantifier: "none" | "every",
		relation: RelationConfig,
		inner: Record<string, any>,
		name: string,
		db: any,
		host: FilterHost,
		options?: SqlOperationOptions,
	): any | undefined {
		const target = subqueryAlias(relation.table);
		const compiled = this.compileFilterAt(
			this.relationHost(relation, target, name),
			inner,
			db,
			new Set(),
			options,
		);
		if (quantifier === "every" && compiled.length === 0) return undefined;
		const parentKey = this.parentKeyOf(relation, host.source);
		const conditions: any[] = [];
		const softDeleted = this.softDeleteCondition(target);
		if (softDeleted) conditions.push(softDeleted);
		if (compiled.length > 0) {
			const matched = and(...compiled);
			conditions.push(
				quantifier === "every"
					? not(sql`coalesce(${matched}, false)`)
					: matched,
			);
		}
		let subquery: any;
		if (this.relationType(relation) === "manyToMany") {
			const through = subqueryAlias(relation.through);
			subquery = db
				.select({ one: sql`1` })
				.from(through)
				.innerJoin(
					target,
					eq(
						through[relation.throughForeignKey!],
						target[relation.references ?? "id"],
					),
				)
				.where(
					and(
						eq(through[relation.throughLocalKey!], host.table[parentKey]),
						...conditions,
					),
				);
		} else {
			subquery = db
				.select({ one: sql`1` })
				.from(target)
				.where(
					and(
						eq(target[relation.foreignKey!], host.table[parentKey]),
						...conditions,
					),
				);
		}
		return notExists(subquery);
	}

	// A belongs-to below the top level (`{ state: { country: { code } } }`):
	// EXISTS over the parent row, correlated on the foreign key. Only the
	// top-level belongs-to is joined.
	private belongsToExists(
		relation: RelationConfig,
		inner: Record<string, any>,
		name: string,
		db: any,
		host: FilterHost,
		options?: SqlOperationOptions,
	): any | undefined {
		const target = subqueryAlias(relation.table);
		const compiled = this.compileFilterAt(
			this.relationHost(relation, target, name),
			inner,
			db,
			new Set(),
			options,
		);
		if (compiled.length === 0) return undefined;
		const softDeleted = this.softDeleteCondition(target);
		return exists(
			db
				.select({ one: sql`1` })
				.from(target)
				.where(
					and(
						eq(
							target[relation.references ?? "id"],
							host.table[relation.localKey!],
						),
						...compiled,
						...(softDeleted ? [softDeleted] : []),
					),
				),
		);
	}

	private rootHost(): FilterHost {
		return {
			table: this.config.table,
			source: this.config.table,
			relations: this.config.relations || {},
			prefix: "",
			root: true,
		};
	}

	private relationHost(
		relation: RelationConfig,
		table: any,
		path: string,
	): FilterHost {
		return {
			table,
			source: relation.table,
			relations: relation.relations ?? {},
			prefix: path,
			root: false,
		};
	}

	// Build WHERE conditions from a filter object. A key matching a configured
	// relation, with an object value, filters by the related table's columns
	// (e.g. { state: { name: 'X', country_id: 1 } }), and may go on through
	// that table's own relations ({ state: { country: { code: 'IN' } } }). A
	// top-level belongs-to relation is returned in `relations` so the caller can
	// JOIN it; everything else becomes a subquery and needs no join. A
	// collection takes `some`, `none` or `every`. `and`, `or` and `not` group
	// filter objects and nest.
	// `undefined` and `null` values are skipped, so a query DTO can be passed
	// through with its empty fields. A key that is neither a column nor a
	// relation is a 400, like an unknown sortBy: dropping it would return every
	// row for a typo. So is a key outside filterableColumns.
	protected buildFilterConditions(
		filters?: any,
		db: any = this.config.db,
		options?: SqlOperationOptions,
	): {
		conditions: any[];
		relations: string[];
	} {
		const joins = new Set<string>();
		const conditions = this.compileFilterAt(
			this.rootHost(),
			filters,
			db,
			joins,
			options,
		);
		return { conditions, relations: Array.from(joins) };
	}

	// `and`, `or` and `not` are group keys unless the table really has a column
	// (or a relation) by that name, which then wins.
	private isGroupKey(host: FilterHost, key: string): boolean {
		if (!GROUP_KEYS.has(key) || this.columnOf(host.source, key)) return false;
		return !Object.hasOwn(host.relations, key);
	}

	// The conditions of one filter object on one table: columns, relations at
	// any depth and groups, all ANDed.
	private compileFilterAt(
		host: FilterHost,
		filters: any,
		db: any,
		joins: Set<string>,
		options?: SqlOperationOptions,
	): any[] {
		const conditions: any[] = [];
		if (filters === undefined || filters === null) return conditions;
		if (!isPlainObject(filters)) {
			throw new BadRequestException("A filter must be an object");
		}
		const path = (key: string) => (host.prefix ? `${host.prefix}.${key}` : key);

		for (const [key, value] of Object.entries(filters)) {
			if (value === undefined || value === null) continue;

			if (this.isGroupKey(host, key)) {
				const group = this.compileGroup(key, value, (member) =>
					this.compileFilterAt(host, member, db, joins, options),
				);
				if (group) conditions.push(group);
				continue;
			}

			const column = this.columnOf(host.source, key);
			const relation =
				!column && Object.hasOwn(host.relations, key)
					? host.relations[key]
					: undefined;
			if (relation) {
				if (!isPlainObject(value)) {
					throw new BadRequestException(
						`Filter on relation "${path(key)}" must be an object of column filters`,
					);
				}
				const condition = this.compileRelationFilter(
					host,
					key,
					relation,
					value,
					db,
					joins,
					options,
				);
				if (condition) conditions.push(condition);
				continue;
			}

			if (!column) {
				throw new BadRequestException(`Unknown filter column: ${path(key)}`);
			}
			this.assertAllowed("filterableColumns", path(key), options);
			this.pushColumnCondition(conditions, host.table[key] ?? column, value);
		}
		return conditions;
	}

	// One relation key of a filter. A collection's value is a filter (meaning
	// `some`) or an object of `some`, `none` and `every`, which are ANDed.
	private compileRelationFilter(
		host: FilterHost,
		name: string,
		relation: RelationConfig,
		value: Record<string, any>,
		db: any,
		joins: Set<string>,
		options?: SqlOperationOptions,
	): any | undefined {
		const path = host.prefix ? `${host.prefix}.${name}` : name;
		if (!this.isCollection(relation)) {
			if (host.root && relation.localKey) {
				const inner = this.compileFilterAt(
					this.relationHost(relation, relation.table, path),
					value,
					db,
					joins,
					options,
				);
				if (inner.length === 0) return undefined;
				joins.add(name);
				return inner.length === 1 ? inner[0] : and(...inner);
			}
			return this.belongsToExists(relation, value, path, db, host, options);
		}

		const keys = Object.keys(value);
		const quantified =
			keys.length > 0 &&
			keys.every(
				(key) => QUANTIFIERS.has(key) && !this.columnOf(relation.table, key),
			);
		const parts: any[] = [];
		const quantifiers: Array<[string, unknown]> = quantified
			? Object.entries(value)
			: [["some", value]];
		for (const [quantifier, inner] of quantifiers) {
			if (inner === undefined || inner === null) continue;
			if (!isPlainObject(inner)) {
				throw new BadRequestException(
					`Filter "${path}.${quantifier}" must be an object of column filters`,
				);
			}
			if (quantifier === "some") {
				const compiled = this.compileFilterAt(
					this.relationHost(relation, relation.table, path),
					inner,
					db,
					new Set(),
					options,
				);
				// A bare filter with nothing in it adds nothing, as before; an
				// explicit `some: {}` means "has at least one".
				if (compiled.length === 0 && !quantified) continue;
				const condition = this.collectionCondition(
					relation,
					compiled,
					db,
					host,
				);
				if (condition) parts.push(condition);
			} else {
				const condition = this.quantifiedCollection(
					quantifier as "none" | "every",
					relation,
					inner,
					path,
					db,
					host,
					options,
				);
				if (condition) parts.push(condition);
			}
		}
		if (parts.length === 0) return undefined;
		return parts.length === 1 ? parts[0] : and(...parts);
	}

	// `or: [a, b]`, `and: [a, b]` or `not: a`, where each member is a filter
	// object. An empty member of an `or` matches every row, so the whole group
	// adds nothing; an empty `and` member is skipped.
	private compileGroup(
		op: string,
		value: unknown,
		compile: (member: Record<string, any>) => any[],
	): any | undefined {
		if (op === "not") {
			if (!isPlainObject(value)) {
				throw new BadRequestException(
					'Filter group "not" expects a filter object',
				);
			}
			const inner = compile(value);
			return inner.length > 0 ? not(and(...inner)!) : undefined;
		}
		if (!Array.isArray(value)) {
			throw new BadRequestException(
				`Filter group "${op}" expects an array of filter objects`,
			);
		}
		const parts: any[] = [];
		for (const member of value) {
			if (!isPlainObject(member)) {
				throw new BadRequestException(
					`Filter group "${op}" expects an array of filter objects`,
				);
			}
			const inner = compile(member);
			if (inner.length === 0) {
				if (op === "or") return undefined;
				continue;
			}
			parts.push(inner.length === 1 ? inner[0] : and(...inner));
		}
		if (parts.length === 0) return undefined;
		return op === "or" ? or(...parts) : and(...parts);
	}

	protected buildWhereConditions(filters?: any): any[] {
		return this.buildFilterConditions(filters).conditions;
	}

	// `true` / `false`, or the same as strings from a query string.
	private parseFlag(op: string, value: unknown): boolean {
		if (value === true || value === "true") return true;
		if (value === false || value === "false") return false;
		throw new BadRequestException(
			`Invalid value for "${op}": expected true or false`,
		);
	}

	private expectArray(op: string, raw: unknown): unknown[] {
		if (!Array.isArray(raw)) {
			throw new BadRequestException(`Filter operator "${op}" expects an array`);
		}
		return raw;
	}

	private requirePostgres(op: string): void {
		if (this.config.dialect !== "postgresql") {
			throw new BadRequestException(
				`Filter operator "${op}" is only supported on PostgreSQL`,
			);
		}
	}

	// startsWith / endsWith / contains and their always case-insensitive `i`
	// forms. `%`, `_` and `\` in the value are escaped, so the value matches
	// literally. The plain forms follow sql.caseSensitive, like an exact match.
	private patternCondition(column: any, op: string, raw: unknown): any {
		if (typeof raw !== "string") {
			throw new BadRequestException(`Filter operator "${op}" expects a string`);
		}
		if (!this.isTextColumn(column)) {
			throw new BadRequestException(
				`Filter operator "${op}" only works on text columns`,
			);
		}
		const insensitive = /^i[A-Z]/.test(op);
		const kind = insensitive ? op[1]!.toLowerCase() + op.slice(2) : op;
		const escaped = raw.replace(/[\\%_]/g, "\\$&");
		const pattern =
			kind === "startsWith"
				? `${escaped}%`
				: kind === "endsWith"
					? `%${escaped}`
					: `%${escaped}%`;
		return insensitive || this.config.sql?.caseSensitive === false
			? this.caseInsensitiveLike(column, pattern)
			: like(column, pattern);
	}

	protected applyComplexFilter(
		conditions: any[],
		column: any,
		filterObj: any,
	): void {
		const coerce = (value: unknown) => this.coerceFilterValue(column, value);
		for (const [op, raw] of Object.entries(filterObj)) {
			// An absent operand (an empty query DTO field) adds nothing.
			if (raw === undefined) continue;
			// Guard the ordered-comparison ops against a non-finite numeric operand
			// (e.g. { gt: NaN } from an unguarded Number('abc') in a controller).
			// Letting NaN/Infinity reach SQL throws a raw DB error -> opaque 500;
			// reject it as a 400 instead. Non-number operands (dates/strings) pass.
			if (
				(op === "gt" || op === "gte" || op === "lt" || op === "lte") &&
				typeof raw === "number" &&
				!Number.isFinite(raw)
			) {
				throw new BadRequestException(
					`Invalid numeric filter operand for "${op}": ${raw}`,
				);
			}
			switch (op) {
				case "eq":
					conditions.push(eq(column, coerce(raw)));
					break;
				case "gt":
					conditions.push(gt(column, coerce(raw)));
					break;
				case "gte":
					conditions.push(gte(column, coerce(raw)));
					break;
				case "lt":
					conditions.push(lt(column, coerce(raw)));
					break;
				case "lte":
					conditions.push(lte(column, coerce(raw)));
					break;
				case "neq":
					conditions.push(ne(column, coerce(raw)));
					break;
				case "like":
					// Caller supplies the pattern (e.g. 'John%'); do not re-wrap.
					conditions.push(like(column, raw as string));
					break;
				case "ilike":
					conditions.push(this.caseInsensitiveLike(column, raw as string));
					break;
				case "in":
					conditions.push(
						inArray(column, this.expectArray(op, raw).map(coerce)),
					);
					break;
				case "notIn":
					conditions.push(
						notInArray(column, this.expectArray(op, raw).map(coerce)),
					);
					break;
				case "between": {
					const range = this.expectArray(op, raw);
					if (range.length !== 2) {
						throw new BadRequestException(
							'Filter operator "between" expects [from, to]',
						);
					}
					conditions.push(between(column, coerce(range[0]), coerce(range[1])));
					break;
				}
				case "isNull":
					conditions.push(
						this.parseFlag(op, raw) ? isNull(column) : isNotNull(column),
					);
					break;
				case "isNotNull":
					conditions.push(
						this.parseFlag(op, raw) ? isNotNull(column) : isNull(column),
					);
					break;
				case "startsWith":
				case "endsWith":
				case "contains":
				case "iStartsWith":
				case "iEndsWith":
				case "iContains":
					conditions.push(this.patternCondition(column, op, raw));
					break;
				case "arrayContains":
				case "arrayOverlaps": {
					this.requirePostgres(op);
					if (column?.dataType !== "array") {
						throw new BadRequestException(
							`Filter operator "${op}" only works on array columns`,
						);
					}
					const values = this.expectArray(op, raw);
					conditions.push(
						op === "arrayContains"
							? arrayContains(column, values)
							: arrayOverlaps(column, values),
					);
					break;
				}
				case "jsonContains":
					this.requirePostgres(op);
					if (column?.columnType !== "PgJsonb") {
						throw new BadRequestException(
							'Filter operator "jsonContains" only works on jsonb columns',
						);
					}
					conditions.push(sql`${column} @> ${JSON.stringify(raw)}::jsonb`);
					break;
				default:
					throw new BadRequestException(`Unknown filter operator: ${op}`);
			}
		}
	}

	protected async executeSqlTransaction<R>(
		operation: (tx: any) => Promise<R>,
		existingTransaction?: any,
	): Promise<R> {
		if (existingTransaction) return operation(existingTransaction);
		return this.config.db.transaction(operation);
	}

	protected getEntityName(): string {
		// Resolve the real table name from the Drizzle table metadata. Falls back
		// to "Entity" for plain-object tables (e.g. in tests) where the Drizzle
		// metadata symbols are absent.
		try {
			return getTableName(this.config.table) || "Entity";
		} catch {
			return "Entity";
		}
	}

	// SQL-Specific Enhancements
	async fullTextSearch(
		searchTerm: string,
		searchColumns: string[],
		pagination?: PaginationOptions,
		options?: SqlOperationOptions,
	): Promise<{ data: T[]; total: number; page: number; limit: number }> {
		if (this.config.dialect !== "postgresql") {
			throw new Error("Full-text search only supported in PostgreSQL");
		}

		if (!Array.isArray(searchColumns) || searchColumns.length === 0) {
			throw new BadRequestException(
				"Full-text search needs at least one column",
			);
		}
		const columns = searchColumns.map((name) => {
			const column = this.columnOf(this.config.table, name);
			if (!column) {
				throw new BadRequestException(`Unknown search column: ${name}`);
			}
			this.assertAllowed("searchableColumns", name, options);
			return column;
		});

		const { transaction } = options || {};
		const db = transaction || this.config.db;
		// Combine the per-column tsvectors into a single SQL expression. Using
		// sql.join keeps the column references as bound SQL chunks instead of
		// stringifying them (which Array#join + sql.raw did, producing invalid
		// SQL and an injection vector).
		const tsVector = sql.join(
			columns.map((column) => sql`to_tsvector('english', ${column})`),
			sql` || `,
		);
		const tsQuery = sql`plainto_tsquery('english', ${searchTerm})`;

		// Like find/findAll/count, exclude soft-deleted rows from search results.
		const matchExpr = sql`${tsVector} @@ ${tsQuery}`;
		const whereExpr = and(matchExpr, ...this.rowScope(options));

		// The page and limit always apply, with or without `pagination`, so the
		// envelope matches what came back. Ties on rank fall back to the primary
		// key, as in findAll.
		const { page, limit, offset } = this.resolvePagination(
			pagination?.page,
			pagination?.limit,
		);
		const pk = this.columnOf(this.config.table, this.config.primaryKey);
		const orderBy = [sql`ts_rank(${tsVector}, ${tsQuery}) DESC`];
		if (pk) orderBy.push(asc(pk));

		const dataQuery = db
			.select()
			.from(this.config.table)
			.where(whereExpr)
			.orderBy(...orderBy)
			.limit(limit)
			.offset(offset);
		const countQuery = db
			.select({ count: sql<number>`count(*)` })
			.from(this.config.table)
			.where(whereExpr);
		const [data, totalResult] = await this.runRead(
			Promise.all([dataQuery, countQuery]),
		);
		const total = parseInt(totalResult[0]?.count?.toString() || "0", 10);

		return { data, total, page, limit };
	}
}
