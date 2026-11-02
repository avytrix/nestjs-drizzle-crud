/**
 * @jest-environment node
 *
 * Real SQL against PGlite (Postgres compiled to WASM, in-process). The other
 * specs mock the database, which is how the 3.3.1 audit bugs got through: a
 * mock accepts lower(integer) and a soft-deleted parent on a JOIN without
 * complaint. Read-only tests share one seeded database; every test that writes
 * builds its own, so the order the tests run in never matters.
 */

import { PGlite } from "@electric-sql/pglite";
import { afterAll, describe, expect, it } from "@jest/globals";
import { BadRequestException, HttpException } from "@nestjs/common";
import {
	integer,
	pgEnum,
	pgTable,
	serial,
	text,
	timestamp,
	uuid,
	varchar,
} from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/pglite";
import { SqlBaseCrudService } from "../src/core/abstract/sql-base-crud.service";
import type { SqlCrudConfig } from "../src/core/interfaces/sql-crud-config.interface";
import { BulkOperationException } from "../src/exceptions/crud.exceptions";
import { DrizzleCrudModule } from "../src/modules/drizzle-crud.module";

const authorRole = pgEnum("author_role", ["admin", "writer"]);
const postStatus = pgEnum("post_status", ["draft", "published"]);

const stamps = {
	created_at: timestamp("created_at", { withTimezone: true }).defaultNow(),
	updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow(),
	deleted_at: timestamp("deleted_at", { withTimezone: true }),
};

const authors = pgTable("authors", {
	id: serial("id").primaryKey(),
	name: text("name").notNull(),
	email: varchar("email").notNull().unique(),
	role: authorRole("role").notNull(),
	...stamps,
});

const posts = pgTable("posts", {
	id: serial("id").primaryKey(),
	title: text("title").notNull(),
	author_id: integer("author_id").notNull(),
	status: postStatus("status").notNull(),
	external_id: uuid("external_id").notNull().defaultRandom(),
	published_at: timestamp("published_at", { withTimezone: true }),
	views: integer("views").notNull(),
	...stamps,
});

// Primary key named `uid`, not `id`: nested relations must not borrow it.
const comments = pgTable("comments", {
	uid: serial("uid").primaryKey(),
	body: text("body").notNull(),
	author_id: integer("author_id").notNull(),
	...stamps,
});

// camelCase JS keys over snake_case columns, the most common Drizzle style.
const notes = pgTable("notes", {
	id: serial("id").primaryKey(),
	body: text("body").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
	deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

const DDL = `
CREATE TYPE author_role AS ENUM ('admin', 'writer');
CREATE TYPE post_status AS ENUM ('draft', 'published');
CREATE TABLE authors (
  id serial PRIMARY KEY,
  name text NOT NULL,
  email varchar NOT NULL UNIQUE,
  role author_role NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  deleted_at timestamptz
);
CREATE TABLE posts (
  id serial PRIMARY KEY,
  title text NOT NULL,
  author_id integer NOT NULL REFERENCES authors(id),
  status post_status NOT NULL,
  external_id uuid NOT NULL DEFAULT gen_random_uuid(),
  published_at timestamptz,
  views integer NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  deleted_at timestamptz
);
CREATE TABLE comments (
  uid serial PRIMARY KEY,
  body text NOT NULL,
  author_id integer NOT NULL REFERENCES authors(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  deleted_at timestamptz
);
CREATE TABLE notes (
  id serial PRIMARY KEY,
  body text NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  deleted_at timestamptz
);
`;

// 3 authors, 30 posts (10 each, round robin). Posts 1-15 are published on
// 2024-01-01 .. 2024-01-15, posts 16-30 are drafts with no published_at. views
// is n % 5, so a sort on it has plenty of ties.
const SEED = `
INSERT INTO authors (name, email, role) VALUES
  ('Ann', 'ann@x.io', 'admin'),
  ('Bob', 'bob@x.io', 'writer'),
  ('Cy', 'cy@x.io', 'writer');
INSERT INTO posts (title, author_id, status, published_at, views, external_id)
SELECT 'Post ' || n, ((n - 1) % 3) + 1,
  (CASE WHEN n <= 15 THEN 'published' ELSE 'draft' END)::post_status,
  CASE WHEN n <= 15 THEN timestamptz '2024-01-01 00:00:00+00' + (n - 1) * interval '1 day' END,
  n % 5,
  ('00000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid
FROM generate_series(1, 30) AS n;
INSERT INTO comments (body, author_id) VALUES ('first', 1), ('second', 2);
INSERT INTO notes (body) VALUES ('hello');
`;

// Every database is closed after the run, so Jest exits without open handles.
const clients: PGlite[] = [];
afterAll(async () => {
	await Promise.all(clients.map((client) => client.close()));
});

async function freshDb(): Promise<any> {
	const client = await PGlite.create();
	clients.push(client);
	await client.exec(DDL);
	await client.exec(SEED);
	return drizzle(client);
}

// Read-only tests share one database. Anything that writes calls freshDb().
let shared: Promise<any> | undefined;
function sharedDb(): Promise<any> {
	shared ??= freshDb();
	return shared;
}

class Svc extends SqlBaseCrudService<any, any, any, any> {}

const base = (db: any, table: any): SqlCrudConfig => ({
	dialect: "postgresql",
	db,
	table,
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
});

function postsService(db: any, overrides: Partial<SqlCrudConfig> = {}) {
	return new Svc({
		...base(db, posts),
		relations: { author: { table: authors, localKey: "author_id" } },
		...overrides,
	});
}

function authorsService(db: any) {
	return new Svc(base(db, authors));
}

// Resolves to the thrown error so its type and HTTP status can be asserted.
async function caught(promise: Promise<unknown>): Promise<any> {
	try {
		await promise;
	} catch (error) {
		return error;
	}
	throw new Error("expected the call to throw");
}

async function expect400(promise: Promise<unknown>): Promise<any> {
	const error = await caught(promise);
	expect(error).toBeInstanceOf(BadRequestException);
	expect((error as HttpException).getStatus()).toBe(400);
	return error;
}

describe("BUG-01: string filters on non-text columns", () => {
	it("filters an integer column by a string, as a query string sends it", async () => {
		const svc = postsService(await sharedDb());
		const res = await svc.findAll({ author_id: "1" });
		expect(res.total).toBe(10);
		expect(res.data.every((p: any) => p.author_id === 1)).toBe(true);
	});

	it("filters a uuid column by a string", async () => {
		const svc = postsService(await sharedDb());
		const res = await svc.findAll({
			external_id: "00000000-0000-0000-0000-000000000007",
		});
		expect(res.data.map((p: any) => p.id)).toEqual([7]);
	});

	it("filters an enum column by a string", async () => {
		const svc = postsService(await sharedDb());
		expect((await svc.findAll({ status: "published" })).total).toBe(15);
	});

	it("filters a belongs-to enum column by a string", async () => {
		const svc = postsService(await sharedDb());
		expect((await svc.findAll({ author: { role: "admin" } })).total).toBe(10);
	});

	it("keeps text columns case-insensitive", async () => {
		const svc = postsService(await sharedDb());
		expect((await svc.findAll({ title: "POST 7" })).total).toBe(1);
	});
});

describe("BUG-02: date strings on timestamp columns", () => {
	it("accepts an ISO string in a range filter", async () => {
		const svc = postsService(await sharedDb());
		const res = await svc.findAll({
			published_at: { gt: "2000-01-01T00:00:00Z" },
		});
		expect(res.total).toBe(15);
	});

	it("accepts a date string for equality", async () => {
		const svc = postsService(await sharedDb());
		const res = await svc.findAll({ published_at: "2024-01-03T00:00:00Z" });
		expect(res.data.map((p: any) => p.id)).toEqual([3]);
	});

	it("answers an invalid date with a 400", async () => {
		const svc = postsService(await sharedDb());
		await expect400(svc.findAll({ published_at: { gte: "garbage" } }));
	});
});

describe("BUG-03: soft-deleted belongs-to parent", () => {
	it("drops the deleted parent from an eager join", async () => {
		const db = await freshDb();
		await authorsService(db).softDelete(2);
		const svc = postsService(db);
		const post = await svc.find(2, { relations: ["author"] });
		expect(post?.author_id).toBe(2);
		expect(post?.author).toBeNull();
	});

	it("does not match a deleted parent in a relation filter", async () => {
		const db = await freshDb();
		await authorsService(db).softDelete(2);
		const res = await postsService(db).findAll({ author: { name: "Bob" } });
		expect(res.total).toBe(0);
		expect(res.data).toEqual([]);
	});
});

describe("BUG-04: findOne with no usable condition", () => {
	it("rejects a where object whose only value is undefined", async () => {
		const svc = authorsService(await sharedDb());
		await expect400(svc.findOne({ email: undefined }));
	});

	it("rejects an empty where object", async () => {
		const svc = authorsService(await sharedDb());
		await expect400(svc.findOne({}));
	});

	it("rejects an unknown column", async () => {
		const svc = authorsService(await sharedDb());
		await expect400(svc.findOne({ emial: "ann@x.io" } as any));
	});

	it("treats null as IS NULL", async () => {
		const svc = postsService(await sharedDb());
		const post = await svc.findOne({ published_at: null, author_id: 1 });
		expect(post?.published_at).toBeNull();
		expect(post?.id).toBeGreaterThan(15);
	});

	it("still finds by equality", async () => {
		const svc = authorsService(await sharedDb());
		expect((await svc.findOne({ email: "bob@x.io" }))?.id).toBe(2);
	});
});

describe("BUG-05 / BUG-14: soft-delete and timestamp columns are checked at startup", () => {
	it("throws at construction when the configured column is not a key, naming the key to use", async () => {
		const db = await freshDb();
		expect(() => new Svc(base(db, notes))).toThrow(/deleted_at.*deletedAt/s);
	});

	it("throws for a missing timestamp key too", async () => {
		const db = await freshDb();
		expect(
			() =>
				new Svc({
					...base(db, notes),
					softDelete: { enabled: true, column: "deletedAt" },
				}),
		).toThrow(/updated_at|created_at/);
	});

	it("moves updatedAt on a camelCase schema once configured", async () => {
		const db = await freshDb();
		const svc = new Svc({
			...base(db, notes),
			softDelete: { enabled: true, column: "deletedAt" },
			timestamps: { createdAt: "createdAt", updatedAt: "updatedAt" },
		});
		const before = (await svc.find(1)).updatedAt as Date;
		await new Promise((resolve) => setTimeout(resolve, 5));
		const after = (await svc.update(1, { body: "changed" })).updatedAt as Date;
		expect(after.getTime()).toBeGreaterThan(before.getTime());
		expect((await svc.findAll()).total).toBe(1);
	});
});

describe("BUG-07 / BUG-08: bulk failures", () => {
	it("reports only the item that failed, then rolls everything back", async () => {
		const db = await freshDb();
		const svc = authorsService(db);
		const error = await caught(
			svc.massCreate([
				{ name: "D", email: "d@x.io", role: "writer" },
				{ name: "Dup", email: "ann@x.io", role: "writer" },
				{ name: "E", email: "e@x.io", role: "writer" },
				{ name: "F", email: "f@x.io", role: "writer" },
			]),
		);
		expect(error).toBeInstanceOf(BulkOperationException);
		expect(error.errors.map((e: any) => e.index)).toEqual([1]);
		expect((await svc.findAll()).total).toBe(3);
	});

	it("puts each per-item error in the HTTP response body", async () => {
		const db = await freshDb();
		const svc = authorsService(db);
		const error = await caught(
			svc.massCreate([
				{ name: "D", email: "d@x.io", role: "writer" },
				{ name: "Dup", email: "ann@x.io", role: "writer" },
			]),
		);
		const body = (error as HttpException).getResponse() as any;
		expect(body.statusCode).toBe(400);
		expect(body.message).toContain("1 error");
		expect(body.errors).toEqual([
			{ index: 1, status: 409, message: expect.stringContaining("ann@x.io") },
		]);
	});

	it("keys update errors by id with the item's own status", async () => {
		const db = await freshDb();
		const svc = authorsService(db);
		const error = await caught(svc.massUpdate([1, 999, 2], { name: "Z" }));
		const body = (error as HttpException).getResponse() as any;
		expect(body.errors).toEqual([
			{ id: 999, status: 404, message: expect.any(String) },
		]);
		expect((await svc.find(1))?.name).toBe("Ann");
	});

	it("still commits when every item succeeds", async () => {
		const db = await freshDb();
		const svc = authorsService(db);
		await svc.massSoftDelete([2, 3]);
		expect((await svc.findAll()).total).toBe(1);
		await svc.massRestore([2, 3]);
		expect((await svc.findAll()).total).toBe(3);
	});
});

describe("BUG-09: isNull honours its value", () => {
	it("isNull: false means IS NOT NULL", async () => {
		const svc = postsService(await sharedDb());
		const res = await svc.findAll({ published_at: { isNull: false } });
		expect(res.total).toBe(15);
		expect(res.data.every((p: any) => p.published_at !== null)).toBe(true);
	});

	it('accepts "true" and "false" from a query string', async () => {
		const svc = postsService(await sharedDb());
		expect(
			(await svc.findAll({ published_at: { isNull: "false" } })).total,
		).toBe(15);
		expect(
			(await svc.findAll({ published_at: { isNull: "true" } })).total,
		).toBe(15);
		expect(
			(await svc.findAll({ published_at: { isNotNull: "false" } })).total,
		).toBe(15);
	});

	it("rejects anything else with a 400", async () => {
		const svc = postsService(await sharedDb());
		await expect400(svc.findAll({ published_at: { isNull: "maybe" } }));
	});
});

describe("BUG-10: unknown filters are rejected, not dropped", () => {
	it("supports eq", async () => {
		const svc = postsService(await sharedDb());
		expect((await svc.findAll({ title: { eq: "no such" } })).total).toBe(0);
		expect((await svc.findAll({ author_id: { eq: 2 } })).total).toBe(10);
	});

	it("treats a Date as a value", async () => {
		const svc = postsService(await sharedDb());
		const res = await svc.findAll({
			published_at: new Date("2024-01-02T00:00:00Z"),
		});
		expect(res.data.map((p: any) => p.id)).toEqual([2]);
	});

	it("rejects an unknown column", async () => {
		const svc = postsService(await sharedDb());
		await expect400(svc.findAll({ titel: "Post 1" }));
		await expect400(svc.count({ titel: "Post 1" }));
	});

	it("rejects an unknown column inside a relation filter", async () => {
		const svc = postsService(await sharedDb());
		await expect400(svc.findAll({ author: { nmae: "Bob" } }));
	});

	it("rejects an unknown operator", async () => {
		const svc = postsService(await sharedDb());
		await expect400(svc.findAll({ views: { between: [1, 2] } }));
	});
});

describe("BUG-11: bad input is a 400 on every path", () => {
	it("find() with a non-integer id", async () => {
		const svc = postsService(await sharedDb());
		await expect400(svc.find("abc"));
	});

	it("findAll() with a non-integer filter value", async () => {
		const svc = postsService(await sharedDb());
		await expect400(svc.findAll({ author_id: "abc" }));
	});

	it("an enum value that does not exist", async () => {
		const svc = postsService(await sharedDb());
		await expect400(svc.findAll({ status: "archived" }));
	});

	it("fullTextSearch() on an unknown column", async () => {
		const svc = postsService(await sharedDb());
		await expect400(svc.fullTextSearch("hello", ["nope"]));
	});

	it("update() with nothing to set", async () => {
		const svc = authorsService(await sharedDb());
		await expect400(svc.update(1, {}));
	});
});

describe("BUG-12: fullTextSearch always paginates", () => {
	it("returns at most the default limit and runs the count", async () => {
		const svc = postsService(await sharedDb());
		const res = await svc.fullTextSearch("post", ["title"]);
		expect(res.limit).toBe(20);
		expect(res.data).toHaveLength(20);
		expect(res.total).toBe(30);
	});
});

describe("BUG-13: a partial pagination override keeps the other half", () => {
	const viaModule = (db: any, defaults: any, config: any = {}) => {
		const { providers } = DrizzleCrudModule.forFeature([
			{ service: Svc, table: posts, config },
		]) as any;
		return providers[0].useFactory(db, {
			dialect: "postgresql",
			defaults: { softDelete: true, timestamps: true, ...defaults },
			sql: { caseSensitive: false, useReturning: true },
		}) as Svc;
	};

	it("per entity: defaultLimit only", async () => {
		const svc = viaModule(
			await freshDb(),
			{},
			{
				pagination: { defaultLimit: 5 },
			},
		);
		const res = await svc.findAll();
		expect(res.limit).toBe(5);
		expect(res.data).toHaveLength(5);
		expect((await svc.findAll({}, { limit: 500 })).limit).toBe(100);
	});

	it("project wide: defaultLimit only", async () => {
		const svc = viaModule(await freshDb(), {
			pagination: { defaultLimit: 5 },
		});
		expect((await svc.findAll()).data).toHaveLength(5);
	});

	it("per entity: a partial sql override keeps the defaults", async () => {
		const svc = viaModule(
			await freshDb(),
			{},
			{
				sql: { caseSensitive: true },
			},
		);
		expect((await svc.findAll({ title: "POST 7" })).total).toBe(0);
		// useReturning survived the merge, so create returns the row.
		const created = await svc.create({
			title: "New",
			author_id: 1,
			status: "draft",
			views: 0,
		});
		expect(created.id).toBe(31);
	});
});

describe("BUG-18: a stable sort order", () => {
	it("breaks ties on a non-unique sort column by primary key", async () => {
		const svc = postsService(await sharedDb());
		const res = await svc.findAll(
			{},
			{ sortBy: "views", sortOrder: "asc", limit: 6 },
		);
		// views = n % 5: 0 for ids 5, 10, 15, 20, 25, 30.
		expect(res.data.map((p: any) => p.id)).toEqual([5, 10, 15, 20, 25, 30]);
	});

	it("orders by primary key when nothing else is configured", async () => {
		const svc = postsService(await sharedDb());
		const page2 = await svc.findAll({}, { page: 2, limit: 5 });
		expect(page2.data.map((p: any) => p.id)).toEqual([6, 7, 8, 9, 10]);
	});
});

describe("BUG-19: a row lock with an eager belongs-to", () => {
	it("locks only the base table", async () => {
		const db = await sharedDb();
		const svc = postsService(db);
		const post = await db.transaction((tx: any) =>
			svc.find(1, { transaction: tx, lock: "update", relations: ["author"] }),
		);
		expect(post.author.name).toBe("Ann");
		const page = await db.transaction((tx: any) =>
			svc.findAll(
				{ author: { name: "Ann" } },
				{ limit: 2 },
				{ transaction: tx, lock: "share" },
			),
		);
		expect(page.total).toBe(10);
	});
});

describe("BUG-20: nested collections key on their own table", () => {
	it("loads author.posts under a comment whose primary key is uid", async () => {
		const db = await sharedDb();
		const svc = new Svc({
			...base(db, comments),
			primaryKey: "uid",
			relations: {
				author: {
					table: authors,
					localKey: "author_id",
					relations: {
						posts: { table: posts, type: "hasMany", foreignKey: "author_id" },
					},
				},
			},
		});
		const comment = await svc.find(1, {
			relations: ["author", "author.posts"],
		});
		expect(comment.author.name).toBe("Ann");
		expect(comment.author.posts).toHaveLength(10);
	});
});
