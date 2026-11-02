import type { OnModuleDestroy } from "@nestjs/common";
import type {
	DrizzleConnectionOptions,
	DrizzleCrudConfig,
} from "../core/interfaces/drizzle-crud-config.interface";

export const DRIZZLE_DB = "DRIZZLE_DB";
export const DRIZZLE_CRUD_CONFIG = "DRIZZLE_CRUD_CONFIG";
export const DRIZZLE_CONNECTION = "DRIZZLE_CONNECTION";

/**
 * Owns the Drizzle connection for the lifetime of the application.
 *
 * If the caller passes a ready-made `db`, it is used as-is and left for the
 * caller to dispose. If a `connectionString` is given instead, this manager
 * builds the driver connection and closes it on application shutdown.
 */
export class DrizzleConnection implements OnModuleDestroy {
	db: any;
	private client?: { end?: () => Promise<void> };
	private ownsConnection = false;

	async init(config: DrizzleCrudConfig): Promise<void> {
		if (config.db) {
			this.db = config.db;
			return;
		}

		if (!config.connectionString) {
			throw new Error(
				"DrizzleCrudModule: provide either `db` (a Drizzle instance) or `connectionString`.",
			);
		}

		if (config.dialect === "postgresql") {
			const postgres = (await import("postgres")).default;
			const { drizzle } = await import("drizzle-orm/postgres-js");
			const client = postgres(config.connectionString, {
				prepare: false,
				...postgresOptions(config.connection),
			});
			this.client = client as unknown as { end: () => Promise<void> };
			this.ownsConnection = true;
			this.db = config.schema
				? drizzle(client, { schema: config.schema })
				: drizzle(client);
			return;
		}

		if (config.dialect === "mysql") {
			const mysql = await import("mysql2/promise");
			const { drizzle } = await import("drizzle-orm/mysql2");
			const pool = mysql.createPool({
				uri: config.connectionString,
				...mysqlOptions(config.connection),
			});
			this.client = pool;
			this.ownsConnection = true;
			this.db = config.schema
				? drizzle(pool, { schema: config.schema, mode: "default" })
				: drizzle(pool);
			return;
		}

		throw new Error(
			`DrizzleCrudModule: building a connection from \`connectionString\` is only supported for the "postgresql" and "mysql" dialects. ` +
				`For "${config.dialect}", construct the Drizzle instance yourself and pass it as \`db\`.`,
		);
	}

	async onModuleDestroy(): Promise<void> {
		if (this.ownsConnection && this.client?.end) {
			await this.client.end();
		}
	}
}

// DrizzleConnectionOptions in postgres-js terms. Unset keys are left out so
// the driver keeps its own defaults.
export function postgresOptions(
	options: DrizzleConnectionOptions = {},
): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	if (options.poolSize !== undefined) out.max = options.poolSize;
	if (options.idleTimeout !== undefined) {
		out.idle_timeout = options.idleTimeout;
	}
	if (options.ssl !== undefined) out.ssl = options.ssl;
	return out;
}

// DrizzleConnectionOptions in mysql2 pool terms. mysql2 counts the idle
// timeout in milliseconds and turns TLS on with an options object, so `true`
// becomes `{}` (verify the server certificate) and `false` leaves TLS off.
export function mysqlOptions(
	options: DrizzleConnectionOptions = {},
): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	if (options.poolSize !== undefined) out.connectionLimit = options.poolSize;
	if (options.idleTimeout !== undefined) {
		out.idleTimeout = options.idleTimeout * 1000;
	}
	const ssl = options.ssl;
	if (ssl === true) out.ssl = {};
	else if (typeof ssl === "string") {
		throw new Error(
			`DrizzleCrudModule: connection.ssl "${ssl}" is a postgres-js mode; for mysql pass true or a TLS options object.`,
		);
	} else if (ssl && typeof ssl === "object") out.ssl = ssl;
	return out;
}
