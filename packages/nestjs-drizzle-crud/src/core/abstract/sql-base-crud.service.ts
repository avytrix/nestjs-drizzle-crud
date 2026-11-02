// Drizzle imports
import {
	and,
	asc,
	desc,
	eq,
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
	or,
	sql,
} from "drizzle-orm";
import { BadRequestException } from "@nestjs/common";
import {
	BulkOperationException,
	DuplicateEntityException,
	EntityInUseException,
	EntityNotFoundException,
	ForeignKeyViolationException,
	ValidationFailedException,
} from "../../exceptions/crud.exceptions";
import type {
	ICrudService,
	PaginationOptions,
} from "../interfaces/crud-service.interface";
import type {
	RelationConfig,
	RelationNode,
	RelationsConfig,
	RelationType,
	SelectTree,
	SqlCrudConfig,
	SqlOperationOptions,
} from "../interfaces/sql-crud-config.interface";
import type { SortOrder } from "../types/sql.types";
import { isPlainObject, mergeCrudConfig } from "../utils/merge-config";

// Alias a many-to-many row carries its join-table key under while it is being
// grouped. Prefixed so it cannot collide with a real column name.
const JOIN_KEY = "__crudJoinKey";

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
	// A caller-supplied `sortBy` that isn't a real column is a client error and
	// fails fast (400) rather than silently returning unsorted data. An unknown
	// column inside the configured `defaultSort` is a developer/config mistake,
	// so it's warned and skipped (not surfaced to the client).
	// The primary key always comes last, so rows that tie on the sort columns
	// (or a query with no sort at all) still page in the same order every time.
	protected buildOrderBy(
		sortBy?: string,
		sortOrder: SortOrder = "desc",
	): any[] {
		const out = this.buildSortColumns(sortBy, sortOrder);
		const pk = this.columnOf(this.config.table, this.config.primaryKey);
		if (pk && !out.columns.includes(pk)) out.order.push(asc(pk));
		return out.order;
	}

	private buildSortColumns(
		sortBy?: string,
		sortOrder: SortOrder = "desc",
	): { order: any[]; columns: any[] } {
		if (sortBy) {
			const col = this.columnOf(this.config.table, sortBy);
			if (!col) {
				throw new BadRequestException(`Unknown sort column: ${sortBy}`);
			}
			// Fail fast on a bad sortOrder too (mirrors the unknown-column check);
			// otherwise anything other than "desc" silently sorted ascending.
			if (sortOrder !== "asc" && sortOrder !== "desc") {
				throw new BadRequestException(
					`Invalid sortOrder: ${sortOrder} (expected 'asc' or 'desc')`,
				);
			}
			return {
				order: [sortOrder === "desc" ? desc(col) : asc(col)],
				columns: [col],
			};
		}
		const order: any[] = [];
		const columns: any[] = [];
		for (const spec of this.config.defaultSort ?? []) {
			const col = this.columnOf(this.config.table, spec.column);
			if (!col) {
				console.warn(
					`[nestjs-drizzle-crud] defaultSort references unknown column "${spec.column}"; skipping.`,
				);
				continue;
			}
			order.push(spec.order === "desc" ? desc(col) : asc(col));
			columns.push(col);
		}
		return { order, columns };
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

	// The existence check that guards update / softDelete / delete only needs to
	// know whether the row is there, so it drops the caller's relations and
	// columns: joining or batch-loading children to throw them away would be an
	// extra query per write.
	private async findForGuard(
		id: any,
		options?: SqlOperationOptions,
	): Promise<T | null> {
		return this.find(id, {
			...options,
			relations: [],
			select: [this.config.primaryKey],
		});
	}

	// Single Operations
	async find(id: any, options?: SqlOperationOptions): Promise<T | null> {
		const { transaction, relations = [], select = [] } = options || {};
		const db = transaction || this.config.db;
		const nodes = this.relationTree(relations);
		const joined = this.planJoins(nodes);
		const selection = this.parseSelect(select);
		const baseSelect = this.withRequiredKeys(selection.base, nodes);

		const conditions = [eq(this.config.table[this.config.primaryKey], id)];
		if (this.config.softDelete?.enabled) {
			conditions.push(isNull(this.config.table[this.config.softDelete.column]));
		}

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
		await this.loadRelations(db, rows, nodes, selection);
		return rows[0] || null;
	}

	async findOne(
		where: Partial<T>,
		options?: SqlOperationOptions,
	): Promise<T | null> {
		const { transaction, relations = [], select = [] } = options || {};
		const db = transaction || this.config.db;
		const nodes = this.relationTree(relations);
		const joined = this.planJoins(nodes);
		const selection = this.parseSelect(select);
		const baseSelect = this.withRequiredKeys(selection.base, nodes);

		const conditions = this.buildWhereConditionsFromPartial(where);
		if (this.config.softDelete?.enabled) {
			conditions.push(isNull(this.config.table[this.config.softDelete.column]));
		}

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
		await this.loadRelations(db, rows, nodes, selection);
		return rows[0] || null;
	}

	async findAll(
		filters?: FilterDto,
		pagination?: PaginationOptions,
		options?: SqlOperationOptions,
	): Promise<{ data: T[]; total: number; page: number; limit: number }> {
		const { transaction, relations = [], select = [] } = options || {};
		const { sortBy, sortOrder = "desc" } = pagination || {};
		const {
			page,
			limit: safeLimit,
			offset,
		} = this.resolvePagination(pagination?.page, pagination?.limit);
		const db = transaction || this.config.db;
		const nodes = this.relationTree(relations);
		const joined = this.planJoins(nodes);
		const selection = this.parseSelect(select);
		const baseSelect = this.withRequiredKeys(selection.base, nodes);

		const { conditions, relations: filterRelations } =
			this.buildFilterConditions(filters, db);
		const searchCondition = this.buildSearchCondition(options?.search);
		if (searchCondition) {
			conditions.push(searchCondition);
		}
		if (this.config.softDelete?.enabled) {
			conditions.push(isNull(this.config.table[this.config.softDelete.column]));
		}

		// Join everything needed for eager-loading and for relation filters.
		const joinRelations = Array.from(
			new Set([...joined.map((node) => node.name), ...filterRelations]),
		);

		let dataQuery = this.startSelect(
			db,
			baseSelect,
			joined,
			joinRelations.length > 0,
			selection,
		);
		dataQuery = this.applyJoins(dataQuery, joinRelations);
		if (conditions.length > 0) {
			dataQuery = dataQuery.where(and(...conditions));
		}
		const orderBy = this.buildOrderBy(sortBy, sortOrder);
		if (orderBy.length > 0) {
			dataQuery = dataQuery.orderBy(...orderBy);
		}
		dataQuery = dataQuery.limit(safeLimit).offset(offset);
		dataQuery = this.applyLock(dataQuery, options);

		let countQuery = db
			.select({ count: sql<number>`count(*)` })
			.from(this.config.table);
		// Count only needs the relations used for filtering, not eager loads.
		countQuery = this.applyJoins(countQuery, filterRelations);
		if (conditions.length > 0) {
			countQuery = countQuery.where(and(...conditions));
		}

		const [data, totalResult] = await this.runRead(
			Promise.all([dataQuery, countQuery]),
		);
		const total = parseInt(totalResult[0]?.count?.toString() || "0", 10);

		// One batched query per relation for the whole page, never one per row.
		const rows = this.normalizeRelations(
			data,
			joined.map((node) => node.name),
		);
		await this.loadRelations(db, rows, nodes, selection);

		return {
			data: rows,
			total,
			page,
			limit: safeLimit,
		};
	}

	async create(data: CreateDto, options?: SqlOperationOptions): Promise<T> {
		const { transaction, hooks = {} } = options || {};
		await this.validateCreate(data);
		const processedData = hooks.skipBefore
			? data
			: await this.beforeCreate(data);
		const entityData = this.mapCreateDtoToEntity(processedData);

		const now = new Date();
		if (this.config.timestamps?.createdAt)
			entityData[this.config.timestamps.createdAt] = now;
		if (this.config.timestamps?.updatedAt)
			entityData[this.config.timestamps.updatedAt] = now;

		const db = transaction || this.config.db;
		let insertQuery = db.insert(this.config.table).values(entityData);

		try {
			if (this.config.sql?.useReturning) {
				insertQuery = insertQuery.returning();
				const result = await insertQuery;
				const createdEntity = result[0];
				if (!hooks.skipAfter) await this.afterCreate(createdEntity);
				return createdEntity;
			} else {
				const result = await insertQuery;
				// Without RETURNING (e.g. MySQL): prefer a client-supplied primary key
				// (required for uuid / non-auto-increment keys), otherwise fall back
				// to the driver's auto-increment insertId.
				const lastInsertId =
					entityData[this.config.primaryKey] ?? result?.[0]?.insertId;
				const createdEntity = await this.find(lastInsertId, options);
				if (!createdEntity) throw new Error("Failed to create entity");
				if (!hooks.skipAfter) await this.afterCreate(createdEntity);
				return createdEntity;
			}
		} catch (error) {
			// Unique violation -> 409, bad input (too long, failed check, wrong
			// type) -> 400, a reference to a row that does not exist -> 400.
			throw this.toClientError(error, "write");
		}
	}

	async update(
		id: any,
		data: UpdateDto,
		options?: SqlOperationOptions,
	): Promise<T> {
		const { transaction, hooks = {} } = options || {};
		const existing = await this.findForGuard(id, options);
		if (!existing) throw new EntityNotFoundException(this.getEntityName(), id);

		await this.validateUpdate(id, data);
		const processedData = hooks.skipBefore
			? data
			: await this.beforeUpdate(id, data);
		const entityData = this.mapUpdateDtoToEntity(processedData);

		// Drizzle skips undefined values and keys that are not columns, so an
		// update with none left would send an empty SET (a raw 500). With
		// timestamps on it would quietly bump updated_at instead. Either way the
		// caller sent nothing to change, which is a 400.
		const settable = Object.keys(entityData).filter(
			(key) =>
				entityData[key] !== undefined &&
				!!this.columnOf(this.config.table, key),
		);
		if (settable.length === 0) {
			throw new ValidationFailedException("there are no columns to update");
		}

		if (this.config.timestamps?.updatedAt) {
			entityData[this.config.timestamps.updatedAt] = new Date();
		}

		const db = transaction || this.config.db;
		let updateQuery = db
			.update(this.config.table)
			.set(entityData)
			.where(eq(this.config.table[this.config.primaryKey], id));

		try {
			if (this.config.sql?.useReturning) {
				updateQuery = updateQuery.returning();
				const result = await updateQuery;
				const updatedEntity = result[0];
				if (!hooks.skipAfter) await this.afterUpdate(updatedEntity);
				return updatedEntity;
			} else {
				await updateQuery;
				const updatedEntity = await this.find(id, options);
				if (!updatedEntity) throw new Error("Failed to update entity");
				if (!hooks.skipAfter) await this.afterUpdate(updatedEntity);
				return updatedEntity;
			}
		} catch (error) {
			throw this.toClientError(error, "write");
		}
	}

	async softDelete(id: any, options?: SqlOperationOptions): Promise<boolean> {
		if (!this.config.softDelete?.enabled) {
			throw new Error("Soft delete is not enabled for this entity");
		}

		const { transaction, hooks = {} } = options || {};
		const existing = await this.findForGuard(id, options);
		if (!existing) throw new EntityNotFoundException(this.getEntityName(), id);

		if (!hooks.skipBefore) await this.beforeSoftDelete(id);

		const db = transaction || this.config.db;
		const updateData = {
			[this.config.softDelete.column]: new Date(),
			...(this.config.timestamps?.updatedAt && {
				[this.config.timestamps.updatedAt]: new Date(),
			}),
		};

		let updateQuery = db
			.update(this.config.table)
			.set(updateData)
			.where(eq(this.config.table[this.config.primaryKey], id));

		if (this.config.sql?.useReturning) updateQuery = updateQuery.returning();
		const result = await this.runRead(updateQuery);
		const success = this.wasAffected(result);

		if (success && !hooks.skipAfter) await this.afterSoftDelete(id);
		return success;
	}

	async restore(id: any, options?: SqlOperationOptions): Promise<T> {
		if (!this.config.softDelete?.enabled) {
			throw new Error("Soft delete is not enabled for this entity");
		}

		const { transaction, hooks = {} } = options || {};
		if (!hooks.skipBefore) await this.beforeRestore(id);

		const db = transaction || this.config.db;
		const updateData = {
			[this.config.softDelete!.column]: null,
			...(this.config.timestamps?.updatedAt && {
				[this.config.timestamps.updatedAt]: new Date(),
			}),
		};

		let updateQuery = db
			.update(this.config.table)
			.set(updateData)
			.where(eq(this.config.table[this.config.primaryKey], id));

		if (this.config.sql?.useReturning) {
			updateQuery = updateQuery.returning();
			const result: any[] = await this.runRead(updateQuery);
			if (result.length === 0)
				throw new EntityNotFoundException(this.getEntityName(), id);
			const restoredEntity = result[0];
			if (!hooks.skipAfter) await this.afterRestore(restoredEntity);
			return restoredEntity;
		} else {
			await this.runRead(updateQuery);
			const restoredEntity = await this.find(id, options);
			if (!restoredEntity)
				throw new EntityNotFoundException(this.getEntityName(), id);
			if (!hooks.skipAfter) await this.afterRestore(restoredEntity);
			return restoredEntity;
		}
	}

	async delete(id: any, options?: SqlOperationOptions): Promise<boolean> {
		const { transaction, hooks = {} } = options || {};
		const existing = await this.findForGuard(id, options);
		if (!existing) throw new EntityNotFoundException(this.getEntityName(), id);

		if (!hooks.skipBefore) await this.beforeDelete(id);

		const db = transaction || this.config.db;
		const deleteQuery = db
			.delete(this.config.table)
			.where(eq(this.config.table[this.config.primaryKey], id));

		try {
			const result = await deleteQuery;
			const success = this.wasAffected(result);

			if (success && !hooks.skipAfter) await this.afterDelete(id);
			return success;
		} catch (error) {
			// Dependent rows still reference this one (ON DELETE RESTRICT /
			// NO ACTION), which is a conflict, not a server fault -> 409.
			throw this.toClientError(error, "delete");
		}
	}

	// Bulk Operations
	async massCreate(
		data: CreateDto[],
		options?: SqlOperationOptions,
	): Promise<T[]> {
		return this.executeSqlTransaction(async (tx) => {
			const results: T[] = [];
			const errors: Array<{ index: number; error: Error }> = [];

			for (let i = 0; i < data.length; i++) {
				try {
					const result = await this.savepoint(tx, (sp) =>
						this.create(data[i], { ...options, transaction: sp }),
					);
					results.push(result);
				} catch (error) {
					errors.push({ index: i, error: error as Error });
				}
			}

			if (errors.length > 0)
				throw new BulkOperationException("Mass create errors", errors);
			return results;
		}, options?.transaction);
	}

	async massUpdate(
		ids: any[],
		data: UpdateDto,
		options?: SqlOperationOptions,
	): Promise<T[]> {
		return this.executeSqlTransaction(async (tx) => {
			const results: T[] = [];
			const errors: Array<{ id: any; error: Error }> = [];

			for (const id of ids) {
				try {
					const result = await this.savepoint(tx, (sp) =>
						this.update(id, data, { ...options, transaction: sp }),
					);
					results.push(result);
				} catch (error) {
					errors.push({ id, error: error as Error });
				}
			}

			if (errors.length > 0)
				throw new BulkOperationException("Mass update errors", errors);
			return results;
		}, options?.transaction);
	}

	async massSoftDelete(
		ids: any[],
		options?: SqlOperationOptions,
	): Promise<boolean> {
		if (!this.config.softDelete?.enabled)
			throw new Error("Soft delete not enabled");
		return this.executeSqlTransaction(async (tx) => {
			const errors: Array<{ id: any; error: Error }> = [];
			for (const id of ids) {
				try {
					await this.savepoint(tx, (sp) =>
						this.softDelete(id, { ...options, transaction: sp }),
					);
				} catch (error) {
					errors.push({ id, error: error as Error });
				}
			}
			if (errors.length > 0)
				throw new BulkOperationException("Mass soft delete errors", errors);
			return true;
		}, options?.transaction);
	}

	async massRestore(ids: any[], options?: SqlOperationOptions): Promise<T[]> {
		if (!this.config.softDelete?.enabled)
			throw new Error("Soft delete not enabled");
		return this.executeSqlTransaction(async (tx) => {
			const results: T[] = [];
			const errors: Array<{ id: any; error: Error }> = [];
			for (const id of ids) {
				try {
					const result = await this.savepoint(tx, (sp) =>
						this.restore(id, { ...options, transaction: sp }),
					);
					results.push(result);
				} catch (error) {
					errors.push({ id, error: error as Error });
				}
			}
			if (errors.length > 0)
				throw new BulkOperationException("Mass restore errors", errors);
			return results;
		}, options?.transaction);
	}

	async massDelete(
		ids: any[],
		options?: SqlOperationOptions,
	): Promise<boolean> {
		return this.executeSqlTransaction(async (tx) => {
			const errors: Array<{ id: any; error: Error }> = [];
			for (const id of ids) {
				try {
					await this.savepoint(tx, (sp) =>
						this.delete(id, { ...options, transaction: sp }),
					);
				} catch (error) {
					errors.push({ id, error: error as Error });
				}
			}
			if (errors.length > 0)
				throw new BulkOperationException("Mass delete errors", errors);
			return true;
		}, options?.transaction);
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
		const { transaction } = options || {};
		const db = transaction || this.config.db;
		let query = db
			.select({ count: sql<number>`count(*)` })
			.from(this.config.table);
		const { conditions, relations: filterRelations } =
			this.buildFilterConditions(filters, db);
		const searchCondition = this.buildSearchCondition(options?.search);
		if (searchCondition) {
			conditions.push(searchCondition);
		}

		if (this.config.softDelete?.enabled) {
			conditions.push(isNull(this.config.table[this.config.softDelete.column]));
		}

		query = this.applyJoins(query, filterRelations);
		if (conditions.length > 0) query = query.where(and(...conditions));
		const result = await this.runRead<any[]>(query);
		return parseInt(result[0]?.count?.toString() || "0", 10);
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
	): any | undefined {
		const target = relation.table;
		const manyToMany = this.relationType(relation) === "manyToMany";
		const joinLocal = manyToMany
			? relation.through?.[relation.throughLocalKey ?? ""]
			: undefined;
		const key = manyToMany ? joinLocal : target[relation.foreignKey ?? ""];
		if (!key) return undefined;

		const targetConditions: any[] = [];
		for (const [col, colValue] of Object.entries(value)) {
			if (colValue === undefined || colValue === null) continue;
			const column = this.columnOf(target, col);
			if (!column) {
				throw new BadRequestException(`Unknown filter column: ${name}.${col}`);
			}
			this.pushColumnCondition(targetConditions, column, colValue);
		}
		if (targetConditions.length === 0) return undefined;

		const softDeleted = this.softDeleteCondition(target);
		if (softDeleted) targetConditions.push(softDeleted);

		let subquery: any;
		if (manyToMany) {
			const referenced = target[relation.references ?? "id"];
			const joinForeign = relation.through?.[relation.throughForeignKey ?? ""];
			if (!referenced || !joinForeign) return undefined;
			subquery = db
				.select({ value: key })
				.from(relation.through)
				.innerJoin(target, eq(joinForeign, referenced))
				.where(and(...targetConditions));
		} else {
			subquery = db
				.select({ value: key })
				.from(target)
				.where(and(...targetConditions));
		}
		const parentKey = this.parentKeyOf(relation);
		return inArray(this.config.table[parentKey], subquery);
	}

	// Build WHERE conditions from a filter object. A key matching a configured
	// relation, with an object value, filters by the related table's columns
	// (e.g. { state: { name: 'X', country_id: 1 } }). A belongs-to relation is
	// returned in `relations` so the caller can JOIN it; a collection relation
	// becomes a subquery condition and needs no join.
	// `undefined` and `null` values are skipped, so a query DTO can be passed
	// through with its empty fields. A key that is neither a column nor a
	// relation is a 400, like an unknown sortBy: dropping it would return every
	// row for a typo.
	protected buildFilterConditions(
		filters?: any,
		db: any = this.config.db,
	): {
		conditions: any[];
		relations: string[];
	} {
		const conditions: any[] = [];
		const relations: string[] = [];
		if (!filters) return { conditions, relations };

		const relConfig = this.config.relations || {};

		for (const [key, value] of Object.entries(filters)) {
			if (value === undefined || value === null) continue;

			const relation = Object.hasOwn(relConfig, key)
				? relConfig[key]
				: undefined;
			if (relation) {
				if (!isPlainObject(value)) {
					throw new BadRequestException(
						`Filter on relation "${key}" must be an object of column filters`,
					);
				}
				if (this.isCollection(relation)) {
					const condition = this.buildCollectionFilter(
						relation,
						value,
						db,
						key,
					);
					if (condition) conditions.push(condition);
					continue;
				}
				let used = false;
				for (const [col, colValue] of Object.entries(value)) {
					if (colValue === undefined || colValue === null) continue;
					const relColumn = this.columnOf(relation.table, col);
					if (!relColumn) {
						throw new BadRequestException(
							`Unknown filter column: ${key}.${col}`,
						);
					}
					this.pushColumnCondition(conditions, relColumn, colValue);
					used = true;
				}
				if (used) relations.push(key);
				continue;
			}

			const column = this.columnOf(this.config.table, key);
			if (!column) {
				throw new BadRequestException(`Unknown filter column: ${key}`);
			}
			this.pushColumnCondition(conditions, column, value);
		}

		return { conditions, relations };
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

	protected applyComplexFilter(
		conditions: any[],
		column: any,
		filterObj: any,
	): void {
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
					conditions.push(eq(column, this.coerceFilterValue(column, raw)));
					break;
				case "gt":
					conditions.push(gt(column, this.coerceFilterValue(column, raw)));
					break;
				case "gte":
					conditions.push(gte(column, this.coerceFilterValue(column, raw)));
					break;
				case "lt":
					conditions.push(lt(column, this.coerceFilterValue(column, raw)));
					break;
				case "lte":
					conditions.push(lte(column, this.coerceFilterValue(column, raw)));
					break;
				case "neq":
					conditions.push(ne(column, this.coerceFilterValue(column, raw)));
					break;
				case "like":
					// Caller supplies the pattern (e.g. 'John%'); do not re-wrap.
					conditions.push(like(column, raw as string));
					break;
				case "ilike":
					conditions.push(this.caseInsensitiveLike(column, raw as string));
					break;
				case "in":
					if (!Array.isArray(raw)) {
						throw new BadRequestException(
							`Filter operator "in" expects an array`,
						);
					}
					conditions.push(
						inArray(
							column,
							raw.map((item) => this.coerceFilterValue(column, item)),
						),
					);
					break;
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
		const whereExpr = this.config.softDelete?.enabled
			? and(matchExpr, isNull(this.config.table[this.config.softDelete.column]))
			: matchExpr;

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
