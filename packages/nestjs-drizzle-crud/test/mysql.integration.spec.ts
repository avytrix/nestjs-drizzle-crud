/**
 * @jest-environment node
 *
 * Real SQL against MySQL 8. Runs only when MYSQL_URL points at a server (the
 * CI "MySQL integration" job starts a mysql:8 service and sets it); without
 * it every test here is skipped, so the normal unit run needs no database.
 * The shared contract covers the core CRUD paths; the tests below cover what
 * is MySQL specific.
 */

import { afterAll, describe, expect, it } from "@jest/globals";
import { Test } from "@nestjs/testing";
import { sql } from "drizzle-orm";
import {
	datetime,
	int,
	mysqlTable,
	primaryKey,
	varchar,
} from "drizzle-orm/mysql-core";
import { drizzle } from "drizzle-orm/mysql2";
import { createPool, type Pool } from "mysql2/promise";
import { DRIZZLE_DB } from "../src/modules/drizzle-connection";
import { DrizzleCrudModule } from "../src/modules/drizzle-crud.module";
import {
	type DialectSetup,
	describeDialectContract,
	expectStatus,
	seed,
	services,
} from "./dialect-contract";

const MYSQL_URL = process.env.MYSQL_URL;

const stamps = {
	created_at: datetime("created_at", { mode: "date", fsp: 3 }),
	updated_at: datetime("updated_at", { mode: "date", fsp: 3 }),
	deleted_at: datetime("deleted_at", { mode: "date", fsp: 3 }),
};

const authors = mysqlTable("authors", {
	id: int("id").autoincrement().primaryKey(),
	name: varchar("name", { length: 100 }).notNull(),
	email: varchar("email", { length: 191 }).notNull().unique(),
	...stamps,
});
const posts = mysqlTable("posts", {
	id: int("id").autoincrement().primaryKey(),
	title: varchar("title", { length: 200 }).notNull(),
	author_id: int("author_id").notNull(),
	views: int("views").notNull(),
	score: int("score"),
	...stamps,
});
const tags = mysqlTable("tags", {
	id: int("id").autoincrement().primaryKey(),
	name: varchar("name", { length: 50 }).notNull().unique(),
});
const postTags = mysqlTable(
	"post_tags",
	{
		post_id: int("post_id").notNull(),
		tag_id: int("tag_id").notNull(),
	},
	(table) => [primaryKey({ columns: [table.post_id, table.tag_id] })],
);
const docs = mysqlTable("docs", {
	id: int("id").autoincrement().primaryKey(),
	tenant_id: int("tenant_id").notNull(),
	title: varchar("title", { length: 100 }).notNull(),
	slug: varchar("slug", { length: 100 }).notNull().unique(),
	version: int("version").notNull().default(1),
	...stamps,
});

const STAMPS =
	"created_at datetime(3), updated_at datetime(3), deleted_at datetime(3)";
const DDL = [
	"DROP TABLE IF EXISTS post_tags, posts, tags, authors, docs",
	`CREATE TABLE authors (
		id int AUTO_INCREMENT PRIMARY KEY,
		name varchar(100) NOT NULL,
		email varchar(191) NOT NULL UNIQUE,
		${STAMPS}
	)`,
	`CREATE TABLE posts (
		id int AUTO_INCREMENT PRIMARY KEY,
		title varchar(200) NOT NULL,
		author_id int NOT NULL,
		views int NOT NULL,
		score int,
		${STAMPS},
		FOREIGN KEY (author_id) REFERENCES authors(id)
	)`,
	`CREATE TABLE tags (
		id int AUTO_INCREMENT PRIMARY KEY,
		name varchar(50) NOT NULL UNIQUE
	)`,
	`CREATE TABLE post_tags (
		post_id int NOT NULL,
		tag_id int NOT NULL,
		PRIMARY KEY (post_id, tag_id),
		FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
		FOREIGN KEY (tag_id) REFERENCES tags(id)
	)`,
	`CREATE TABLE docs (
		id int AUTO_INCREMENT PRIMARY KEY,
		tenant_id int NOT NULL,
		title varchar(100) NOT NULL,
		slug varchar(100) NOT NULL UNIQUE,
		version int NOT NULL DEFAULT 1,
		${STAMPS}
	)`,
];

let pool: Pool | undefined;
afterAll(async () => {
	await pool?.end();
});

// One database for the whole file. Jest runs the tests of a file one after
// another, so each test can drop and recreate the tables it starts from.
async function emptyDb(): Promise<any> {
	pool ??= createPool({ uri: MYSQL_URL, connectionLimit: 5 });
	const db = drizzle(pool);
	for (const statement of DDL) await db.execute(sql.raw(statement));
	return db;
}

const setup: DialectSetup = {
	dialect: "mysql",
	tables: { authors, posts, tags, postTags, docs },
	emptyDb,
};

const run = MYSQL_URL ? describe : describe.skip;

run("MySQL integration (MYSQL_URL)", () => {
	describeDialectContract(setup);

	async function fresh() {
		const db = await emptyDb();
		await seed(db, setup.tables);
		return { db, ...services(setup, db) };
	}

	it("takes a row lock inside a transaction", async () => {
		const { db, posts: svc } = await fresh();
		const row = await db.transaction((tx: any) =>
			svc.find(1, { transaction: tx, lock: "update" }),
		);
		expect(row?.title).toBe("Post 1");
		const shared = await db.transaction((tx: any) =>
			svc.findAll(
				{ author_id: 1 },
				{},
				{ transaction: tx, lock: "share", relations: ["author"] },
			),
		);
		expect(shared.total).toBe(4);
	});

	it("answers a value too long for its column with a 400", async () => {
		const { authors: svc } = await fresh();
		const error = await expectStatus(
			svc.create({ name: "x".repeat(101), email: "long@x.io" }),
			400,
		);
		expect(error.message).toMatch(/too long/);
	});

	it("refuses what needs RETURNING or a guarded upsert", async () => {
		const { tenantDocs, authors: svc } = await fresh();
		await expectStatus(
			tenantDocs.upsert(
				{ title: "One", slug: "one" },
				{ conflictTarget: "slug" },
			),
			400,
		);
		await expectStatus(svc.fullTextSearch("ann", ["name"]), 400);
	});

	it("builds its own pool from connectionString", async () => {
		await emptyDb();
		const moduleRef = await Test.createTestingModule({
			imports: [
				DrizzleCrudModule.forRoot({
					dialect: "mysql",
					connectionString: MYSQL_URL,
					connection: { poolSize: 2, idleTimeout: 30 },
				}),
			],
		}).compile();
		const db: any = moduleRef.get(DRIZZLE_DB);
		const [rows] = await db.execute(sql`select 1 + 1 as two`);
		expect(Number(rows[0].two)).toBe(2);
		await moduleRef.close();
	});
});
