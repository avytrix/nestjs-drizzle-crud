import type { SortOrder, SqlDialect } from "../types/sql.types";
import type { CrudSubscriber } from "./events.interface";
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

	// Module-level events. With `enableGlobalHooks: true` every service raises
	// a before and an after event for each write (bulk and upsert included) on
	// the CrudEventBus, which you can inject and subscribe to. `subscribers`
	// are subscribed when the bus is created. The per-service hooks run either
	// way.
	hooks?: {
		enableGlobalHooks?: boolean;
		subscribers?: CrudSubscriber[];
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
