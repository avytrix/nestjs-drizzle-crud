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
import { afterAll, describe, expect, it, jest } from "@jest/globals";
import { BadRequestException, HttpException } from "@nestjs/common";
import {
	bigint,
	boolean,
	integer,
	jsonb,
	numeric,
	pgEnum,
	pgTable,
	serial,
	text,
	timestamp,
	uuid,
	varchar,
} from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/pglite";
import { Test } from "@nestjs/testing";
import { SqlBaseCrudService } from "../src/core/abstract/sql-base-crud.service";
import { CrudContext } from "../src/core/context/crud-context";
import { CrudEventBus } from "../src/core/events/crud-event-bus";
import type { CrudEvent } from "../src/core/interfaces/events.interface";
import { parseCrudQuery } from "../src/core/utils/query-parser";
import type { SqlCrudConfig } from "../src/core/interfaces/sql-crud-config.interface";
import {
	BulkOperationException,
	MissingScopeException,
	StaleVersionException,
} from "../src/exceptions/crud.exceptions";
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

// Column types the query parser coerces and the Postgres-only operators need.
// `rank` is nullable, for keyset pages over NULLs.
const items = pgTable("items", {
	id: serial("id").primaryKey(),
	name: text("name").notNull(),
	labels: text("labels").array().notNull(),
	meta: jsonb("meta").notNull(),
	active: boolean("active").notNull(),
	big: bigint("big", { mode: "bigint" }).notNull(),
	price: numeric("price").notNull(),
	rank: integer("rank"),
	sku: varchar("sku").notNull().unique(),
});

// 3.5.0 fixtures: a geo chain for relation paths, tags linked to posts
// through a join table, and a tenant-scoped, versioned docs table.
const geoCountries = pgTable("geo_countries", {
	id: serial("id").primaryKey(),
	code: text("code").notNull(),
});
const geoStates = pgTable("geo_states", {
	id: serial("id").primaryKey(),
	name: text("name").notNull(),
	country_id: integer("country_id").notNull(),
});
const geoCities = pgTable("geo_cities", {
	id: serial("id").primaryKey(),
	name: text("name").notNull(),
	state_id: integer("state_id").notNull(),
});
const tags = pgTable("tags", {
	id: serial("id").primaryKey(),
	name: text("name").notNull().unique(),
	deleted_at: timestamp("deleted_at", { withTimezone: true }),
});
const postTags = pgTable("post_tags", {
	post_id: integer("post_id").notNull(),
	tag_id: integer("tag_id").notNull(),
});
const docs = pgTable("docs", {
	id: serial("id").primaryKey(),
	tenant_id: integer("tenant_id").notNull(),
	title: text("title").notNull(),
	slug: text("slug").notNull().unique(),
	version: integer("version").notNull().default(1),
	...stamps,
});
const docNotes = pgTable("doc_notes", {
	id: serial("id").primaryKey(),
	doc_id: integer("doc_id").notNull(),
	tenant_id: integer("tenant_id"),
	body: text("body").notNull(),
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
CREATE TABLE items (
  id serial PRIMARY KEY,
  name text NOT NULL,
  labels text[] NOT NULL,
  meta jsonb NOT NULL,
  active boolean NOT NULL,
  big bigint NOT NULL,
  price numeric NOT NULL,
  rank integer,
  sku varchar NOT NULL UNIQUE
);
CREATE TABLE geo_countries (id serial PRIMARY KEY, code text NOT NULL);
CREATE TABLE geo_states (
  id serial PRIMARY KEY,
  name text NOT NULL,
  country_id integer NOT NULL REFERENCES geo_countries(id)
);
CREATE TABLE geo_cities (
  id serial PRIMARY KEY,
  name text NOT NULL,
  state_id integer NOT NULL REFERENCES geo_states(id)
);
CREATE TABLE tags (
  id serial PRIMARY KEY,
  name text NOT NULL UNIQUE,
  deleted_at timestamptz
);
CREATE TABLE post_tags (
  post_id integer NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  tag_id integer NOT NULL REFERENCES tags(id),
  PRIMARY KEY (post_id, tag_id)
);
CREATE TABLE docs (
  id serial PRIMARY KEY,
  tenant_id integer NOT NULL,
  title text NOT NULL,
  slug text NOT NULL UNIQUE,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  deleted_at timestamptz
);
CREATE TABLE doc_notes (
  id serial PRIMARY KEY,
  doc_id integer NOT NULL REFERENCES docs(id) ON DELETE CASCADE,
  tenant_id integer,
  body text NOT NULL
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
INSERT INTO items (name, labels, meta, active, big, price, rank, sku) VALUES
  ('50% off_sale', '{red,blue}', '{"size": "L", "tags": ["a"]}', true, 9007199254740993, 10.50, 2, 'A1'),
  ('Back\\slash', '{blue}', '{"size": "M"}', false, 1, 3.25, NULL, 'A2'),
  ('plain', '{green}', '{"size": "L"}', true, 2, 100, 1, 'A3'),
  ('Plain upper', '{}', '{}', false, 3, 0, NULL, 'A4');
INSERT INTO geo_countries (code) VALUES ('IN'), ('NP');
INSERT INTO geo_states (name, country_id) VALUES
  ('Karnataka', 1), ('Kerala', 1), ('Bagmati', 2);
INSERT INTO geo_cities (name, state_id) VALUES
  ('Bengaluru', 1), ('Mysuru', 1), ('Kochi', 2), ('Kathmandu', 3);
INSERT INTO tags (name) VALUES ('news'), ('tech'), ('old');
UPDATE tags SET deleted_at = now() WHERE name = 'old';
-- Post 1: news + tech, post 2: news, post 3: the deleted tag only.
INSERT INTO post_tags (post_id, tag_id) VALUES (1, 1), (1, 2), (2, 1), (3, 3);
-- Docs 1-3 belong to tenant 1, docs 4-5 to tenant 2.
INSERT INTO docs (tenant_id, title, slug) VALUES
  (1, 'One', 'one'), (1, 'Two', 'two'), (1, 'Three', 'three'),
  (2, 'Four', 'four'), (2, 'Five', 'five');
INSERT INTO doc_notes (doc_id, tenant_id, body) VALUES (1, 1, 'n1'), (4, 2, 'n4');
`;

// Every database is closed after the run, so Jest exits without open handles.
const clients: PGlite[] = [];
afterAll(async () => {
	await Promise.all(clients.map((client) => client.close()));
});

async function freshDb(log?: string[]): Promise<any> {
	const client = await PGlite.create();
	clients.push(client);
	await client.exec(DDL);
	await client.exec(SEED);
	return drizzle(
		client,
		log ? { logger: { logQuery: (query) => log.push(query) } } : {},
	);
}

// A fresh database that records every statement Drizzle sends. `statements`
// counts the data statements only (SELECT, INSERT, UPDATE, DELETE), not BEGIN
// or SAVEPOINT.
async function countingDb() {
	const log: string[] = [];
	const db = await freshDb(log);
	return {
		db,
		reset: () => {
			log.length = 0;
		},
		statements: () =>
			log.filter((query) => /^\s*(select|insert|update|delete)\b/i.test(query)),
	};
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
		// `between` was the example here until 3.4.0 made it an operator.
		await expect400(svc.findAll({ views: { roughly: 2 } }));
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

// ---------------------------------------------------------------------------
// 3.4.0 features. Same rules as above: real SQL, one fresh database per test
// that writes.
// ---------------------------------------------------------------------------

function itemsService(db: any, overrides: Partial<SqlCrudConfig> = {}) {
	return new Svc({
		...base(db, items),
		softDelete: { enabled: false, column: "deleted_at" },
		timestamps: undefined,
		...overrides,
	});
}

function authorsWithPosts(db: any) {
	return new Svc({
		...base(db, authors),
		relations: {
			posts: { table: posts, type: "hasMany", foreignKey: "author_id" },
		},
	});
}

const ids = (res: { data: any[] }) => res.data.map((row: any) => row.id);

describe("M01: parseCrudQuery", () => {
	const parse = (query: Record<string, unknown>, options = {}) =>
		parseCrudQuery(query, posts, {
			relations: { author: { table: authors, localKey: "author_id" } },
			...options,
		});

	it("coerces values by column type and the service runs them", async () => {
		const q = parse({
			"views[gte]": "3",
			author_id: "1",
			"published_at[lt]": "2024-01-05",
		});
		expect(q.filters).toEqual({
			views: { gte: 3 },
			author_id: 1,
			published_at: { lt: new Date("2024-01-05") },
		});
		const svc = postsService(await sharedDb());
		// author 1 has posts 1, 4, 7, ...; published before Jan 5: 1 and 4;
		// views = n % 5 >= 3 keeps 4 only.
		expect(ids(await svc.findAll(q.filters, q.pagination, q.options))).toEqual([
			4,
		]);
	});

	it("coerces booleans, bigints, numerics and array operands", async () => {
		const q = parseCrudQuery(
			{
				active: "true",
				"big[eq]": "9007199254740993",
				"price[gte]": "10.5",
				"labels[arrayContains]": "red,blue",
			},
			items,
		);
		expect(q.filters).toEqual({
			active: true,
			big: { eq: 9007199254740993n },
			price: { gte: "10.5" },
			labels: { arrayContains: ["red", "blue"] },
		});
		const svc = itemsService(await sharedDb());
		expect((await svc.findAll(q.filters)).data.map((i: any) => i.sku)).toEqual([
			"A1",
		]);
	});

	it("reads qs-style nested objects the same as bracket keys", () => {
		const flat = parse({ "views[gte]": "2", "author[name]": "Bob" });
		const nested = parse({ views: { gte: "2" }, author: { name: "Bob" } });
		expect(nested.filters).toEqual(flat.filters);
		expect(parse({ "author.name": "Bob" }).filters).toEqual({
			author: { name: "Bob" },
		});
	});

	it("turns repeated keys and in/notIn/between lists into arrays", () => {
		expect(
			parse({
				views: ["1", "2"],
				"author_id[notIn]": "2,3",
				"id[between]": "1,5",
			}).filters,
		).toEqual({
			views: [1, 2],
			author_id: { notIn: [2, 3] },
			id: { between: [1, 5] },
		});
	});

	it("answers bad values, unknown columns and unknown operators with a 400", () => {
		for (const query of [
			{ "views[gte]": "abc" },
			{ "published_at[gt]": "garbage" },
			{ titel: "x" },
			{ "views[roughly]": "2" },
			{ "author[nmae]": "Bob" },
			{ "id[between]": "1" },
			{ page: "0" },
			{ limit: "ten" },
			{ sortBy: "nope" },
			{ sortOrder: "up" },
			{ fields: "id,secret" },
			{ with: "editor" },
			{ search: "x" },
			{ withDeleted: "true" },
			{ "__proto__[x]": "1" },
		]) {
			expect(() => parse(query)).toThrow(BadRequestException);
		}
		expect(() => parseCrudQuery({ active: "maybe" }, items)).toThrow(
			BadRequestException,
		);
	});

	it("parses sort, pagination, fields, relations, search and trash flags", () => {
		const q = parse(
			{
				sortBy: "-views,author.name",
				page: "2",
				limit: "5",
				fields: "id,title,author.name",
				with: "author",
				search: " post ",
				withDeleted: "true",
			},
			{ searchColumns: ["title"], allowTrash: true },
		);
		expect(q.sort).toEqual([
			{ column: "views", order: "desc" },
			{ column: "author.name", order: "asc" },
		]);
		expect(q.pagination).toEqual({ page: 2, limit: 5, sortBy: q.sort });
		expect(q.options).toEqual({
			select: ["id", "title", "author.name"],
			relations: ["author"],
			search: { term: "post", columns: ["title"] },
			withDeleted: true,
		});
		expect(q.isCursor).toBe(false);
		expect(parse({ cursor: "" }).pagination.cursor).toBeNull();
		expect(parse({ after: "abc", count: "true" }).pagination).toEqual({
			cursor: "abc",
			count: true,
		});
	});

	it("parses or / not groups, relations included", async () => {
		const q = parse({
			"or[0][status]": "draft",
			"or[1][author][name]": "Bob",
			"not[views]": "0",
		});
		expect(q.filters).toEqual({
			or: [{ status: "draft" }, { author: { name: "Bob" } }],
			not: { views: 0 },
		});
		const svc = postsService(await sharedDb());
		// drafts (16..30) or Bob's (2, 5, ..., 29): 20 posts, minus views 0.
		const res = await svc.findAll(q.filters, { limit: 100 });
		expect(res.total).toBe(16);
	});

	it("service.parseQuery uses the entity's relations and allowlists", async () => {
		const svc = postsService(await sharedDb(), {
			filterableColumns: ["status"],
		});
		expect(svc.parseQuery({ status: "draft" }).filters).toEqual({
			status: "draft",
		});
		expect(() => svc.parseQuery({ views: "1" })).toThrow(BadRequestException);
	});
});

describe("M02: allowlists", () => {
	const locked = async () =>
		postsService(await sharedDb(), {
			filterableColumns: ["status", "author.name"],
			sortableColumns: ["title", "author.name"],
			selectableColumns: ["title", "author.name"],
			searchableColumns: ["title"],
			loadableRelations: ["author"],
		});

	it("allows what is listed", async () => {
		const svc = await locked();
		const res = await svc.findAll(
			{ status: "published", author: { name: "Ann" } },
			{ sortBy: ["author.name", "-title"], limit: 3 },
			{
				select: ["id", "title", "author.name"],
				relations: ["author"],
				search: { term: "post", columns: ["title"] },
			},
		);
		expect(res.total).toBe(5);
		expect(Object.keys(res.data[0]).sort()).toEqual(["author", "id", "title"]);
	});

	it("rejects anything else with a 400, in the service and the parser", async () => {
		const svc = await locked();
		await expect400(svc.findAll({ views: 1 }));
		await expect400(svc.count({ author: { role: "admin" } }));
		await expect400(svc.findAll({ or: [{ views: 1 }] }));
		await expect400(svc.findAll({}, { sortBy: "views" }));
		await expect400(svc.findAll({}, {}, { select: ["views"] }));
		await expect400(svc.find(1, { select: ["author_id"] }));
		await expect400(
			svc.findAll({}, {}, { search: { term: "x", columns: ["status"] } }),
		);
		await expect400(svc.fullTextSearch("post", ["status"]));
		await expect400(svc.findByCursor({}, { sortBy: "views" }));
		for (const query of [
			{ views: "1" },
			{ sortBy: "views" },
			{ fields: "views" },
			{ "author[role]": "admin" },
		]) {
			expect(() => svc.parseQuery(query)).toThrow(BadRequestException);
		}
	});

	it("always allows the primary key in select and sort", async () => {
		const svc = await locked();
		const res = await svc.findAll(
			{},
			{ sortBy: "-id", limit: 1 },
			{ select: ["id"] },
		);
		expect(res.data).toEqual([{ id: 30 }]);
	});

	it("lets a trusted call skip the lists", async () => {
		const svc = await locked();
		expect(await svc.count({ views: 0 }, { skipAllowlists: true })).toBe(6);
	});

	it("rejects an unlisted relation", async () => {
		const db = await sharedDb();
		const svc = new Svc({
			...base(db, authors),
			relations: {
				posts: { table: posts, type: "hasMany", foreignKey: "author_id" },
			},
			loadableRelations: [],
		});
		await expect400(svc.find(1, { relations: ["posts"] }));
	});

	it("ignores managed columns in a body by default", async () => {
		const db = await freshDb();
		const svc = authorsService(db);
		const created = await svc.create({
			name: "D",
			email: "d@x.io",
			role: "writer",
			deleted_at: new Date(),
		});
		expect(created.deleted_at).toBeNull();
		const updated = await svc.update(created.id, {
			id: 999,
			name: "Dee",
			created_at: new Date("2000-01-01"),
		});
		expect(updated.id).toBe(created.id);
		expect(updated.name).toBe("Dee");
		expect(updated.created_at.getTime()).toBe(created.created_at.getTime());
		await expect400(svc.update(created.id, { id: 5 }));
	});

	it("writableColumns rejects any other column with a 400", async () => {
		const db = await freshDb();
		const svc = new Svc({
			...base(db, authors),
			writableColumns: ["name", "email", "role"],
		});
		await expect400(
			svc.create({ name: "D", email: "d@x.io", role: "admin", id: 50 }),
		);
		await expect400(svc.update(1, { name: "A", deleted_at: null }));
		expect((await svc.update(1, { name: "A" })).name).toBe("A");
		await expect400(svc.massUpdate([1, 2], { role: "admin", id: 7 }));
	});
});

describe("M03: trash view and purge", () => {
	it("lists deleted rows with onlyDeleted and everything with withDeleted", async () => {
		const db = await freshDb();
		const svc = postsService(db);
		await svc.massSoftDelete([1, 2]);
		expect((await svc.findAll()).total).toBe(28);
		const trash = await svc.findAll({}, {}, { onlyDeleted: true });
		expect(ids(trash)).toEqual([1, 2]);
		expect((await svc.findAll({}, {}, { withDeleted: true })).total).toBe(30);
		expect(await svc.count({ author_id: 1 }, { onlyDeleted: true })).toBe(1);
		expect(await svc.find(1)).toBeNull();
		expect((await svc.find(1, { withDeleted: true }))?.id).toBe(1);
		expect(
			(await svc.findOne({ title: "Post 2" }, { onlyDeleted: true }))?.id,
		).toBe(2);
		expect(await svc.exists(2, { withDeleted: true })).toBe(true);
	});

	it("forceDelete hard-deletes a soft-deleted row; delete still 404s on it", async () => {
		const db = await freshDb();
		const svc = postsService(db);
		await svc.softDelete(3);
		const notFound = await caught(svc.delete(3));
		expect((notFound as HttpException).getStatus()).toBe(404);
		expect(await svc.forceDelete(3)).toBe(true);
		expect(await svc.find(3, { withDeleted: true })).toBeNull();
		expect(await svc.forceDelete(4)).toBe(true);
	});

	it("massForceDelete purges deleted and live rows in one statement", async () => {
		const { db, reset, statements } = await countingDb();
		const svc = postsService(db);
		await svc.softDelete(5);
		reset();
		await svc.massForceDelete([5, 6]);
		expect(statements()).toHaveLength(2);
		expect((await svc.findAll({}, {}, { withDeleted: true })).total).toBe(28);
	});

	it("onlyDeleted on an entity without soft delete is a 400", async () => {
		const svc = itemsService(await sharedDb());
		await expect400(svc.findAll({}, {}, { onlyDeleted: true }));
	});
});

describe("M04: set-based bulk writes", () => {
	const ten = Array.from({ length: 10 }, (_, i) => i + 1);

	it("massUpdate is one SELECT and one UPDATE for ten ids", async () => {
		const { db, reset, statements } = await countingDb();
		const svc = postsService(db);
		reset();
		const updated = await svc.massUpdate(ten, { title: "bulk" });
		expect(statements().map((q) => q.split(" ")[0])).toEqual([
			"select",
			"update",
		]);
		expect(updated.map((p: any) => p.id)).toEqual(ten);
		expect(updated.every((p: any) => p.title === "bulk")).toBe(true);
	});

	it("massCreate is one INSERT", async () => {
		const { db, reset, statements } = await countingDb();
		const svc = authorsService(db);
		reset();
		const created = await svc.massCreate(
			ten.map((n) => ({ name: `N${n}`, email: `n${n}@x.io`, role: "writer" })),
		);
		expect(statements()).toHaveLength(1);
		expect(created.map((a: any) => a.name)).toEqual(ten.map((n) => `N${n}`));
	});

	it("soft delete, restore and delete are two statements each", async () => {
		const { db, reset, statements } = await countingDb();
		const svc = postsService(db);
		for (const run of [
			() => svc.massSoftDelete(ten),
			() => svc.massRestore(ten),
			() => svc.massDelete(ten),
		]) {
			reset();
			await run();
			expect(statements()).toHaveLength(2);
		}
		expect((await svc.findAll({}, {}, { withDeleted: true })).total).toBe(20);
	});

	it("names the item that clashes with another item of the same batch", async () => {
		const db = await freshDb();
		const svc = authorsService(db);
		const error = await caught(
			svc.massCreate([
				{ name: "D", email: "d@x.io", role: "writer" },
				{ name: "E", email: "e@x.io", role: "writer" },
				{ name: "D2", email: "d@x.io", role: "writer" },
			]),
		);
		const body = (error as HttpException).getResponse() as any;
		expect(body.errors).toEqual([
			{ index: 2, status: 409, message: expect.stringContaining("d@x.io") },
		]);
		expect(await svc.count()).toBe(3);
	});

	it("reports a delete blocked by dependent rows as a 409 for that id", async () => {
		const db = await freshDb();
		const svc = authorsService(db);
		const free = await svc.create({
			name: "Z",
			email: "z@x.io",
			role: "writer",
		});
		const error = await caught(svc.massDelete([free.id, 1]));
		const body = (error as HttpException).getResponse() as any;
		expect(body.errors).toEqual([
			{ id: 1, status: 409, message: expect.any(String) },
		]);
		expect(await svc.exists(free.id)).toBe(true);
	});

	it("reports an id of the wrong type as a 400 for that id", async () => {
		const db = await freshDb();
		const error = await caught(
			postsService(db).massUpdate([1, "abc"], { title: "x" }),
		);
		const body = (error as HttpException).getResponse() as any;
		expect(body.errors).toEqual([
			{ id: "abc", status: 400, message: expect.any(String) },
		]);
	});

	it("leaves nothing behind inside a caller's transaction", async () => {
		const db = await freshDb();
		const svc = authorsService(db);
		await db.transaction(async (tx: any) => {
			await caught(
				svc.massCreate(
					[
						{ name: "D", email: "d@x.io", role: "writer" },
						{ name: "Dup", email: "ann@x.io", role: "writer" },
					],
					{ transaction: tx },
				),
			);
			expect(await svc.count({}, { transaction: tx })).toBe(3);
		});
		expect(await svc.count()).toBe(3);
	});

	it("runs hooks once per item", async () => {
		const db = await freshDb();
		const seen: any[] = [];
		class Hooked extends SqlBaseCrudService<any, any, any, any> {
			protected async beforeUpdate(id: any, data: any) {
				seen.push(id);
				return data;
			}
			protected async afterCreate(entity: any) {
				seen.push(entity.email);
			}
		}
		const svc = new Hooked(base(db, authors));
		await svc.massUpdate([1, 2, 2], { role: "admin" });
		await svc.massCreate([{ name: "D", email: "d@x.io", role: "writer" }]);
		expect(seen).toEqual([1, 2, "d@x.io"]);
	});

	it("writes each row on its own when a hook returns different data per id", async () => {
		const db = await freshDb();
		class PerId extends SqlBaseCrudService<any, any, any, any> {
			protected async beforeUpdate(id: any, data: any) {
				return { ...data, name: `${data.name}-${id}` };
			}
		}
		const svc = new PerId(base(db, authors));
		const rows = await svc.massUpdate([2, 1], { name: "X" });
		expect(rows.map((a: any) => a.name)).toEqual(["X-2", "X-1"]);
	});

	it('keeps the 3.3 behaviour with bulkMode: "perItem"', async () => {
		const { db, reset, statements } = await countingDb();
		const svc = postsService(db);
		reset();
		await svc.massUpdate([1, 2, 3], { title: "p" }, { bulkMode: "perItem" });
		expect(statements()).toHaveLength(6);
		const error = await caught(
			svc.massUpdate([1, 999], { title: "p" }, { bulkMode: "perItem" }),
		);
		expect(((error as HttpException).getResponse() as any).errors).toEqual([
			{ id: 999, status: 404, message: expect.any(String) },
		]);
	});
});

describe("M05: upsert", () => {
	it("updates the row that owns the conflict key, inserts otherwise", async () => {
		const db = await freshDb();
		const svc = authorsService(db);
		const updated = await svc.upsert(
			{ name: "Annie", email: "ann@x.io", role: "admin" },
			{ conflictTarget: "email" },
		);
		expect(updated.id).toBe(1);
		expect(updated.name).toBe("Annie");
		const inserted = await svc.upsert(
			{ name: "New", email: "new@x.io", role: "writer" },
			{ conflictTarget: "email" },
		);
		// The id is not 4: Postgres spent a sequence value on the first conflict.
		expect(inserted.id).toBeGreaterThan(3);
		expect(inserted.email).toBe("new@x.io");
		expect(await svc.count()).toBe(4);
	});

	it("overwrites only the listed columns", async () => {
		const db = await freshDb();
		const svc = authorsService(db);
		const row = await svc.upsert(
			{ name: "Ignored", email: "bob@x.io", role: "admin" },
			{ conflictTarget: "email", update: ["role"] },
		);
		expect([row.name, row.role]).toEqual(["Bob", "admin"]);
		const same = await svc.upsert(
			{ name: "Ignored", email: "bob@x.io", role: "writer" },
			{ conflictTarget: "email", update: [] },
		);
		expect([same.id, same.role]).toEqual([2, "admin"]);
	});

	it("maps a clash on another unique key to a 409 and bad input to a 400", async () => {
		const db = await freshDb();
		const svc = itemsService(db);
		const clash = await caught(
			svc.upsert(
				{
					id: 1,
					name: "x",
					labels: [],
					meta: {},
					active: true,
					big: 1n,
					price: "1",
					sku: "A2",
				},
				{ conflictTarget: "id" },
			),
		);
		expect((clash as HttpException).getStatus()).toBe(409);
		await expect400(
			authorsService(db).upsert(
				{ name: "x", email: "q@x.io", role: "boss" },
				{ conflictTarget: "email" },
			),
		);
		await expect400(
			authorsService(db).upsert(
				{ name: "x", email: "q@x.io", role: "admin" },
				{ conflictTarget: "nope" },
			),
		);
	});

	it("massUpsert is one statement; a key repeated in the batch is a 400", async () => {
		const { db, reset, statements } = await countingDb();
		const svc = authorsService(db);
		reset();
		const rows = await svc.massUpsert(
			[
				{ name: "Ann2", email: "ann@x.io", role: "admin" },
				{ name: "Eve", email: "eve@x.io", role: "writer" },
			],
			{ conflictTarget: "email" },
		);
		expect(statements()).toHaveLength(1);
		expect(rows.map((a: any) => a.email)).toEqual(["ann@x.io", "eve@x.io"]);
		expect(rows[0].id).toBe(1);
		await expect400(
			svc.massUpsert(
				[
					{ name: "A", email: "z@x.io", role: "admin" },
					{ name: "B", email: "z@x.io", role: "admin" },
				],
				{ conflictTarget: "email" },
			),
		);
		expect(await svc.count()).toBe(4);
	});
});

describe("M06: or / and / not groups", () => {
	it("ORs column filters", async () => {
		const svc = postsService(await sharedDb());
		// author 1: 10 posts; views 0: 6 posts; both: ids 10 and 25.
		const res = await svc.findAll({ or: [{ author_id: 1 }, { views: 0 }] });
		expect(res.total).toBe(14);
		expect(await svc.count({ or: [{ author_id: 1 }, { views: 0 }] })).toBe(14);
	});

	it("mixes a belongs-to relation into an or and a not", async () => {
		const svc = postsService(await sharedDb());
		const either = { or: [{ author: { name: "Bob" } }, { status: "draft" }] };
		expect((await svc.findAll(either)).total).toBe(20);
		expect(await svc.count(either)).toBe(20);
		expect(
			(await svc.findAll({ not: { author: { name: "Ann" } } })).total,
		).toBe(20);
	});

	it("works inside and around collection filters", async () => {
		const svc = authorsWithPosts(await sharedDb());
		const res = await svc.findAll({
			posts: { or: [{ title: "Post 1" }, { title: "Post 2" }] },
		});
		expect(ids(res)).toEqual([1, 2]);
		expect(
			(await svc.findAll({ not: { posts: { title: "Post 3" } } })).total,
		).toBe(2);
		expect(await svc.count({ not: { posts: { status: "draft" } } })).toBe(0);
	});

	it("nests", async () => {
		const svc = postsService(await sharedDb());
		const res = await svc.findAll({
			and: [
				{ or: [{ author_id: 1 }, { author_id: 2 }] },
				{ not: { or: [{ views: 0 }, { status: "draft" }] } },
			],
		});
		// published (1..15) by author 1 or 2, without views 0 (5, 10, 15).
		expect(ids(res)).toEqual([1, 2, 4, 7, 8, 11, 13, 14]);
	});

	it("rejects a malformed group", async () => {
		const svc = postsService(await sharedDb());
		await expect400(svc.findAll({ or: { status: "draft" } }));
		await expect400(svc.findAll({ not: [{ status: "draft" }] }));
		await expect400(svc.findAll({ or: [{ nope: 1 }] }));
	});
});

describe("M07: operators", () => {
	it("notIn and between", async () => {
		const svc = postsService(await sharedDb());
		expect((await svc.findAll({ views: { notIn: [0, 1] } })).total).toBe(18);
		expect((await svc.findAll({ views: { between: [1, 2] } })).total).toBe(12);
		const range = await svc.findAll({
			published_at: { between: ["2024-01-02", "2024-01-04"] },
		});
		expect(ids(range)).toEqual([2, 3, 4]);
		await expect400(svc.findAll({ views: { between: [1] } }));
		await expect400(svc.findAll({ views: { notIn: 1 } }));
	});

	it("escapes startsWith / endsWith / contains", async () => {
		const svc = itemsService(await sharedDb());
		const skus = async (filter: any) =>
			(await svc.findAll(filter)).data.map((i: any) => i.sku);
		expect(await skus({ name: { startsWith: "50%" } })).toEqual(["A1"]);
		expect(await skus({ name: { startsWith: "5_" } })).toEqual([]);
		expect(await skus({ name: { contains: "_" } })).toEqual(["A1"]);
		expect(await skus({ name: { contains: "\\" } })).toEqual(["A2"]);
		expect(await skus({ name: { endsWith: "SALE" } })).toEqual(["A1"]);
		expect(await skus({ name: { startsWith: "plain" } })).toEqual(["A3", "A4"]);
	});

	it("follows caseSensitive, and the i forms never do", async () => {
		const svc = itemsService(await sharedDb(), {
			sql: {
				caseSensitive: true,
				useReturning: true,
				jsonSupport: true,
				enableFullTextSearch: false,
			},
		});
		expect((await svc.findAll({ name: { startsWith: "plain" } })).total).toBe(
			1,
		);
		expect((await svc.findAll({ name: { iStartsWith: "plain" } })).total).toBe(
			2,
		);
		expect((await svc.findAll({ name: { iContains: "UPPER" } })).total).toBe(1);
	});

	it("array contains / overlaps and JSON contains on Postgres", async () => {
		const svc = itemsService(await sharedDb());
		expect(
			(await svc.findAll({ labels: { arrayContains: ["blue"] } })).total,
		).toBe(2);
		expect(
			(await svc.findAll({ labels: { arrayOverlaps: ["red", "green"] } }))
				.total,
		).toBe(2);
		expect(
			(await svc.findAll({ meta: { jsonContains: { size: "L" } } })).total,
		).toBe(2);
		expect(
			(await svc.findAll({ meta: { jsonContains: { tags: ["a"] } } })).total,
		).toBe(1);
	});

	it("answers an operator on the wrong column type or dialect with a 400", async () => {
		const db = await sharedDb();
		const svc = itemsService(db);
		await expect400(svc.findAll({ rank: { contains: "1" } }));
		await expect400(svc.findAll({ name: { arrayContains: ["x"] } }));
		await expect400(svc.findAll({ labels: { jsonContains: {} } }));
		const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
		const mysql = itemsService(db, { dialect: "mysql" });
		warn.mockRestore();
		await expect400(mysql.findAll({ labels: { arrayContains: ["red"] } }));
		await expect400(mysql.findAll({ meta: { jsonContains: {} } }));
	});
});

describe("M08: keyset (cursor) pagination", () => {
	// Every page of a cursor walk, concatenated.
	async function walk(svc: Svc, filters: any, pagination: any, options?: any) {
		const seen: any[] = [];
		let cursor: string | null = null;
		let pages = 0;
		do {
			const page: any = await svc.findByCursor(
				filters,
				{ ...pagination, cursor },
				options,
			);
			seen.push(...page.data);
			cursor = page.nextCursor;
			pages++;
		} while (cursor && pages < 50);
		return seen;
	}

	const sorts: any[] = [
		{},
		{ sortBy: "views", sortOrder: "asc" },
		{ sortBy: ["-views", "title"] },
		{ sortBy: "published_at", sortOrder: "desc" },
		{ sortBy: "published_at", sortOrder: "asc" },
		{ sortBy: ["created_at"] },
		{ sortBy: ["author.name", "-id"] },
	];

	it.each(sorts)(
		"walks every row once, in the findAll order (%j)",
		async (sort) => {
			const svc = postsService(await sharedDb());
			const all = await svc.findAll({}, { ...sort, limit: 100 });
			const walked = await walk(svc, {}, { ...sort, limit: 7 });
			expect(walked.map((p) => p.id)).toEqual(ids(all));
		},
	);

	it("walks nullable columns both ways", async () => {
		const svc = itemsService(await sharedDb());
		for (const sortOrder of ["asc", "desc"] as const) {
			const all = await svc.findAll({}, { sortBy: "rank", sortOrder });
			const walked = await walk(
				svc,
				{},
				{ sortBy: "rank", sortOrder, limit: 1 },
			);
			expect(walked.map((i) => i.id)).toEqual(ids(all));
		}
	});

	it("is stable when a row is inserted before the cursor", async () => {
		const db = await freshDb();
		const svc = postsService(db);
		const sort = { sortBy: "views", sortOrder: "asc" as const, limit: 5 };
		const first = await svc.findByCursor({}, sort);
		const before = await svc.findByCursor(
			{},
			{ ...sort, cursor: first.nextCursor },
		);
		// views -1 sorts before every row already shown.
		await svc.create({
			title: "New",
			author_id: 1,
			status: "draft",
			views: -1,
		});
		const after = await svc.findByCursor(
			{},
			{ ...sort, cursor: first.nextCursor },
		);
		expect(ids(after)).toEqual(ids(before));
		// The offset version shifts by one.
		const offset = await svc.findAll({}, { ...sort, page: 2 });
		expect(ids(offset)).not.toEqual(ids(before));
	});

	it("works with filters, relations, select and count", async () => {
		const svc = postsService(await sharedDb());
		const page = await svc.findByCursor(
			{ status: "published", author: { name: "Bob" } },
			{ sortBy: ["-views"], limit: 2, count: true },
			{ select: ["id", "title", "author.name"], relations: ["author"] },
		);
		expect(page.total).toBe(5);
		expect(page.data).toHaveLength(2);
		expect(Object.keys(page.data[0]).sort()).toEqual(["author", "id", "title"]);
		expect(page.data[0].author).toEqual({ name: "Bob" });
		const walked = await walk(
			svc,
			{ status: "published", author: { name: "Bob" } },
			{ sortBy: ["-views"], limit: 2 },
		);
		expect(walked).toHaveLength(5);
		const last: any = await svc.findByCursor({ id: 1 }, { limit: 5 });
		expect(last.nextCursor).toBeNull();
		expect(last.total).toBeUndefined();
	});

	it("rejects a cursor that is not one, or was made for another sort", async () => {
		const svc = postsService(await sharedDb());
		await expect400(svc.findByCursor({}, { cursor: "garbage" }));
		const page = await svc.findByCursor({}, { sortBy: "views", limit: 2 });
		await expect400(
			svc.findByCursor({}, { sortBy: "title", cursor: page.nextCursor }),
		);
		const forged = Buffer.from(
			JSON.stringify({ s: "id:asc", v: [{ $b: [] }] }),
		).toString("base64url");
		await expect400(svc.findByCursor({}, { cursor: forged }));
		// `after` is an alias.
		const next = await svc.findByCursor(
			{},
			{ sortBy: "views", after: page.nextCursor },
		);
		expect(next.data).toHaveLength(20);
	});
});

describe("M09: multi-column and relation sort", () => {
	it("sorts by a belongs-to column, then descending by another", async () => {
		const svc = postsService(await sharedDb());
		const res = await svc.findAll(
			{},
			{ sortBy: ["author.name", "-views"], limit: 30 },
		);
		const key = (p: any) => [p.author_id, -p.views, p.id];
		const expected = [...res.data].sort((a, b) => {
			const [x, y] = [key(a), key(b)];
			for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] - y[i];
			return 0;
		});
		expect(ids(res)).toEqual(expected.map((p: any) => p.id));
		expect(res.data[0]).not.toHaveProperty("author");
	});

	it("takes { column, order } entries and a comma list", async () => {
		const svc = postsService(await sharedDb());
		const a = await svc.findAll(
			{},
			{
				sortBy: [{ column: "views", order: "desc" }, { column: "id" }],
				limit: 3,
			},
		);
		const b = await svc.findAll({}, { sortBy: "-views,id", limit: 3 });
		expect(ids(a)).toEqual([4, 9, 14]);
		expect(ids(b)).toEqual(ids(a));
	});

	it("rejects unknown and collection columns", async () => {
		const svc = postsService(await sharedDb());
		await expect400(svc.findAll({}, { sortBy: ["author.nope"] }));
		await expect400(svc.findAll({}, { sortBy: ["editor.name"] }));
		await expect400(
			authorsWithPosts(await sharedDb()).findAll(
				{},
				{ sortBy: ["posts.title"] },
			),
		);
		await expect400(
			svc.findAll({}, { sortBy: [{ column: "views", order: "up" } as any] }),
		);
	});
});

// ---------------------------------------------------------------------------
// 3.5.0 features (P2). Same rules: real SQL, one fresh database per test that
// writes, and statement counts taken from Drizzle's logger.
// ---------------------------------------------------------------------------

const verbs = (log: string[]) => log.map((q) => q.split(" ")[0]);

// The many-to-many from posts to tags, through post_tags.
const postTagsRelation = {
	table: tags,
	type: "manyToMany" as const,
	through: postTags,
	throughLocalKey: "post_id",
	throughForeignKey: "tag_id",
	orderBy: [{ column: "name", order: "asc" as const }],
};

function postsWithTags(db: any, overrides: Partial<SqlCrudConfig> = {}) {
	return postsService(db, {
		relations: {
			author: { table: authors, localKey: "author_id" },
			tags: postTagsRelation,
		},
		...overrides,
	});
}

// Docs are scoped by tenant_id from the call context, and versioned.
function docsService(db: any, overrides: Partial<SqlCrudConfig> = {}) {
	return new Svc({
		...base(db, docs),
		scope: (ctx) => ({ tenant_id: ctx.tenantId }),
		versionColumn: "version",
		relations: {
			notes: { table: docNotes, type: "hasMany", foreignKey: "doc_id" },
		},
		...overrides,
	});
}

const asTenant = (tenantId: number) => ({ context: { tenantId } });

describe("M10: relations on writes", () => {
	it("create, update and upsert return the row with relations loaded, one query per relation", async () => {
		const { db, reset, statements } = await countingDb();
		const svc = postsWithTags(db);
		reset();
		const post = await svc.create(
			{ title: "New", author_id: 2, status: "draft", views: 0 },
			{ relations: ["author", "tags"] },
		);
		expect(post.author.name).toBe("Bob");
		expect(post.tags).toEqual([]);
		expect(verbs(statements())).toEqual(["insert", "select", "select"]);

		reset();
		const updated = await svc.update(
			post.id,
			{ author_id: 3 },
			{ relations: ["author"] },
		);
		expect(updated.author.name).toBe("Cy");
		expect(verbs(statements())).toEqual(["select", "update", "select"]);

		const upserted = await svc.upsert(
			{ id: post.id, title: "Up", author_id: 1, status: "draft", views: 1 },
			{},
			{ relations: ["author"] },
		);
		expect(upserted.title).toBe("Up");
		expect(upserted.author.name).toBe("Ann");
	});

	it("massCreate loads the relations of every row in one query, not one per row", async () => {
		const { db, reset, statements } = await countingDb();
		const svc = postsWithTags(db);
		reset();
		const created = await svc.massCreate(
			Array.from({ length: 10 }, (_, i) => ({
				title: `M${i}`,
				author_id: (i % 3) + 1,
				status: "draft",
				views: 0,
			})),
			{ relations: ["author"], counts: ["tags"] },
		);
		expect(created).toHaveLength(10);
		expect(created.every((p: any) => p.author?.id === p.author_id)).toBe(true);
		expect(created.every((p: any) => p._count.tags === 0)).toBe(true);
		expect(verbs(statements())).toEqual(["insert", "select", "select"]);
	});

	it("checks the relations against the allowlist before writing anything", async () => {
		const db = await freshDb();
		const svc = postsWithTags(db, { loadableRelations: ["author"] });
		await expect400(
			svc.create(
				{ title: "X", author_id: 1, status: "draft", views: 0 },
				{ relations: ["tags"] },
			),
		);
		expect(await svc.count({ title: "X" })).toBe(0);
	});

	it("creates has-many children in one INSERT, inside one transaction", async () => {
		const { db, reset, statements } = await countingDb();
		const svc = new Svc({
			...base(db, authors),
			relations: {
				posts: { table: posts, type: "hasMany", foreignKey: "author_id" },
			},
			writableRelations: ["posts"],
		});
		reset();
		const author = await svc.create(
			{
				name: "Dee",
				email: "dee@x.io",
				role: "writer",
				posts: [
					{ title: "D1", status: "draft", views: 0 },
					{ title: "D2", status: "draft", views: 0 },
				],
			},
			{ relations: ["posts"] },
		);
		expect(author.posts.map((p: any) => p.title).sort()).toEqual(["D1", "D2"]);
		expect(author.posts.every((p: any) => p.author_id === author.id)).toBe(
			true,
		);
		expect(verbs(statements())).toEqual(["insert", "insert", "select"]);
	});

	it("creates a belongs-to parent first and links it", async () => {
		const db = await freshDb();
		const svc = postsService(db, { writableRelations: ["author"] });
		const post = await svc.create(
			{
				title: "With author",
				status: "draft",
				views: 0,
				author: { name: "Eve", email: "eve@x.io", role: "writer" },
			},
			{ relations: ["author"] },
		);
		expect(post.author.name).toBe("Eve");
		expect(post.author_id).toBe(post.author.id);
	});

	it("links existing many-to-many rows by id and creates new ones", async () => {
		const db = await freshDb();
		const svc = postsWithTags(db, { writableRelations: ["tags"] });
		const post = await svc.create(
			{
				title: "Tagged",
				author_id: 1,
				status: "draft",
				views: 0,
				tags: [2, { name: "fresh" }],
			},
			{ relations: ["tags"] },
		);
		expect(post.tags.map((t: any) => t.name)).toEqual(["fresh", "tech"]);
	});

	it("rolls the parent back when a child fails, and answers with the child's error", async () => {
		const db = await freshDb();
		const svc = new Svc({
			...base(db, authors),
			relations: {
				posts: { table: posts, type: "hasMany", foreignKey: "author_id" },
			},
			writableRelations: ["posts"],
		});
		const error = await expect400(
			svc.create({
				name: "Bad",
				email: "bad@x.io",
				role: "writer",
				posts: [{ title: "P", status: "nope", views: 0 }],
			}),
		);
		expect(error.message).toContain("does not match its column type");
		expect(await svc.findOne({ email: "bad@x.io" })).toBeNull();
	});

	it("leaves relation keys alone unless writableRelations lists them", async () => {
		const db = await freshDb();
		const svc = authorsWithPosts(db);
		const author = await svc.create({
			name: "Fay",
			email: "fay@x.io",
			role: "writer",
			posts: [{ title: "ignored", status: "draft", views: 0 }],
		});
		expect(await postsService(db).count({ author_id: author.id })).toBe(0);
		const strict = new Svc({
			...base(db, authors),
			relations: {
				posts: { table: posts, type: "hasMany", foreignKey: "author_id" },
			},
			writableRelations: [],
		});
		await expect400(
			strict.create({
				name: "Gus",
				email: "gus@x.io",
				role: "writer",
				posts: [],
			}),
		);
	});

	it("attach, detach and sync are set based and return the row with the relation", async () => {
		const { db, reset, statements } = await countingDb();
		const svc = postsWithTags(db);
		reset();
		const attached = await svc.attach(2, "tags", [1, 2, "2"]);
		expect(attached.tags.map((t: any) => t.name)).toEqual(["news", "tech"]);
		// Guard, targets, existing links, one INSERT for the rest, read back.
		expect(verbs(statements())).toEqual([
			"select",
			"select",
			"select",
			"insert",
			"select",
			"select",
		]);

		const synced = await svc.sync(2, "tags", [2]);
		expect(synced.tags.map((t: any) => t.name)).toEqual(["tech"]);
		const detached = await svc.detach(1, "tags");
		expect(detached.tags).toEqual([]);
		const again = await svc.attach(2, "tags", [2]);
		expect(again.tags).toHaveLength(1);
	});

	it("rejects unknown and soft-deleted targets, a missing parent and a non many-to-many", async () => {
		const db = await freshDb();
		const svc = postsWithTags(db);
		const error = await expect400(svc.attach(1, "tags", [3, 99]));
		expect(error.getResponse().errors.map((e: any) => e.id)).toEqual([3, 99]);
		expect((await caught(svc.attach(999, "tags", [1]))).getStatus()).toBe(404);
		await expect400(svc.attach(1, "author", [1]));
		await expect400(
			postsWithTags(db, { writableRelations: [] }).attach(1, "tags", [1]),
		);
	});
});

describe("M13: tenant and ownership scoping", () => {
	const cross = 4; // a doc of tenant 2
	const t1 = asTenant(1);

	it("reads only the caller's rows, in every read path", async () => {
		const svc = docsService(await sharedDb());
		expect(await svc.find(cross, t1)).toBeNull();
		expect(await svc.findOne({ slug: "four" }, t1)).toBeNull();
		expect(await svc.exists(cross, t1)).toBe(false);
		expect((await svc.findAll({}, {}, t1)).total).toBe(3);
		expect(await svc.count({}, t1)).toBe(3);
		const page = await svc.findByCursor({}, { limit: 10, count: true }, t1);
		expect(page.data.map((d: any) => d.tenant_id)).toEqual([1, 1, 1]);
		expect(page.total).toBe(3);
		expect(await svc.countBy("tenant_id", {}, t1)).toEqual([
			{ value: 1, count: 3 },
		]);
		const fts = await svc.fullTextSearch("Four", ["title"], {}, t1);
		expect(fts.total).toBe(0);
		expect((await svc.find(cross, asTenant(2)))?.title).toBe("Four");
	});

	it("answers a cross-tenant id with a 404 on every write", async () => {
		const db = await freshDb();
		const svc = docsService(db);
		const status = async (promise: Promise<unknown>) =>
			(await caught(promise)).getStatus();
		const bulkStatuses = async (promise: Promise<unknown>) =>
			(await expect400(promise)).getResponse().errors.map((e: any) => e.status);

		expect(await status(svc.update(cross, { title: "x" }, t1))).toBe(404);
		expect(await status(svc.softDelete(cross, t1))).toBe(404);
		expect(await status(svc.restore(cross, t1))).toBe(404);
		expect(await status(svc.delete(cross, t1))).toBe(404);
		expect(await status(svc.forceDelete(cross, t1))).toBe(404);
		expect(
			await status(
				svc.upsert(
					{ id: cross, title: "x", slug: "four", tenant_id: 1 },
					{},
					t1,
				),
			),
		).toBe(404);
		expect(
			await bulkStatuses(svc.massUpdate([1, cross], { title: "x" }, t1)),
		).toEqual([404]);
		expect(await bulkStatuses(svc.massSoftDelete([1, cross], t1))).toEqual([
			404,
		]);
		expect(await bulkStatuses(svc.massRestore([1, cross], t1))).toEqual([404]);
		expect(await bulkStatuses(svc.massDelete([1, cross], t1))).toEqual([404]);
		expect(await bulkStatuses(svc.massForceDelete([1, cross], t1))).toEqual([
			404,
		]);
		expect(
			await bulkStatuses(
				svc.massUpsert(
					[
						{ id: 1, title: "ok", slug: "one" },
						{ id: cross, title: "x", slug: "four" },
					],
					{},
					t1,
				),
			),
		).toEqual([404]);

		// Nothing of tenant 2 moved, and tenant 1's rows were rolled back.
		const four = await svc.find(cross, asTenant(2));
		expect(four).toMatchObject({ title: "Four", deleted_at: null, version: 1 });
		expect((await svc.find(1, t1))?.title).toBe("One");
	});

	it("sets the scope on create and keeps it out of an update", async () => {
		const db = await freshDb();
		const svc = docsService(db, { writableRelations: ["notes"] });
		const doc = await svc.create(
			{
				title: "Mine",
				slug: "mine",
				tenant_id: 2,
				notes: [{ body: "child" }],
			},
			{ ...t1, relations: ["notes"] },
		);
		expect(doc.tenant_id).toBe(1);
		expect(doc.notes[0].tenant_id).toBe(1);
		const moved = await svc.update(
			doc.id,
			{ tenant_id: 2, title: "Still" },
			t1,
		);
		expect(moved).toMatchObject({ tenant_id: 1, title: "Still" });
		await expect400(svc.update(doc.id, { tenant_id: 2 }, t1));
	});

	it("reads the context from CrudContext.run, fails closed without one, and can be skipped", async () => {
		const svc = docsService(await sharedDb());
		expect(await CrudContext.run({ tenantId: 2 }, () => svc.count({}))).toBe(2);
		const error = await caught(svc.count({}));
		expect(error).toBeInstanceOf(MissingScopeException);
		expect(error.getStatus()).toBe(403);
		expect(await svc.count({}, { skipScope: true })).toBe(5);
		const admin = docsService(await sharedDb(), {
			scope: (ctx) => (ctx.admin ? null : { tenant_id: ctx.tenantId }),
		});
		expect(await admin.count({}, { context: { admin: true } })).toBe(5);
	});

	it("puts relation counts on a scoped list", async () => {
		const svc = docsService(await sharedDb());
		const res = await svc.findAll({}, {}, { ...t1, counts: ["notes"] });
		expect(res.data.map((d: any) => d._count.notes)).toEqual([1, 0, 0]);
	});

	it("answers attach, detach and sync on another owner's row with a 404", async () => {
		const db = await freshDb();
		// Posts owned by the author in the context: post 2 belongs to Bob.
		const svc = postsWithTags(db, {
			scope: (ctx) => ({ author_id: ctx.authorId }),
		});
		const ann = { context: { authorId: 1 } };
		for (const call of [
			svc.attach(2, "tags", [1], ann),
			svc.detach(2, "tags", undefined, ann),
			svc.sync(2, "tags", [], ann),
		]) {
			expect((await caught(call)).getStatus()).toBe(404);
		}
		expect(
			(await svc.find(2, { context: { authorId: 2 }, relations: ["tags"] }))
				?.tags,
		).toHaveLength(1);
		expect((await svc.attach(1, "tags", [1], ann)).tags).toHaveLength(2);
	});
});

describe("M14: global hooks and events", () => {
	function recorder() {
		const events: CrudEvent[] = [];
		const bus = new CrudEventBus();
		bus.subscribe({
			beforeWrite: (e) => {
				events.push(e);
			},
			afterWrite: (e) => {
				events.push(e);
			},
		});
		const brief = () =>
			events.map((e) => `${e.phase}:${e.operation}${e.bulk ? ":bulk" : ""}`);
		return { bus, events, brief };
	}

	it("fires once per call for every bulk write, upsert included", async () => {
		const db = await freshDb();
		const { bus, events, brief } = recorder();
		const svc = postsService(db, { events: bus });
		await svc.massCreate([
			{ title: "a", author_id: 1, status: "draft", views: 0 },
			{ title: "b", author_id: 1, status: "draft", views: 0 },
		]);
		await svc.massUpdate([1, 2, 3], { title: "bulk" });
		await svc.massUpsert([
			{ id: 1, title: "u1", author_id: 1, status: "draft", views: 0 },
		]);
		await svc.massSoftDelete([1, 2]);
		await svc.massRestore([1, 2]);
		await svc.massDelete([31, 32]);
		expect(brief()).toEqual([
			"before:create:bulk",
			"after:create:bulk",
			"before:update:bulk",
			"after:update:bulk",
			"before:upsert:bulk",
			"after:upsert:bulk",
			"before:softDelete:bulk",
			"after:softDelete:bulk",
			"before:restore:bulk",
			"after:restore:bulk",
			"before:delete:bulk",
			"after:delete:bulk",
		]);
		const update = events.find(
			(e) => e.phase === "after" && e.operation === "update",
		)!;
		expect(update.ids).toEqual([1, 2, 3]);
		expect(update.rows.map((r: any) => r.title)).toEqual([
			"bulk",
			"bulk",
			"bulk",
		]);
		expect(update.entity).toBe("posts");
		expect(update.transaction).toBeDefined();
	});

	it("fires for single writes, keeps the per-service hooks, and can be skipped", async () => {
		const db = await freshDb();
		const { bus, brief } = recorder();
		const seen: string[] = [];
		class Hooked extends Svc {
			protected override async afterCreate(): Promise<void> {
				seen.push("afterCreate");
			}
		}
		const svc = new Hooked({
			...base(db, posts),
			events: bus,
			relations: { tags: postTagsRelation },
		});
		const post = await svc.create({
			title: "s",
			author_id: 1,
			status: "draft",
			views: 0,
		});
		await svc.update(post.id, { title: "t" });
		await svc.upsert({
			id: post.id,
			title: "u",
			author_id: 1,
			status: "draft",
			views: 0,
		});
		await svc.softDelete(post.id);
		await svc.restore(post.id);
		await svc.attach(post.id, "tags", [1]);
		await svc.delete(post.id, { skipEvents: true });
		expect(seen).toEqual(["afterCreate"]);
		expect(brief()).toEqual([
			"before:create",
			"after:create",
			"before:update",
			"after:update",
			"before:upsert",
			"after:upsert",
			"before:softDelete",
			"after:softDelete",
			"before:restore",
			"after:restore",
			"before:attach",
			"after:attach",
		]);
	});

	it("a before listener stops the write; an after listener that throws rolls a bulk call back", async () => {
		const db = await freshDb();
		const bus = new CrudEventBus();
		const stop = bus.subscribe({
			entities: ["posts"],
			beforeDelete: () => {
				throw new BadRequestException("frozen");
			},
		});
		const svc = postsService(db, { events: bus });
		await expect400(svc.delete(30));
		expect(await svc.exists(30)).toBe(true);
		stop();
		bus.subscribe({
			afterUpdate: () => {
				throw new Error("audit down");
			},
		});
		await expect(svc.massUpdate([1, 2], { title: "lost" })).rejects.toThrow(
			"audit down",
		);
		expect((await svc.find(1))?.title).toBe("Post 1");
		// A subscriber for another entity is not called.
		const other = new CrudEventBus();
		const calls: string[] = [];
		other.subscribe({
			entities: ["authors"],
			afterWrite: () => void calls.push("x"),
		});
		await postsService(db, { events: other }).update(1, { title: "y" });
		expect(calls).toEqual([]);
	});

	it("enableGlobalHooks wires the module's bus into every service", async () => {
		const db = await freshDb();
		const events: string[] = [];
		const build = async (enableGlobalHooks: boolean) => {
			const moduleRef = await Test.createTestingModule({
				imports: [
					DrizzleCrudModule.forRoot({
						dialect: "postgresql",
						db,
						hooks: {
							enableGlobalHooks,
							subscribers: [
								{
									afterWrite: (e) =>
										void events.push(`${e.entity}:${e.operation}`),
								},
							],
						},
					}),
					DrizzleCrudModule.forFeature([
						{
							service: Svc as any,
							table: notes,
							config: { softDelete: { enabled: false }, timestamps: undefined },
						},
					]),
				],
			}).compile();
			return moduleRef;
		};
		const on = await build(true);
		await on.get<Svc>(Svc as any).create({ body: "evented" });
		expect(events).toEqual(["notes:create"]);
		expect(on.get(CrudEventBus)).toBeInstanceOf(CrudEventBus);

		const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
		const off = await build(false);
		await off.get<Svc>(Svc as any).create({ body: "quiet" });
		expect(events).toEqual(["notes:create"]);
		expect(warn).toHaveBeenCalled();
		warn.mockRestore();
	});
});

describe("M15: optimistic locking", () => {
	const t1 = asTenant(1);

	it("starts at 1, goes up on every write, and a stale version is a 409", async () => {
		const db = await freshDb();
		const svc = docsService(db);
		const doc = await svc.create({ title: "V", slug: "v", version: 7 }, t1);
		expect(doc.version).toBe(1);

		const v2 = await svc.update(doc.id, { title: "V2", version: 1 }, t1);
		expect(v2.version).toBe(2);
		const stale = await caught(
			svc.update(doc.id, { title: "late", version: 1 }, t1),
		);
		expect(stale).toBeInstanceOf(StaleVersionException);
		expect(stale.getStatus()).toBe(409);
		// Without a version the write is not checked, but still counts.
		expect((await svc.update(doc.id, { title: "V3" }, t1)).version).toBe(3);

		expect(
			(
				await caught(svc.softDelete(doc.id, { ...t1, expectedVersion: 2 }))
			).getStatus(),
		).toBe(409);
		await svc.softDelete(doc.id, { ...t1, expectedVersion: 3 });
		const restored = await svc.restore(doc.id, { ...t1, expectedVersion: 4 });
		expect(restored.version).toBe(5);
		expect(
			(
				await caught(svc.delete(doc.id, { ...t1, expectedVersion: 4 }))
			).getStatus(),
		).toBe(409);
		expect(await svc.delete(doc.id, { ...t1, expectedVersion: 5 })).toBe(true);
		await expect400(svc.update(1, { title: "x", version: "abc" }, t1));
	});

	it("bumps the version on upsert and on every bulk write", async () => {
		const db = await freshDb();
		const svc = docsService(db);
		const up = await svc.upsert({ id: 1, title: "U", slug: "one" }, {}, t1);
		expect(up.version).toBe(2);
		const updated = await svc.massUpdate([1, 2], { title: "B" }, t1);
		expect(updated.map((d: any) => d.version)).toEqual([3, 2]);
		await svc.massSoftDelete([1, 2], t1);
		const back = await svc.massRestore([1, 2], t1);
		expect(back.map((d: any) => d.version)).toEqual([5, 4]);
	});

	it("checks expectedVersions per id in a bulk write and rolls the batch back", async () => {
		const db = await freshDb();
		const svc = docsService(db);
		const error = await expect400(
			svc.massUpdate(
				[1, 2, 3],
				{ title: "B" },
				{
					...t1,
					expectedVersions: { "1": 1, "2": 9 },
				},
			),
		);
		expect(error.getResponse().errors).toEqual([
			{ id: 2, status: 409, message: expect.any(String) },
		]);
		expect((await svc.find(1, t1))?.version).toBe(1);
		const ok = await svc.massDelete([1, 2], {
			...t1,
			expectedVersions: { "1": 1, "2": 1 },
		});
		expect(ok).toBe(true);
		expect(await svc.count({}, t1)).toBe(1);
	});
});

describe("M16: aggregates", () => {
	it("counts has-many and many-to-many relations in one grouped query each", async () => {
		const { db, reset, statements } = await countingDb();
		const authorsSvc = authorsWithPosts(db);
		reset();
		const res = await authorsSvc.findAll({}, {}, { counts: ["posts"] });
		expect(res.data.map((a: any) => a._count.posts)).toEqual([10, 10, 10]);
		// data + count + one GROUP BY, whatever the number of rows.
		expect(statements()).toHaveLength(3);

		const svc = postsWithTags(db);
		const page = await svc.findAll(
			{ id: { in: [1, 2, 3, 4] } },
			{ sortBy: "id", sortOrder: "asc" },
			{ counts: ["tags"], select: ["title"] },
		);
		// Post 3 only has the soft-deleted tag, which is not counted.
		expect(page.data.map((p: any) => p._count.tags)).toEqual([2, 1, 0, 0]);
		expect(
			(await svc.find(1, { counts: { tags: { name: "news" } } }))._count,
		).toEqual({
			tags: 1,
		});
	});

	it("narrows a count with a filter and works on cursor pages", async () => {
		const svc = authorsWithPosts(await sharedDb());
		const res = await svc.findByCursor(
			{},
			{ limit: 2 },
			{ counts: { posts: { status: "published" } } },
		);
		expect(res.data.map((a: any) => a._count.posts)).toEqual([5, 5]);
	});

	it("rejects a belongs-to, an unknown relation and one outside loadableRelations", async () => {
		const db = await sharedDb();
		await expect400(postsService(db).findAll({}, {}, { counts: ["author"] }));
		await expect400(postsService(db).findAll({}, {}, { counts: ["nope"] }));
		await expect400(
			postsWithTags(db, { loadableRelations: ["author"] }).findAll(
				{},
				{},
				{ counts: ["tags"] },
			),
		);
	});

	it("countBy groups by a column or a belongs-to column, after filters and soft delete", async () => {
		const db = await freshDb();
		const svc = postsService(db);
		await svc.softDelete(30);
		expect(await svc.countBy("status")).toEqual([
			{ value: "published", count: 15 },
			{ value: "draft", count: 14 },
		]);
		expect(await svc.countBy("author.name", { status: "published" })).toEqual([
			{ value: "Ann", count: 5 },
			{ value: "Bob", count: 5 },
			{ value: "Cy", count: 5 },
		]);
		await expect400(svc.countBy("nope"));
		await expect400(
			postsService(db, { filterableColumns: ["title"] }).countBy("status"),
		);
	});
});

describe("M17: skipping the count query", () => {
	it("withCount: false runs one query, reports total: null and hasMore", async () => {
		const { db, reset, statements } = await countingDb();
		const svc = postsService(db);
		reset();
		const first = await svc.findAll({}, { limit: 20, withCount: false });
		expect(statements()).toHaveLength(1);
		expect(first.total).toBeNull();
		expect(first.hasMore).toBe(true);
		expect(first.data).toHaveLength(20);
		const last = await svc.findAll(
			{},
			{ page: 2, limit: 20, withCount: false },
		);
		expect(last.data).toHaveLength(10);
		expect(last.hasMore).toBe(false);
		const counted = await svc.findAll({}, { limit: 20 });
		expect(counted.total).toBe(30);
		expect(counted).not.toHaveProperty("hasMore");
	});

	it("the parser reads ?withCount=false", async () => {
		const svc = postsService(await sharedDb());
		const q = svc.parseQuery({ withCount: "false", limit: "5" });
		expect(q.pagination.withCount).toBe(false);
		const res = await svc.findAll(q.filters, q.pagination, q.options);
		expect(res.total).toBeNull();
		expect(res.hasMore).toBe(true);
	});
});

describe("M18: deeper relation filters", () => {
	const citiesSvc = (db: any, overrides: Partial<SqlCrudConfig> = {}) =>
		new Svc({
			...base(db, geoCities),
			softDelete: { enabled: false, column: "deleted_at" },
			timestamps: undefined,
			relations: {
				state: {
					table: geoStates,
					localKey: "state_id",
					relations: {
						country: { table: geoCountries, localKey: "country_id" },
						cities: {
							table: geoCities,
							type: "hasMany",
							foreignKey: "state_id",
						},
					},
				},
			},
			...overrides,
		});

	it("filters through a belongs-to path, with EXISTS below the first join", async () => {
		const svc = citiesSvc(await sharedDb());
		const res = await svc.findAll({ state: { country: { code: "IN" } } });
		expect(res.data.map((c: any) => c.name).sort()).toEqual([
			"Bengaluru",
			"Kochi",
			"Mysuru",
		]);
		expect(res.total).toBe(3);
		expect(await svc.count({ state: { country: { code: "NP" } } })).toBe(1);
		// A collection under a belongs-to: cities whose state has a city named Mysuru.
		expect(
			await svc.count({ state: { cities: { some: { name: "Mysuru" } } } }),
		).toBe(2);
		// And inside an OR / NOT group.
		expect(
			await svc.count({
				or: [{ state: { country: { code: "NP" } } }, { name: "Kochi" }],
			}),
		).toBe(2);
		expect(
			await svc.count({ not: { state: { country: { code: "IN" } } } }),
		).toBe(1);
	});

	it("some, none and every on a has-many, without multiplying rows", async () => {
		const db = await freshDb();
		const authorsSvc = authorsWithPosts(db);
		await postsService(db).massUpdate([1, 4, 7, 10, 13], { views: 99 });
		// Ann (1) has posts 1,4,...,28. Make every Ann post published for `every`.
		await postsService(db).massUpdate(
			Array.from({ length: 10 }, (_, i) => 1 + i * 3),
			{ status: "published" },
		);
		const names = async (filter: any) =>
			(await authorsSvc.findAll(filter)).data.map((a: any) => a.name);

		expect(await names({ posts: { some: { views: 99 } } })).toEqual(["Ann"]);
		expect(await names({ posts: { none: { views: 99 } } })).toEqual([
			"Bob",
			"Cy",
		]);
		expect(await names({ posts: { every: { status: "published" } } })).toEqual([
			"Ann",
		]);
		expect((await authorsSvc.findAll({ posts: { some: {} } })).total).toBe(3);
		expect(await authorsSvc.count({ posts: { none: {} } })).toBe(0);
		// Combined and grouped.
		expect(
			await names({
				posts: { some: { status: "draft" }, none: { views: 99 } },
			}),
		).toEqual(["Bob", "Cy"]);
		expect(
			await authorsSvc.count({
				or: [{ posts: { every: { status: "published" } } }, { name: "Cy" }],
			}),
		).toBe(2);
		expect(
			await authorsSvc.count({ not: { posts: { none: { views: 99 } } } }),
		).toBe(1);
	});

	it("every is true for a parent with no rows, and a soft-deleted child does not count", async () => {
		const db = await freshDb();
		const authorsSvc = authorsWithPosts(db);
		await authorsSvc.create({ name: "New", email: "new@x.io", role: "writer" });
		expect(
			(
				await authorsSvc.findAll({ posts: { every: { views: 12345 } } })
			).data.map((a: any) => a.name),
		).toEqual(["New"]);
		// Soft-delete every draft of Bob: his remaining posts are all published.
		const bobDrafts = (
			await postsService(db).findAll(
				{ author_id: 2, status: "draft" },
				{ limit: 100 },
			)
		).data.map((p: any) => p.id);
		await postsService(db).massSoftDelete(bobDrafts);
		expect(
			(
				await authorsSvc.findAll({ posts: { every: { status: "published" } } })
			).data.map((a: any) => a.name),
		).toEqual(["Bob", "New"]);
	});

	it("none and every on a many-to-many", async () => {
		const svc = postsWithTags(await sharedDb());
		expect(
			await svc.count({ id: { lte: 3 }, tags: { none: { name: "tech" } } }),
		).toBe(2);
		// Post 3's only tag is soft-deleted, so it has no live tags: `every`
		// holds for it vacuously.
		expect(
			ids(
				await svc.findAll(
					{ id: { lte: 3 }, tags: { every: { name: "news" } } },
					{ sortBy: "id", sortOrder: "asc" },
				),
			),
		).toEqual([2, 3]);
	});

	it("checks paths against filterableColumns and parses them from a query string", async () => {
		const db = await sharedDb();
		const strict = citiesSvc(db, {
			filterableColumns: ["name", "state.country.code"],
		});
		expect(await strict.count({ state: { country: { code: "IN" } } })).toBe(3);
		await expect400(strict.count({ state: { name: "Kerala" } }));
		const q = strict.parseQuery({ "state.country.code": "NP" });
		expect(q.filters).toEqual({ state: { country: { code: "NP" } } });
		expect(await strict.count(q.filters)).toBe(1);
		expect(() => strict.parseQuery({ "state[name]": "Kerala" })).toThrow(
			BadRequestException,
		);

		const authorsSvc = authorsWithPosts(db);
		const parsed = authorsSvc.parseQuery({
			"posts[none][status]": "draft",
			"posts[every][views][gte]": "0",
		});
		expect(parsed.filters).toEqual({
			posts: { none: { status: "draft" }, every: { views: { gte: 0 } } },
		});
		expect(await authorsSvc.count(parsed.filters)).toBe(0);
		expect(authorsSvc.parseQuery({ "posts[some]": "" }).filters).toEqual({
			posts: { some: {} },
		});
	});
});

describe("3.5.2 fixes", () => {
	it("answers soft delete on an entity without it, and full-text search on MySQL, with a 400", async () => {
		const db = await sharedDb();
		const svc = itemsService(db);
		await expect400(svc.softDelete(1));
		await expect400(svc.restore(1));
		await expect400(svc.massSoftDelete([1]));
		await expect400(svc.massRestore([1]));
		const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
		const mysql = itemsService(db, { dialect: "mysql" });
		warn.mockRestore();
		await expect400(mysql.fullTextSearch("plain", ["name"]));
	});

	it("sorts a bare sortBy ascending, the same in findAll and over HTTP", async () => {
		const svc = itemsService(await sharedDb());
		const names = (res: any) => res.data.map((row: any) => row.name);
		const direct = names(await svc.findAll({}, { sortBy: "name" }));
		const http = names(
			await svc.findAll({}, svc.parseQuery({ sortBy: "name" }).pagination),
		);
		expect(direct).toEqual([...direct].sort());
		expect(http).toEqual(direct);
	});

	it("counts only related rows of the caller's tenant", async () => {
		const db = await freshDb();
		await db.insert(docNotes).values({ doc_id: 1, tenant_id: 2, body: "x" });
		const svc = docsService(db);
		const res = await svc.findAll(
			{},
			{},
			{ ...asTenant(1), counts: ["notes"] },
		);
		expect(res.data.map((d: any) => d._count.notes)).toEqual([1, 0, 0]);
	});
});

describe("re-audit R-01: relations stay inside the tenant", () => {
	// Tenant 1's note pointing at doc 4, which belongs to tenant 2, and tenant
	// 2's note on doc 1, which belongs to tenant 1. A plain foreign key allows
	// both; the scope must still keep each tenant's reads to its own rows.
	const seeded = async () => {
		const db = await freshDb();
		await db.insert(docNotes).values([
			{ doc_id: 4, tenant_id: 1, body: "points at b" },
			{ doc_id: 1, tenant_id: 2, body: "from b" },
		]);
		const notes = new Svc({
			...base(db, docNotes),
			softDelete: { enabled: false, column: "deleted_at" },
			timestamps: undefined,
			scope: (ctx) => ({ tenant_id: ctx.tenantId }),
			relations: { doc: { table: docs, localKey: "doc_id" } },
		});
		return { notes, docs: docsService(db) };
	};
	const t1 = asTenant(1);

	it("loads a belongs-to of another tenant as null, joined or batched", async () => {
		const { notes } = await seeded();
		const res = await notes.findAll(
			{},
			{ sortBy: "id" },
			{ ...t1, relations: ["doc"] },
		);
		const crossed = res.data.find((n: any) => n.body === "points at b");
		expect(crossed.doc).toBeNull();
		expect(res.data.find((n: any) => n.body === "n1").doc.title).toBe("One");
	});

	it("does not match a filter on another tenant's belongs-to row", async () => {
		const { notes } = await seeded();
		expect(
			(await notes.findAll({ doc: { title: "Four" } }, {}, t1)).total,
		).toBe(0);
		expect(await notes.count({ doc: { title: "Four" } }, t1)).toBe(0);
	});

	it("leaves another tenant's rows out of has-many loads, filters and counts", async () => {
		const { docs: svc } = await seeded();
		const one = await svc.find(1, {
			...t1,
			relations: ["notes"],
			counts: ["notes"],
		});
		expect(one.notes.map((n: any) => n.body)).toEqual(["n1"]);
		expect(one._count.notes).toBe(1);
		const some = await svc.findAll(
			{ notes: { some: { body: "from b" } } },
			{},
			t1,
		);
		expect(some.total).toBe(0);
	});
});

describe("re-audit R-02: deep filters are a 400", () => {
	const deep = (levels: number) => {
		let filter: any = { name: "x" };
		for (let i = 0; i < levels; i++) filter = { not: filter };
		return filter;
	};

	it("rejects a thousand-level not, from a query string or from code", async () => {
		const svc = itemsService(await sharedDb());
		const key = `not${"[not]".repeat(999)}[name]`;
		expect(() => svc.parseQuery({ [key]: "x" })).toThrow(/nested too deeply/);
		expect(() => svc.parseQuery(deep(1000))).toThrow(/nested too deeply/);
		await expect400(svc.findAll(deep(1000)));
	});

	it("still accepts a reasonably nested filter", async () => {
		const svc = itemsService(await sharedDb());
		await expect(svc.findAll(deep(20))).resolves.toHaveProperty("total");
	});
});

describe("re-audit: writes", () => {
	const status = async (promise: Promise<unknown>) =>
		(await caught(promise)).getStatus();

	it("R-05: upsert onto a trashed row writes nothing and is a 404", async () => {
		const db = await freshDb();
		const svc = new Svc(base(db, authors));
		await svc.softDelete(3);
		expect(
			await status(
				svc.upsert(
					{ name: "Cy2", email: "cy@x.io", role: "writer" },
					{ conflictTarget: "email" },
				),
			),
		).toBe(404);
		const trashed = await svc.find(3, { withDeleted: true });
		expect(trashed).toMatchObject({ name: "Cy" });
		expect(trashed?.deleted_at).not.toBeNull();
	});

	it("R-07: a missing required value is a 400 that names the column", async () => {
		const svc = postsService(await freshDb());
		const error = await caught(
			svc.create({
				title: null,
				author_id: 1,
				status: "draft",
				views: 0,
			} as any),
		);
		expect(error.getStatus()).toBe(400);
		expect(JSON.stringify(error.getResponse())).toContain("title");
	});

	it("R-08: MySQL duplicate and foreign key errors map to 409 and 400", () => {
		const svc: any = new Svc(base({} as any, authors));
		const dup = svc.toClientError({
			code: "ER_DUP_ENTRY",
			errno: 1062,
			message: "Duplicate entry 'ann@x.io' for key 'authors.email'",
		});
		expect(dup.getStatus()).toBe(409);
		expect(JSON.stringify(dup.getResponse())).toContain("email");
		expect(svc.toClientError({ errno: 1452 }).getStatus()).toBe(400);
		expect(svc.toClientError({ errno: 1451 }, "delete").getStatus()).toBe(409);
	});

	it("R-09: a scoped upsert without RETURNING never reads back another tenant's row", async () => {
		const db = await freshDb();
		const svc = docsService(db, {
			sql: { ...base(db, docs).sql!, useReturning: false },
		});
		expect(
			await status(
				svc.upsert(
					{ title: "mine", slug: "four" },
					{ conflictTarget: "slug" },
					asTenant(1),
				),
			),
		).toBe(404);
		expect((await svc.find(4, asTenant(2)))?.title).toBe("Four");
	});

	it("R-10: restore on a live row is a 404 and leaves it alone", async () => {
		const db = await freshDb();
		const svc = new Svc(base(db, authors));
		const before = await svc.find(1);
		expect(await status(svc.restore(1))).toBe(404);
		expect((await svc.find(1))?.updated_at).toEqual(before?.updated_at);
		await svc.softDelete(1);
		await expect(svc.restore(1)).resolves.toMatchObject({ deleted_at: null });
	});
});

describe("re-audit: allowlists and nested rows", () => {
	it("R-13: an existence filter needs the relation to be filterable", async () => {
		const svc = new Svc({
			...base(await sharedDb(), authors),
			filterableColumns: ["name"],
			relations: {
				posts: { table: posts, type: "hasMany", foreignKey: "author_id" },
			},
		});
		expect(() => svc.parseQuery({ "posts[none]": "" })).toThrow(/not allowed/);
	});

	it("R-14: a nested child cannot pick its own generated primary key", async () => {
		const svc = docsService(await freshDb(), { writableRelations: ["notes"] });
		const doc = await svc.create(
			{ title: "Mine", slug: "mine", notes: [{ id: 99999, body: "child" }] },
			{ ...asTenant(1), relations: ["notes"] },
		);
		expect(doc.notes[0].id).not.toBe(99999);
	});
});
