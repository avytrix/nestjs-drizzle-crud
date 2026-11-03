/**
 * @jest-environment node
 *
 * Real SQL against SQLite through libSQL (@libsql/client), in memory, in the
 * normal unit run. The shared contract covers the core CRUD paths; the tests
 * below cover what is SQLite specific: RETURNING (nested writes), the scoped
 * upsert guard, and the clear refusals for what SQLite does not have.
 */

import { afterAll, describe, expect, it } from "@jest/globals";
import { type Client, createClient } from "@libsql/client";
import { Test } from "@nestjs/testing";
import { entityKind, sql } from "drizzle-orm";
import { drizzle as drizzleD1 } from "drizzle-orm/d1";
import { drizzle } from "drizzle-orm/libsql";
import {
	integer,
	primaryKey,
	sqliteTable,
	text,
} from "drizzle-orm/sqlite-core";
import { TransactionException } from "../src/exceptions/crud.exceptions";
import { DRIZZLE_CRUD_CONFIG } from "../src/modules/drizzle-connection";
import { DrizzleCrudModule } from "../src/modules/drizzle-crud.module";
import {
	type DialectSetup,
	describeDialectContract,
	expectStatus,
	seed,
	services,
	Svc,
} from "./dialect-contract";

const stamps = {
	created_at: integer("created_at", { mode: "timestamp_ms" }),
	updated_at: integer("updated_at", { mode: "timestamp_ms" }),
	deleted_at: integer("deleted_at", { mode: "timestamp_ms" }),
};

const authors = sqliteTable("authors", {
	id: integer("id").primaryKey({ autoIncrement: true }),
	name: text("name").notNull(),
	email: text("email").notNull().unique(),
	...stamps,
});
const posts = sqliteTable("posts", {
	id: integer("id").primaryKey({ autoIncrement: true }),
	title: text("title").notNull(),
	author_id: integer("author_id").notNull(),
	views: integer("views").notNull(),
	score: integer("score"),
	...stamps,
});
const tags = sqliteTable("tags", {
	id: integer("id").primaryKey({ autoIncrement: true }),
	name: text("name").notNull().unique(),
});
const postTags = sqliteTable(
	"post_tags",
	{
		post_id: integer("post_id").notNull(),
		tag_id: integer("tag_id").notNull(),
	},
	(table) => [primaryKey({ columns: [table.post_id, table.tag_id] })],
);
const docs = sqliteTable("docs", {
	id: integer("id").primaryKey({ autoIncrement: true }),
	tenant_id: integer("tenant_id").notNull(),
	title: text("title").notNull(),
	slug: text("slug").notNull().unique(),
	version: integer("version").notNull().default(1),
	...stamps,
});

const DDL = [
	`CREATE TABLE authors (
		id integer PRIMARY KEY AUTOINCREMENT,
		name text NOT NULL,
		email text NOT NULL UNIQUE,
		created_at integer, updated_at integer, deleted_at integer
	) STRICT`,
	`CREATE TABLE posts (
		id integer PRIMARY KEY AUTOINCREMENT,
		title text NOT NULL,
		author_id integer NOT NULL REFERENCES authors(id),
		views integer NOT NULL,
		score integer,
		created_at integer, updated_at integer, deleted_at integer
	) STRICT`,
	`CREATE TABLE tags (
		id integer PRIMARY KEY AUTOINCREMENT,
		name text NOT NULL UNIQUE
	) STRICT`,
	`CREATE TABLE post_tags (
		post_id integer NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
		tag_id integer NOT NULL REFERENCES tags(id),
		PRIMARY KEY (post_id, tag_id)
	) STRICT`,
	`CREATE TABLE docs (
		id integer PRIMARY KEY AUTOINCREMENT,
		tenant_id integer NOT NULL,
		title text NOT NULL,
		slug text NOT NULL UNIQUE,
		version integer NOT NULL DEFAULT 1,
		created_at integer, updated_at integer, deleted_at integer
	) STRICT`,
];

const clients: Client[] = [];
afterAll(() => {
	for (const client of clients) client.close();
});

async function emptyDb(): Promise<any> {
	const client = createClient({ url: ":memory:" });
	clients.push(client);
	const db = drizzle(client);
	// libSQL turns foreign keys on by default; say so rather than rely on it.
	await db.run(sql`PRAGMA foreign_keys = ON`);
	for (const statement of DDL) await db.run(sql.raw(statement));
	return db;
}

const setup: DialectSetup = {
	dialect: "sqlite",
	tables: { authors, posts, tags, postTags, docs },
	emptyDb,
};

describeDialectContract(setup);

async function fresh() {
	const db = await emptyDb();
	await seed(db, setup.tables);
	return { db, ...services(setup, db) };
}

describe("sqlite: what RETURNING makes possible", () => {
	it("creates a row with nested has-many children in one transaction", async () => {
		const { db, authors: svc } = await fresh();
		const author = await new Svc({
			...(svc as any).config,
			writableRelations: ["posts"],
		}).create({
			name: "Dee",
			email: "dee@x.io",
			posts: [
				{ title: "First", views: 1 },
				{ title: "Second", views: 2 },
			],
		});
		const children = await db.select().from(posts).where(sql`author_id = 4`);
		expect(author.id).toBe(4);
		expect(children.map((row: any) => row.title)).toEqual(["First", "Second"]);
	});

	it("keeps a scoped upsert inside the tenant", async () => {
		const { tenantDocs } = await fresh();
		// "three" belongs to tenant 2: the conflict updates nothing, so a 404.
		await expectStatus(
			tenantDocs.upsert(
				{ title: "Stolen", slug: "three" },
				{ conflictTarget: "slug" },
			),
			404,
		);
		const own = await tenantDocs.upsert(
			{ title: "One again", slug: "one" },
			{ conflictTarget: "slug" },
		);
		expect(own).toMatchObject({ id: 1, tenant_id: 1, title: "One again" });
	});
});

describe("sqlite: what SQLite does not have is a 400", () => {
	it("refuses full-text search", async () => {
		const { posts: svc } = await fresh();
		await expectStatus(svc.fullTextSearch("post", ["title"]), 400);
		await expectStatus(
			svc.findAll(
				undefined,
				{},
				{ search: { term: "post", columns: ["title"], mode: "fullText" } },
			),
			400,
		);
	});

	it("refuses row locks instead of ignoring them", async () => {
		const { posts: svc } = await fresh();
		await expectStatus(svc.find(1, { lock: "update" }), 400);
		await expectStatus(
			svc.findAll(undefined, {}, { forNoKeyUpdate: true }),
			400,
		);
		expect(await svc.find(1, { lock: "none" })).not.toBeNull();
	});

	it("refuses the Postgres-only operators", async () => {
		const { posts: svc } = await fresh();
		await expectStatus(svc.findAll({ title: { arrayContains: ["a"] } }), 400);
		await expectStatus(svc.findAll({ title: { jsonContains: { a: 1 } } }), 400);
	});
});

describe("sqlite: drivers without interactive transactions fail clearly", () => {
	const fakeService = (db: any) =>
		new Svc({
			dialect: "sqlite",
			db,
			table: authors,
			primaryKey: "id",
			softDelete: { enabled: true, column: "deleted_at" },
			timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
		});

	it("names D1 when a mass write needs a transaction", async () => {
		class FakeD1 {
			static readonly [entityKind] = "D1Database";
			transaction = () => {
				throw new Error("BEGIN is not allowed");
			};
		}
		const error = await (async () => {
			try {
				await fakeService(new FakeD1()).massCreate([
					{ name: "A", email: "a@x.io" },
				]);
			} catch (e) {
				return e;
			}
		})();
		expect(error).toBeInstanceOf(TransactionException);
		expect((error as Error).message).toMatch(/D1 has no interactive/);
	});

	it("names a synchronous driver", async () => {
		const syncDb = {
			resultKind: "sync",
			transaction: () => {
				throw new Error("would commit before the work finished");
			},
		};
		await expect(fakeService(syncDb).massDelete([1, 2])).rejects.toBeInstanceOf(
			TransactionException,
		);
	});

	it("reads affected rows from better-sqlite3 and D1 results", () => {
		const svc = fakeService({}) as any;
		expect(svc.wasAffected({ changes: 1, lastInsertRowid: 1 })).toBe(true);
		expect(svc.wasAffected({ changes: 0 })).toBe(false);
		expect(svc.wasAffected({ success: true, meta: { changes: 2 } })).toBe(true);
		expect(svc.wasAffected({ success: true, meta: { changes: 0 } })).toBe(
			false,
		);
	});

	it("maps a D1 constraint message to the right status", () => {
		const svc = fakeService({}) as any;
		const d1 = (message: string) => ({
			message: "Failed query",
			cause: new Error(`D1_ERROR: ${message}: SQLITE_CONSTRAINT`),
		});
		expect(
			svc.toClientError(d1("UNIQUE constraint failed: authors.email")),
		).toMatchObject({ status: 409 });
		expect(
			svc.toClientError(d1("FOREIGN KEY constraint failed"), "delete"),
		).toMatchObject({ status: 409 });
		expect(
			svc.toClientError(d1("NOT NULL constraint failed: authors.name")),
		).toMatchObject({ status: 400 });
	});
});

describe("sqlite: the bound parameter limit (3.7.2)", () => {
	const args = (n: number) => Array.from({ length: n }, (_, i) => i);
	const inList = (n: number) =>
		`select count(*) as n from tags where id in (${args(n)
			.map(() => "?")
			.join(",")})`;

	it("is libSQL's own: 32,766 values run, 32,767 fail in the database", async () => {
		const db = await emptyDb();
		const client: Client = db.$client;
		const ok = await client.execute({
			sql: inList(32_766),
			args: args(32_766),
		});
		expect(Number(ok.rows[0]?.n)).toBe(0);
		await expect(
			client.execute({ sql: inList(32_767), args: args(32_767) }),
		).rejects.toThrow(/too many SQL variables/);
	});

	it("is a 400 from the service before the statement reaches libSQL", async () => {
		const { posts: svc } = await fresh();
		const error = await expectStatus(
			svc.findAll({ id: { in: args(40_000) } }),
			400,
		);
		expect(error.message).toBe(
			"Too many values in one statement: 40001 bound parameters, and SQLite takes at most 32766. Split the batch.",
		);
	});

	it("is 100 on Cloudflare D1", async () => {
		const bound: number[] = [];
		const binding = {
			prepare: () => ({
				bind: (...params: unknown[]) => {
					bound.push(params.length);
					return {
						all: async () => ({ results: [] }),
						raw: async () => [],
						run: async () => ({ meta: { changes: 0 } }),
					};
				},
			}),
		};
		const svc = new Svc({
			dialect: "sqlite",
			db: drizzleD1(binding as any),
			table: posts,
			primaryKey: "id",
			softDelete: { enabled: true, column: "deleted_at" },
			timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
		});
		await svc.findAll({ id: { in: args(99) } });
		expect(Math.max(...bound)).toBe(100);
		const error = await expectStatus(
			svc.findAll({ id: { in: args(100) } }),
			400,
		);
		expect(error.message).toContain("Cloudflare D1 takes at most 100");
	});
});

describe("sqlite: sql.caseSensitive (3.7.2)", () => {
	const caseSensitive = (db: any) =>
		new Svc({
			dialect: "sqlite",
			db,
			table: posts,
			primaryKey: "id",
			softDelete: { enabled: true, column: "deleted_at" },
			timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
			sql: {
				caseSensitive: true,
				useReturning: true,
				jsonSupport: true,
				enableFullTextSearch: false,
			},
		});
	const titles = (res: { data: any[] }) =>
		res.data.map((row: any) => row.title).sort();

	it("makes contains, startsWith and endsWith case-sensitive", async () => {
		const { db } = await fresh();
		const svc = caseSensitive(db);
		expect((await svc.findAll({ title: { contains: "POST" } })).total).toBe(0);
		expect((await svc.findAll({ title: { startsWith: "post" } })).total).toBe(
			0,
		);
		expect((await svc.findAll({ title: { contains: "ost 1" } })).total).toBe(4);
		expect((await svc.findAll({ title: { startsWith: "Post" } })).total).toBe(
			12,
		);
		expect(titles(await svc.findAll({ title: { endsWith: "t 12" } }))).toEqual([
			"Post 12",
		]);
		// The i forms still ignore case.
		expect((await svc.findAll({ title: { iContains: "POST" } })).total).toBe(
			12,
		);
	});

	it("matches GLOB's own wildcards literally", async () => {
		const { db } = await fresh();
		const svc = caseSensitive(db);
		for (const title of ["a*b", "a?c", "x[y]z", "plain"]) {
			await svc.create({ title, author_id: 1, views: 0 });
		}
		expect(titles(await svc.findAll({ title: { contains: "*" } }))).toEqual([
			"a*b",
		]);
		expect(titles(await svc.findAll({ title: { contains: "?" } }))).toEqual([
			"a?c",
		]);
		expect(titles(await svc.findAll({ title: { contains: "[y]" } }))).toEqual([
			"x[y]z",
		]);
		expect(titles(await svc.findAll({ title: { endsWith: "]z" } }))).toEqual([
			"x[y]z",
		]);
	});
});

describe("sqlite: module wiring", () => {
	it("turns RETURNING on for sqlite by default", async () => {
		const db = await emptyDb();
		const moduleRef = await Test.createTestingModule({
			imports: [DrizzleCrudModule.forRoot({ dialect: "sqlite", db })],
		}).compile();
		const config: any = moduleRef.get(DRIZZLE_CRUD_CONFIG);
		expect(config.sql.useReturning).toBe(true);
		await moduleRef.close();
	});
});
