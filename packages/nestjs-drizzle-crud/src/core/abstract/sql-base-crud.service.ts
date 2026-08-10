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
	RelationType,
	SqlCrudConfig,
	SqlOperationOptions,
} from "../interfaces/sql-crud-config.interface";
import type { SortOrder } from "../types/sql.types";

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

	protected buildWhereConditionsFromPartial(where: Partial<T>): any[] {
		if (!where) return [];

		const conditions: any[] = [];

		for (const [key, value] of Object.entries(where)) {
			if (value === undefined || value === null) continue;

			const column = this.config.table[key];
			if (!column) continue;

			// For Partial<T>, we only support simple equality checks
			conditions.push(eq(column, value));
		}

		return conditions;
	}
	constructor(protected readonly config: SqlCrudConfig) {
		this.config = { ...this.defaultConfig, ...config };
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

		// A relation missing its key column would silently produce no join and no
		// children, which reads as "the data is wrong". Fail at startup instead.
		for (const [name, relation] of Object.entries(
			this.config.relations || {},
		)) {
			if (!relation?.table) {
				throw new Error(`Relation "${name}" is missing its table`);
			}
			if (this.relationType(relation) === "hasMany") {
				if (!relation.foreignKey) {
					throw new Error(
						`Relation "${name}" is hasMany and requires a foreignKey (the column on the related table pointing back here)`,
					);
				}
			} else if (!relation.localKey) {
				throw new Error(
					`Relation "${name}" is belongsTo and requires a localKey (the foreign-key column on this table)`,
				);
			}
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
		return relation.type === "hasMany" ? "hasMany" : "belongsTo";
	}

	// Keep only the requested relation names that are actually configured.
	protected eagerRelations(relations: string[]): string[] {
		const configured = this.config.relations || {};
		return (relations || []).filter((name) => !!configured[name]);
	}

	// Split requested relations by how they are loaded: belongs-to relations join
	// the main query, has-many relations are batch-loaded after it.
	protected splitRelations(relations: string[]): {
		belongsTo: string[];
		hasMany: string[];
	} {
		const configured = this.config.relations || {};
		const belongsTo: string[] = [];
		const hasMany: string[] = [];
		for (const name of this.eagerRelations(relations)) {
			if (this.relationType(configured[name]!) === "hasMany")
				hasMany.push(name);
			else belongsTo.push(name);
		}
		return { belongsTo, hasMany };
	}

	// Split a `select` list into this table's columns and per-relation columns:
	//   ["id", "name", "region.code"] -> { base: ["id","name"], nested: { region: ["code"] } }
	// An empty `base` means "all columns of this table", so selecting only
	// relation columns still returns the full parent row.
	protected parseSelect(select?: string[]): {
		base: string[];
		nested: Record<string, string[]>;
	} {
		const base: string[] = [];
		const nested: Record<string, string[]> = {};
		for (const entry of select || []) {
			const dot = entry.indexOf(".");
			if (dot < 1) {
				base.push(entry);
				continue;
			}
			const relation = entry.slice(0, dot);
			const column = entry.slice(dot + 1);
			if (!column) continue;
			if (!nested[relation]) nested[relation] = [];
			nested[relation].push(column);
		}
		return { base, nested };
	}

	// Grouping a has-many result back onto its parents needs the parent key in
	// the row, so add it when the caller narrowed the base columns.
	protected withParentKeys(base: string[], hasMany: string[]): string[] {
		if (base.length === 0 || hasMany.length === 0) return base;
		const configured = this.config.relations || {};
		const keys = hasMany.map(
			(name) => configured[name]?.parentKey ?? this.config.primaryKey,
		);
		return Array.from(new Set([...base, ...keys]));
	}

	// Build the SELECT projection: base columns (optionally narrowed by
	// `select`) plus a nested object of columns for each joined relation.
	protected buildSelection(
		select: string[],
		eager: string[],
		nested: Record<string, string[]> = {},
	): Record<string, any> {
		const allColumns = getTableColumns(this.config.table);
		let base: Record<string, any>;
		if (select && select.length > 0) {
			base = {};
			for (const field of select) {
				if (allColumns[field]) base[field] = allColumns[field];
			}
		} else {
			base = { ...allColumns };
		}
		const configured = this.config.relations || {};
		for (const name of eager) {
			const rel = configured[name];
			if (!rel) continue;
			const relColumns = getTableColumns(rel.table);
			const wanted = nested[name];
			if (wanted?.length) {
				const picked: Record<string, any> = {};
				for (const col of wanted) {
					if (relColumns[col]) picked[col] = relColumns[col];
				}
				base[name] = Object.keys(picked).length > 0 ? picked : relColumns;
			} else {
				base[name] = relColumns;
			}
		}
		return base;
	}

	// Start a SELECT with the right projection. An explicit projection is needed
	// whenever a JOIN is applied (eager load OR relation filter), otherwise a
	// plain `select()` + join makes Drizzle nest rows per table
	// ({ table: {...}, joined: {...} }). When there are no joins this matches the
	// original all-columns / partial-select behaviour.
	protected startSelect(
		db: any,
		select: string[],
		eager: string[],
		hasJoins = false,
		nested: Record<string, string[]> = {},
	): any {
		if (eager.length > 0 || hasJoins) {
			return db
				.select(this.buildSelection(select, eager, nested))
				.from(this.config.table);
		}
		const fields = this.buildSelectFields(select);
		return fields
			? db.select(fields).from(this.config.table)
			: db.select().from(this.config.table);
	}

	// Eager-load has-many relations for rows that have already been fetched.
	//
	// This is the N+1 fix: each relation costs exactly ONE extra query
	// (`WHERE fk IN (parent ids)`) no matter how many parent rows there are, and
	// the relations run concurrently. The rows are mutated in place, with `[]`
	// for a parent that has no children.
	protected async loadHasMany(
		db: any,
		rows: any[],
		names: string[],
		nested: Record<string, string[]> = {},
	): Promise<void> {
		if (!names.length || !Array.isArray(rows) || rows.length === 0) return;
		const configured = this.config.relations || {};

		await Promise.all(
			names.map(async (name) => {
				const rel = configured[name];
				if (!rel?.foreignKey) return;
				const child = rel.table;
				const fkColumn = child[rel.foreignKey];
				if (!fkColumn) return;
				const parentKey = rel.parentKey ?? this.config.primaryKey;

				const ids = Array.from(
					new Set(rows.map((row) => row?.[parentKey]).filter((v) => v != null)),
				);
				if (ids.length === 0) {
					for (const row of rows) if (row) row[name] = [];
					return;
				}

				// Narrow the child columns when asked, always keeping the foreign key:
				// it is what maps each child back to its parent.
				const wanted = nested[name];
				let fields: Record<string, any> | undefined;
				if (wanted?.length) {
					fields = {};
					for (const col of wanted) {
						if (child[col]) fields[col] = child[col];
					}
					fields[rel.foreignKey] = fkColumn;
				}

				const conditions = [inArray(fkColumn, ids)];
				// Honour soft delete on the child too, but only when the child table
				// actually has the configured column (siblings often differ).
				const softDelete = this.config.softDelete;
				if (softDelete?.enabled && child[softDelete.column]) {
					conditions.push(isNull(child[softDelete.column]));
				}

				const childRows = await (fields ? db.select(fields) : db.select())
					.from(child)
					.where(and(...conditions));

				// Group by the raw foreign-key value. Keys are scalars (int / uuid /
				// text), so strict-equality Map lookup is the right match here.
				const grouped = new Map<any, any[]>();
				for (const childRow of childRows ?? []) {
					const key = childRow?.[rel.foreignKey];
					const bucket = grouped.get(key);
					if (bucket) bucket.push(childRow);
					else grouped.set(key, [childRow]);
				}
				for (const row of rows) {
					if (row) row[name] = grouped.get(row[parentKey]) ?? [];
				}
			}),
		);
	}

	// LEFT JOIN each named belongs-to relation onto the query. Has-many relations
	// are never joined: one parent row would become one row per child, which
	// breaks `total` and pagination. They are loaded by loadHasMany instead.
	protected applyJoins(query: any, relationNames: string[]): any {
		const configured = this.config.relations || {};
		let q = query;
		for (const name of relationNames) {
			const rel = configured[name];
			if (!rel?.localKey || this.relationType(rel) === "hasMany") continue;
			q = q.leftJoin(
				rel.table,
				eq(this.config.table[rel.localKey], rel.table[rel.references ?? "id"]),
			);
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
	protected buildOrderBy(
		sortBy?: string,
		sortOrder: SortOrder = "desc",
	): any[] {
		if (sortBy) {
			const col = this.config.table[sortBy];
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
			return [sortOrder === "desc" ? desc(col) : asc(col)];
		}
		const out: any[] = [];
		for (const spec of this.config.defaultSort ?? []) {
			const col = this.config.table[spec.column];
			if (!col) {
				console.warn(
					`[nestjs-drizzle-crud] defaultSort references unknown column "${spec.column}"; skipping.`,
				);
				continue;
			}
			out.push(spec.order === "desc" ? desc(col) : asc(col));
		}
		return out;
	}

	// Clamp pagination input to safe bounds: page >= 1 and 1 <= limit <= maxLimit.
	// Shared by findAll and fullTextSearch so bad input (page<1, limit<=0,
	// limit>maxLimit) can never produce a negative OFFSET or a LIMIT 0 / LIMIT -n.
	protected resolvePagination(
		page?: number,
		limit?: number,
	): { page: number; limit: number; offset: number } {
		const maxLimit = this.config.pagination!.maxLimit!;
		const defaultLimit = this.config.pagination!.defaultLimit!;
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
	// range (22003). These otherwise surface as a raw 500; map them to 400 so the
	// caller sees a client error (mirrors the unique-violation -> 409 mapping).
	// (NOT-NULL violations are intentionally left to bubble: they usually
	// indicate a programming/config error, not a recoverable bad value. FK
	// violations are handled separately below.)
	protected isDataException(error: any): boolean {
		const code = error?.code ?? error?.cause?.code;
		return code === "22001" || code === "23514" || code === "22003";
	}

	protected toDataException(error: any): ValidationFailedException {
		const code = error?.code ?? error?.cause?.code;
		const messages: Record<string, string> = {
			"22001": "a value is too long for its column",
			"23514": "a value violates a column check constraint",
			"22003": "a numeric value is out of range",
		};
		return new ValidationFailedException(messages[code] ?? "invalid value");
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
		if (options?.forNoKeyUpdate) return query.for("no key update");
		if (options?.lock && options.lock !== "none")
			return query.for(options.lock);
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
		const conditions = columns.map((column) => ilike(column, pattern));
		return conditions.length === 1 ? conditions[0] : or(...conditions);
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
		const { belongsTo, hasMany } = this.splitRelations(relations);
		const { base, nested } = this.parseSelect(select);
		const baseSelect = this.withParentKeys(base, hasMany);

		const conditions = [eq(this.config.table[this.config.primaryKey], id)];
		if (this.config.softDelete?.enabled) {
			conditions.push(isNull(this.config.table[this.config.softDelete.column]));
		}

		let query = this.startSelect(db, baseSelect, belongsTo, false, nested);
		query = this.applyJoins(query, belongsTo)
			.where(and(...conditions))
			.limit(1);
		query = this.applyLock(query, options);

		const result = await query;
		const rows = this.normalizeRelations(result, belongsTo);
		await this.loadHasMany(db, rows, hasMany, nested);
		return rows[0] || null;
	}

	async findOne(
		where: Partial<T>,
		options?: SqlOperationOptions,
	): Promise<T | null> {
		const { transaction, relations = [], select = [] } = options || {};
		const db = transaction || this.config.db;
		const { belongsTo, hasMany } = this.splitRelations(relations);
		const { base, nested } = this.parseSelect(select);
		const baseSelect = this.withParentKeys(base, hasMany);

		const conditions = this.buildWhereConditionsFromPartial(where);
		if (this.config.softDelete?.enabled) {
			conditions.push(isNull(this.config.table[this.config.softDelete.column]));
		}

		let query = this.startSelect(db, baseSelect, belongsTo, false, nested);
		query = this.applyJoins(query, belongsTo)
			.where(and(...conditions))
			.limit(1);
		query = this.applyLock(query, options);

		const result = await query;
		const rows = this.normalizeRelations(result, belongsTo);
		await this.loadHasMany(db, rows, hasMany, nested);
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
		const { belongsTo, hasMany } = this.splitRelations(relations);
		const { base, nested } = this.parseSelect(select);
		const baseSelect = this.withParentKeys(base, hasMany);

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
			new Set([...belongsTo, ...filterRelations]),
		);

		let dataQuery = this.startSelect(
			db,
			baseSelect,
			belongsTo,
			joinRelations.length > 0,
			nested,
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

		const [data, totalResult] = await Promise.all([dataQuery, countQuery]);
		const total = parseInt(totalResult[0]?.count?.toString() || "0", 10);

		// One batched query per has-many relation for the whole page, never one
		// per row.
		const rows = this.normalizeRelations(data, belongsTo);
		await this.loadHasMany(db, rows, hasMany, nested);

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
			// Surface a unique violation as 409 Conflict instead of a raw 500.
			if (this.isUniqueViolation(error)) throw this.toDuplicateException(error);
			// Bad client input (too long / failed check / out of range) -> 400.
			if (this.isDataException(error)) throw this.toDataException(error);
			// A reference to a row that does not exist is bad input too -> 400.
			if (this.isForeignKeyViolation(error))
				throw this.toForeignKeyException(error);
			throw error;
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
			if (this.isUniqueViolation(error)) throw this.toDuplicateException(error);
			if (this.isDataException(error)) throw this.toDataException(error);
			if (this.isForeignKeyViolation(error))
				throw this.toForeignKeyException(error);
			throw error;
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
		const result = await updateQuery;
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
			const result = await updateQuery;
			if (result.length === 0)
				throw new EntityNotFoundException(this.getEntityName(), id);
			const restoredEntity = result[0];
			if (!hooks.skipAfter) await this.afterRestore(restoredEntity);
			return restoredEntity;
		} else {
			await updateQuery;
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
			if (this.isForeignKeyViolation(error))
				throw new EntityInUseException(this.getEntityName());
			throw error;
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
					const result = await this.create(data[i], {
						...options,
						transaction: tx,
					});
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
					const result = await this.update(id, data, {
						...options,
						transaction: tx,
					});
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
					await this.softDelete(id, { ...options, transaction: tx });
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
					const result = await this.restore(id, {
						...options,
						transaction: tx,
					});
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
					await this.delete(id, { ...options, transaction: tx });
				} catch (error) {
					errors.push({ id, error: error as Error });
				}
			}
			if (errors.length > 0)
				throw new BulkOperationException("Mass delete errors", errors);
			return true;
		}, options?.transaction);
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
		const result = await query;
		return parseInt(result[0]?.count?.toString() || "0", 10);
	}

	// Protected Helper Methods

	// Build a single column condition from a filter value:
	//   array            -> IN (...)
	//   string           -> case-insensitive exact match (when sql.caseSensitive
	//                        is false) or eq
	//   { op: value, ... } -> comparison/pattern operators (see applyComplexFilter)
	//   scalar           -> eq
	protected pushColumnCondition(
		conditions: any[],
		column: any,
		value: any,
	): void {
		if (Array.isArray(value)) {
			conditions.push(inArray(column, value));
		} else if (
			typeof value === "string" &&
			this.config.sql?.caseSensitive === false
		) {
			// Case-insensitive *exact* match. Compare `lower(column) = lower(value)`
			// rather than `ilike(column, value)`: ILIKE treats `%`, `_` and `\` in
			// the value as wildcards/escapes, which silently turns an equality
			// filter into a pattern match (returning rows that don't actually
			// equal the value). Use the explicit `{ like: ... }` / `{ ilike: ... }`
			// operators when pattern matching is intended.
			conditions.push(sql`lower(${column}) = lower(${value})`);
		} else if (typeof value === "object" && value !== null) {
			this.applyComplexFilter(conditions, column, value);
		} else {
			conditions.push(eq(column, value));
		}
	}

	// Filter by a has-many relation: keep the parents that have at least one
	// matching child. Built as `parentKey IN (SELECT fk FROM child WHERE ...)`
	// rather than a JOIN, so parent rows are never duplicated and `total` and
	// pagination stay correct. Returns undefined when nothing usable was given.
	protected buildHasManyFilter(
		relation: RelationConfig,
		value: Record<string, any>,
		db: any = this.config.db,
	): any | undefined {
		if (!relation.foreignKey) return undefined;
		const child = relation.table;
		const fkColumn = child[relation.foreignKey];
		if (!fkColumn) return undefined;

		const childConditions: any[] = [];
		for (const [col, colValue] of Object.entries(value)) {
			if (colValue === undefined || colValue === null) continue;
			const column = child[col];
			if (!column) continue;
			this.pushColumnCondition(childConditions, column, colValue);
		}
		if (childConditions.length === 0) return undefined;

		const softDelete = this.config.softDelete;
		if (softDelete?.enabled && child[softDelete.column]) {
			childConditions.push(isNull(child[softDelete.column]));
		}

		const subquery = db
			.select({ value: fkColumn })
			.from(child)
			.where(and(...childConditions));
		const parentKey = relation.parentKey ?? this.config.primaryKey;
		return inArray(this.config.table[parentKey], subquery);
	}

	// Build WHERE conditions from a filter object. A key matching a configured
	// relation, with an object value, filters by the related table's columns
	// (e.g. { state: { name: 'X', country_id: 1 } }). A belongs-to relation is
	// returned in `relations` so the caller can JOIN it; a has-many relation
	// becomes a subquery condition and needs no join.
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

			const relation = relConfig[key];
			if (relation && typeof value === "object" && !Array.isArray(value)) {
				if (this.relationType(relation) === "hasMany") {
					const condition = this.buildHasManyFilter(
						relation,
						value as Record<string, any>,
						db,
					);
					if (condition) conditions.push(condition);
					continue;
				}
				let used = false;
				for (const [col, colValue] of Object.entries(value)) {
					if (colValue === undefined || colValue === null) continue;
					const relColumn = relation.table[col];
					if (!relColumn) continue;
					this.pushColumnCondition(conditions, relColumn, colValue);
					used = true;
				}
				if (used) relations.push(key);
				continue;
			}

			const column = this.config.table[key];
			if (!column) continue;
			this.pushColumnCondition(conditions, column, value);
		}

		return { conditions, relations };
	}

	protected buildWhereConditions(filters?: any): any[] {
		return this.buildFilterConditions(filters).conditions;
	}

	protected applyComplexFilter(
		conditions: any[],
		column: any,
		filterObj: any,
	): void {
		for (const [op, value] of Object.entries(filterObj)) {
			// Guard the ordered-comparison ops against a non-finite numeric operand
			// (e.g. { gt: NaN } from an unguarded Number('abc') in a controller).
			// Letting NaN/Infinity reach SQL throws a raw DB error -> opaque 500;
			// reject it as a 400 instead. Non-number operands (dates/strings) pass.
			if (
				(op === "gt" || op === "gte" || op === "lt" || op === "lte") &&
				typeof value === "number" &&
				!Number.isFinite(value)
			) {
				throw new BadRequestException(
					`Invalid numeric filter operand for "${op}": ${value}`,
				);
			}
			switch (op) {
				case "gt":
					conditions.push(gt(column, value));
					break;
				case "gte":
					conditions.push(gte(column, value));
					break;
				case "lt":
					conditions.push(lt(column, value));
					break;
				case "lte":
					conditions.push(lte(column, value));
					break;
				case "neq":
					conditions.push(ne(column, value));
					break;
				case "like":
					// Caller supplies the pattern (e.g. 'John%'); do not re-wrap.
					conditions.push(like(column, value as string));
					break;
				case "ilike":
					conditions.push(ilike(column, value as string));
					break;
				case "in":
					conditions.push(inArray(column, value as any[]));
					break;
				case "isNull":
					conditions.push(isNull(column));
					break;
				case "isNotNull":
					conditions.push(isNotNull(column));
					break;
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

		const { transaction } = options || {};
		const db = transaction || this.config.db;
		// Combine the per-column tsvectors into a single SQL expression. Using
		// sql.join keeps the column references as bound SQL chunks instead of
		// stringifying them (which Array#join + sql.raw did, producing invalid
		// SQL and an injection vector).
		const tsVector = sql.join(
			searchColumns.map(
				(col) => sql`to_tsvector('english', ${this.config.table[col]})`,
			),
			sql` || `,
		);
		const tsQuery = sql`plainto_tsquery('english', ${searchTerm})`;

		// Like find/findAll/count, exclude soft-deleted rows from search results.
		const matchExpr = sql`${tsVector} @@ ${tsQuery}`;
		const whereExpr = this.config.softDelete?.enabled
			? and(matchExpr, isNull(this.config.table[this.config.softDelete.column]))
			: matchExpr;

		let query = db
			.select()
			.from(this.config.table)
			.where(whereExpr)
			.orderBy(sql`ts_rank(${tsVector}, ${tsQuery}) DESC`);

		// Resolve page/limit even when pagination is omitted so the envelope is
		// consistent with findAll's { data, total, page, limit }. The query is
		// only constrained when the caller actually paginated.
		const { page, limit, offset } = this.resolvePagination(
			pagination?.page,
			pagination?.limit,
		);
		if (pagination) {
			query = query.limit(limit).offset(offset);
		}

		const data = await query;
		const countQuery = db
			.select({ count: sql<number>`count(*)` })
			.from(this.config.table)
			.where(whereExpr);
		const totalResult = await countQuery;
		const total = parseInt(totalResult[0]?.count?.toString() || "0", 10);

		return { data, total, page, limit };
	}
}
