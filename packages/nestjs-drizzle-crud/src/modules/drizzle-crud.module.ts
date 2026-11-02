import { type DynamicModule, Module, type Provider } from "@nestjs/common";
import type {
	CrudFeature,
	DrizzleCrudConfig,
} from "../core/interfaces/drizzle-crud-config.interface";
import type { SqlCrudConfig } from "../core/interfaces/sql-crud-config.interface";
import { mergeCrudConfig } from "../core/utils/merge-config";
import {
	DRIZZLE_CONNECTION,
	DRIZZLE_CRUD_CONFIG,
	DRIZZLE_DB,
	DrizzleConnection,
} from "./drizzle-connection";

const DRIZZLE_RAW_CONFIG = "DRIZZLE_RAW_CONFIG";

// Normalize the raw forRoot config into the value exposed as DRIZZLE_CRUD_CONFIG.
function normalizeConfig(config: DrizzleCrudConfig) {
	return {
		dialect: config.dialect,
		defaults: {
			softDelete: true,
			timestamps: true,
			...config.defaults,
			// Merged, so `pagination: { defaultLimit: 5 }` keeps maxLimit.
			pagination: {
				defaultLimit: 20,
				maxLimit: 100,
				...config.defaults?.pagination,
			},
		},
		sql: {
			caseSensitive: false,
			useReturning: config.dialect === "postgresql",
			jsonSupport: true,
			enableFullTextSearch: false,
			...config.sql,
		},
		hooks: {
			enableGlobalHooks: false,
			...config.hooks,
		},
	};
}

// Build the full SqlCrudConfig for one entity by layering: project defaults ->
// per-entity overrides (decorator metadata + forFeature config) -> db/table.
function buildEntityConfig(
	service: any,
	table: any,
	entityConfig: CrudFeature["config"],
	db: any,
	globalConfig: any,
): SqlCrudConfig {
	const decoratorConfig = Reflect.getMetadata?.("crud:config", service) || {};
	// Each layer merges one level deep for softDelete, timestamps, pagination and
	// sql, so an override only has to name the settings it changes.
	const perEntity: Record<string, any> = mergeCrudConfig(
		decoratorConfig,
		entityConfig,
	);
	const gd = globalConfig?.defaults || {};

	const projectConfig: any = {
		dialect: globalConfig?.dialect,
		db,
		primaryKey: "id",
		primaryKeyType: "serial",
		softDelete:
			gd.softDelete === false
				? { enabled: false, column: "deleted_at" }
				: { enabled: true, column: "deleted_at" },
		// Only set timestamps when enabled; leaving it undefined lets the
		// service treat the table as having no timestamp columns.
		timestamps:
			gd.timestamps === false
				? undefined
				: { createdAt: "created_at", updatedAt: "updated_at" },
	};
	if (gd.pagination) projectConfig.pagination = gd.pagination;
	if (globalConfig?.sql) projectConfig.sql = globalConfig.sql;

	// Per-entity overrides win over project defaults.
	const finalConfig: any = mergeCrudConfig(projectConfig, perEntity);
	finalConfig.table = table ?? perEntity.table;

	// Opt-in global fallback: when no per-entity defaultSort was provided and a
	// global sortOrder is set, default to sorting by the createdAt timestamp.
	if (
		!finalConfig.defaultSort &&
		gd.sortOrder &&
		finalConfig.timestamps?.createdAt
	) {
		finalConfig.defaultSort = [
			{ column: finalConfig.timestamps.createdAt, order: gd.sortOrder },
		];
	}

	return finalConfig as SqlCrudConfig;
}

// Providers that build and expose the connection. Shared by forRoot/forRootAsync;
// they only differ in how DRIZZLE_RAW_CONFIG is produced.
function connectionProviders(rawConfigProvider: Provider): Provider[] {
	return [
		rawConfigProvider,
		{
			provide: DRIZZLE_CRUD_CONFIG,
			inject: [DRIZZLE_RAW_CONFIG],
			useFactory: (raw: DrizzleCrudConfig) => normalizeConfig(raw),
		},
		{
			provide: DRIZZLE_CONNECTION,
			inject: [DRIZZLE_RAW_CONFIG],
			useFactory: async (
				raw: DrizzleCrudConfig,
			): Promise<DrizzleConnection> => {
				const connection = new DrizzleConnection();
				await connection.init(raw);
				return connection;
			},
		},
		{
			provide: DRIZZLE_DB,
			inject: [DRIZZLE_CONNECTION],
			useFactory: (connection: DrizzleConnection) => connection.db,
		},
	];
}

const EXPORTED_TOKENS = [DRIZZLE_CRUD_CONFIG, DRIZZLE_DB, DRIZZLE_CONNECTION];

@Module({})
export class DrizzleCrudModule {
	static forRoot(config: DrizzleCrudConfig): DynamicModule {
		return {
			module: DrizzleCrudModule,
			providers: connectionProviders({
				provide: DRIZZLE_RAW_CONFIG,
				useValue: config,
			}),
			exports: EXPORTED_TOKENS,
			global: true,
		};
	}

	static forRootAsync(options: {
		imports?: any[];
		useFactory: (
			...args: any[]
		) => Promise<DrizzleCrudConfig> | DrizzleCrudConfig;
		inject?: any[];
	}): DynamicModule {
		return {
			module: DrizzleCrudModule,
			imports: options.imports || [],
			providers: connectionProviders({
				provide: DRIZZLE_RAW_CONFIG,
				useFactory: options.useFactory,
				inject: options.inject || [],
			}),
			exports: EXPORTED_TOKENS,
			global: true,
		};
	}

	static forFeature(entities: CrudFeature[]): DynamicModule {
		const providers: Provider[] = entities.map((entity) => ({
			provide: entity.service,
			inject: [DRIZZLE_DB, DRIZZLE_CRUD_CONFIG],
			useFactory: (db: any, globalConfig: any) =>
				new entity.service(
					buildEntityConfig(
						entity.service,
						entity.table,
						entity.config,
						db,
						globalConfig,
					),
				),
		}));

		return {
			module: DrizzleCrudModule,
			providers,
			exports: providers,
		};
	}
}
