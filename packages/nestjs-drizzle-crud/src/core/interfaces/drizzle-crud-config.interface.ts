import type { SortOrder, SqlDialect } from "../types/sql.types";

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
		pagination?: {
			defaultLimit: number;
			maxLimit: number;
		};
		// Opt-in fallback: entities WITHOUT an explicit defaultSort sort by their
		// timestamps.createdAt column in this direction. Omit to leave findAll
		// unsorted by default (backward compatible).
		sortOrder?: SortOrder;
	};

	// SQL-specific
	sql?: {
		caseSensitive: boolean;
		useReturning: boolean;
		jsonSupport: boolean;
		enableFullTextSearch: boolean;
	};

	// Hooks
	hooks?: {
		enableGlobalHooks: boolean;
	};
}

// A single entity registration for DrizzleCrudModule.forFeature().
export interface CrudFeature {
	// The CRUD service class (extends SqlBaseCrudService).
	service: new (...args: any[]) => any;
	// The Drizzle table this service operates on.
	table: any;
	// Per-entity config overrides (primaryKey, softDelete, timestamps, ...).
	config?: Record<string, any>;
}
