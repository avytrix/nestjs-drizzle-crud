/**
 * @jest-environment node
 *
 * forRootAsync with useClass / useExisting, and the connection options the
 * module hands to postgres-js and mysql2 when it builds the connection from a
 * connectionString. Both drivers connect lazily, so no server is needed: the
 * tests read the options back from the client and close it.
 */

import { describe, expect, it } from "@jest/globals";
import { Injectable, Module } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type {
	DrizzleCrudConfig,
	DrizzleCrudOptionsFactory,
} from "../src/core/interfaces/drizzle-crud-config.interface";
import {
	DRIZZLE_CRUD_CONFIG,
	DRIZZLE_DB,
	DrizzleConnection,
	mysqlOptions,
	postgresOptions,
} from "../src/modules/drizzle-connection";
import { DrizzleCrudModule } from "../src/modules/drizzle-crud.module";

const fakeDb = { name: "fake drizzle" };

@Injectable()
class ConfigFactory implements DrizzleCrudOptionsFactory {
	createDrizzleCrudOptions(): DrizzleCrudConfig {
		return { dialect: "mysql", db: fakeDb, defaults: { softDelete: false } };
	}
}

@Module({ providers: [ConfigFactory], exports: [ConfigFactory] })
class ConfigModule {}

describe("forRootAsync", () => {
	it("builds the config with useClass", async () => {
		const moduleRef = await Test.createTestingModule({
			imports: [DrizzleCrudModule.forRootAsync({ useClass: ConfigFactory })],
		}).compile();
		expect(moduleRef.get(DRIZZLE_DB)).toBe(fakeDb);
		const config: any = moduleRef.get(DRIZZLE_CRUD_CONFIG);
		expect(config.dialect).toBe("mysql");
		expect(config.defaults.softDelete).toBe(false);
		expect(config.sql.useReturning).toBe(false);
		await moduleRef.close();
	});

	it("reuses an imported provider with useExisting", async () => {
		const moduleRef = await Test.createTestingModule({
			imports: [
				DrizzleCrudModule.forRootAsync({
					imports: [ConfigModule],
					useExisting: ConfigFactory,
				}),
			],
		}).compile();
		expect(moduleRef.get(DRIZZLE_DB)).toBe(fakeDb);
		await moduleRef.close();
	});

	it("still takes useFactory", async () => {
		const moduleRef = await Test.createTestingModule({
			imports: [
				DrizzleCrudModule.forRootAsync({
					useFactory: async () => ({ dialect: "postgresql", db: fakeDb }),
				}),
			],
		}).compile();
		const config: any = moduleRef.get(DRIZZLE_CRUD_CONFIG);
		expect(config.sql.useReturning).toBe(true);
		await moduleRef.close();
	});

	it("says what is missing when no factory is given", () => {
		expect(() => DrizzleCrudModule.forRootAsync({})).toThrow(
			/useFactory, useClass or useExisting/,
		);
	});

	// 3.7.2 (A-10): the class used to be ignored without a word.
	it("refuses more than one of useFactory, useClass and useExisting", () => {
		const factory = async () => ({
			dialect: "postgresql" as const,
			db: fakeDb,
		});
		expect(() =>
			DrizzleCrudModule.forRootAsync({
				useFactory: factory,
				useClass: ConfigFactory,
			}),
		).toThrow(/exactly one of .* not useFactory and useClass/);
		expect(() =>
			DrizzleCrudModule.forRootAsync({
				useClass: ConfigFactory,
				useExisting: ConfigFactory,
			}),
		).toThrow(/not useClass and useExisting/);
	});
});

describe("connection options", () => {
	it("maps to postgres-js names and leaves unset keys out", () => {
		expect(postgresOptions()).toEqual({});
		expect(
			postgresOptions({ poolSize: 5, idleTimeout: 20, ssl: "require" }),
		).toEqual({ max: 5, idle_timeout: 20, ssl: "require" });
	});

	it("maps to mysql2 names, in milliseconds, with TLS as an object", () => {
		expect(mysqlOptions()).toEqual({});
		expect(mysqlOptions({ poolSize: 5, idleTimeout: 20, ssl: true })).toEqual({
			connectionLimit: 5,
			idleTimeout: 20_000,
			maxIdle: 4,
			ssl: {},
		});
		expect(mysqlOptions({ ssl: false })).toEqual({});
		expect(mysqlOptions({ ssl: { rejectUnauthorized: false } })).toEqual({
			ssl: { rejectUnauthorized: false },
		});
		expect(() => mysqlOptions({ ssl: "require" })).toThrow(/postgres-js mode/);
	});

	it("passes them to postgres-js", async () => {
		const connection = new DrizzleConnection();
		await connection.init({
			dialect: "postgresql",
			connectionString: "postgres://user:secret@127.0.0.1:1/app",
			connection: { poolSize: 3, idleTimeout: 15 },
		});
		const options = (connection as any).client.options;
		expect(options.max).toBe(3);
		expect(options.idle_timeout).toBe(15);
		expect(options.prepare).toBe(false);
		await connection.onModuleDestroy();
	});

	it("builds a mysql2 pool from a connectionString", async () => {
		const connection = new DrizzleConnection();
		await connection.init({
			dialect: "mysql",
			connectionString: "mysql://user:secret@127.0.0.1:1/app",
			connection: { poolSize: 4, idleTimeout: 30, ssl: true },
		});
		const pool = (connection as any).client.pool;
		expect(pool.config.connectionLimit).toBe(4);
		expect(pool.config.idleTimeout).toBe(30_000);
		// mysql2 fills in certificate checks for `true`.
		expect(pool.config.connectionConfig.ssl).toEqual({
			rejectUnauthorized: true,
		});
		expect(pool.config.connectionConfig.database).toBe("app");
		expect(typeof connection.db.select).toBe("function");
		await connection.onModuleDestroy();
	});

	// 3.7.2 (A-09): mysql2 only reaps idle connections when maxIdle is below
	// connectionLimit, and maxIdle defaults to connectionLimit.
	it("starts mysql2's idle reaper when idleTimeout is set", async () => {
		const build = async (connection: Record<string, unknown>) => {
			const owner = new DrizzleConnection();
			await owner.init({
				dialect: "mysql",
				connectionString: "mysql://user:secret@127.0.0.1:1/app",
				connection,
			});
			return owner;
		};
		const timed = await build({ poolSize: 4, idleTimeout: 30 });
		const pool = (timed as any).client.pool;
		expect(pool.config.maxIdle).toBe(3);
		expect(pool._removeIdleTimeoutConnectionsTimer).toBeDefined();
		await timed.onModuleDestroy();

		const sized = await build({ idleTimeout: 30 });
		expect((sized as any).client.pool.config.maxIdle).toBe(9);
		await sized.onModuleDestroy();

		// Without idleTimeout, mysql2's own defaults stand.
		const untimed = await build({ poolSize: 4 });
		expect((untimed as any).client.pool.config.maxIdle).toBe(4);
		await untimed.onModuleDestroy();
	});

	it("still refuses a connectionString for sqlite", async () => {
		await expect(
			new DrizzleConnection().init({
				dialect: "sqlite",
				connectionString: "file:local.db",
			}),
		).rejects.toThrow(/"postgresql" and "mysql"/);
	});
});
