import type { SortOrder, SqlDialect } from "../types/sql.types";
import type { SqlCrudConfig } from "./sql-crud-config.interface";

export interface DrizzleCrudConfig {
	// Database configuration
	dialect: SqlDialect;

	// Connection: provide ONE of:
	//  - `db`: an already-constructed Drizzle instance, or
	//  - `connectionString`: the module builds the connection itself
	//    (postgresql via `postgres` + drizzle-orm/postgres-js).
	db?: any;
	connectionString?: string;
	// Optional Drizzle schema object, passed to drizzle() when the module
	// builds the connection from `connectionString`.
	schema?: Record<string, unknown>;

	// Global defaults applied to every entity registered via forFeature.
	defaults?: {
		softDelete?: boolean;
		timestamps?: boolean;
		// Either key can be left out; it keeps its default (20 / 100).
		pagination?: {
			defaultLimit?: number;
			maxLimit?: number;
		};
		// Opt-in fallback: entities WITHOUT an explicit defaultSort sort by their
		// timestamps.createdAt column in this direction. Omit to leave findAll
		// unsorted by default (backward compatible).
		sortOrder?: SortOrder;
	};

	// SQL-specific. Each key is optional and keeps its default when left out.
	sql?: {
		caseSensitive?: boolean;
		useReturning?: boolean;
		/** @deprecated Has no effect. Nothing reads it; it will be removed in the next major version. */
		jsonSupport?: boolean;
		/** @deprecated Has no effect. Full-text search works on PostgreSQL whatever this is set to; it will be removed in the next major version. */
		enableFullTextSearch?: boolean;
	};

	/** @deprecated Has no effect: there are no global hooks. Override the hooks on each service instead. It will be removed in the next major version. */
	hooks?: {
		/** @deprecated Has no effect. */
		enableGlobalHooks?: boolean;
	};
}

// Per-entity overrides for forFeature. Every key is optional, and the object
// settings (softDelete, timestamps, pagination, sql) merge over the project
// defaults one level deep, so `pagination: { defaultLimit: 5 }` keeps the
// project's maxLimit. `timestamps: undefined` turns timestamps off.
export type CrudFeatureConfig = Partial<
	Omit<SqlCrudConfig, "softDelete" | "timestamps" | "pagination" | "sql">
> & {
	softDelete?: Partial<NonNullable<SqlCrudConfig["softDelete"]>>;
	timestamps?: Partial<NonNullable<SqlCrudConfig["timestamps"]>>;
	pagination?: Partial<NonNullable<SqlCrudConfig["pagination"]>>;
	sql?: Partial<NonNullable<SqlCrudConfig["sql"]>>;
};

// A single entity registration for DrizzleCrudModule.forFeature().
export interface CrudFeature {
	// The CRUD service class (extends SqlBaseCrudService).
	service: new (
		...args: any[]
	) => any;
	// The Drizzle table this service operates on.
	table: any;
	// Per-entity config overrides (primaryKey, softDelete, timestamps, ...).
	config?: CrudFeatureConfig;
}
