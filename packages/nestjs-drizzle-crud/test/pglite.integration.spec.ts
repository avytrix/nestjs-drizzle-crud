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
import { afterAll, afterEach, describe, expect, it, jest } from "@jest/globals";
import { BadRequestException, HttpException } from "@nestjs/common";
import {
	bigint,
	boolean,
	customType,
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
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { Test } from "@nestjs/testing";
import { SqlBaseCrudService } from "../src/core/abstract/sql-base-crud.service";
import { CrudContext } from "../src/core/context/crud-context";
import { CrudEventBus } from "../src/core/events/crud-event-bus";
import type { CrudEvent } from "../src/core/interfaces/events.interface";
import {
	assertFilterDepth,
	parseCrudQuery,
} from "../src/core/utils/query-parser";
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

// A test's own databases are closed when it ends, so a hundred PGlite
// instances never sit in memory at once; the shared one is closed after the
// run, so Jest exits without open handles.
const clients: PGlite[] = [];
const kept: PGlite[] = [];
afterEach(async () => {
	await Promise.all(clients.splice(0).map((client) => client.close()));
});
afterAll(async () => {
	await Promise.all(kept.map((client) => client.close()));
});

async function freshDb(
	log?: string[],
	params?: unknown[][],
	keep = false,
): Promise<any> {
	const client = await PGlite.create();
	(keep ? kept : clients).push(client);
	await client.exec(DDL);
	await client.exec(SEED);
	return drizzle(
		client,
		log
			? {
					logger: {
						logQuery: (query, values) => {
							log.push(query);
							params?.push(values);
						},
					},
				}
			: {},
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
	shared ??= freshDb(undefined, undefined, true);
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
		expect(statements()).toHaveLength(3); // one guardless UPDATE per item since 3.8.0
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
		expect(verbs(statements())).toEqual(["update", "select"]);

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
		// The row, targets, existing links, one INSERT for the rest, the
		// relation loaded onto the row read first (3.8.0: the row once).
		expect(verbs(statements())).toEqual([
			"select",
			"select",
			"select",
			"insert",
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

describe("re-audit R-06: batches past the parameter limit are a 400", () => {
	it("refuses a huge insert, id list or IN filter with a 400 that names the limit", async () => {
		const svc = new Svc(base(await sharedDb(), authors));
		const rows = Array.from({ length: 14_000 }, (_, i) => ({
			name: `n${i}`,
			email: `n${i}@x.io`,
			role: "writer",
		}));
		const many = Array.from({ length: 70_000 }, (_, i) => i + 1);
		// One call at a time: each rejects on its own statement.
		for (const call of [
			() => svc.massCreate(rows as any),
			() => svc.massUpdate(many, { name: "x" } as any),
			() => svc.findAll({ id: many }),
			() => svc.findAll({ id: { in: many } }),
		]) {
			const error = await expect400(call());
			expect(JSON.stringify(error.getResponse())).toContain("65535");
		}
	});
});

describe("3.7.0: full-text search options", () => {
	it("keeps plainto_tsquery and 'english' as the default", async () => {
		const { db, statements } = await countingDb();
		const svc = postsService(db);
		const res = await svc.fullTextSearch("post 1", ["title"]);
		// plainto_tsquery: every word must match.
		expect(res.data.map((p: any) => p.id)).toEqual([1]);
		// It reads "-1" as a number, not as "without 1".
		expect((await svc.fullTextSearch("post -1", ["title"])).total).toBe(0);
		const select = statements().find((q) => q.includes("ts_rank")) ?? "";
		expect(select).toContain(`to_tsvector('english', "posts"."title")`);
		expect(select).toContain("plainto_tsquery('english', $1)");
	});

	it("parses the term with websearch_to_tsquery on request", async () => {
		const svc = postsService(await sharedDb());
		const res = await svc.fullTextSearch(
			"post -1",
			["title"],
			{ limit: 100 },
			{ queryMode: "websearch" },
		);
		expect(res.total).toBe(29);
		expect(res.data.map((p: any) => p.id)).not.toContain(1);
		const listed = await svc.findAll(
			undefined,
			{ limit: 100 },
			{
				search: {
					term: '"post 1"',
					columns: ["title"],
					mode: "fullText",
					queryMode: "websearch",
				},
			},
		);
		expect(listed.data.map((p: any) => p.id)).toEqual([1]);
	});

	it("uses another text search configuration", async () => {
		const svc = postsService(await sharedDb());
		// The english configuration stems "posts" to "post"; simple does not.
		expect((await svc.fullTextSearch("posts", ["title"])).total).toBe(30);
		const simple = await svc.fullTextSearch(
			"posts",
			["title"],
			{},
			{ language: "simple" },
		);
		expect(simple.total).toBe(0);
		const qualified = await svc.fullTextSearch(
			"posts",
			["title"],
			{},
			{ language: "pg_catalog.english" },
		);
		expect(qualified.total).toBe(30);
		const viaFindAll = await svc.findAll(
			undefined,
			{},
			{
				search: {
					term: "posts",
					columns: ["title"],
					mode: "fullText",
					language: "simple",
				},
			},
		);
		expect(viaFindAll.total).toBe(0);
	});

	it("answers a bad language or query mode with a 400", async () => {
		const svc = postsService(await sharedDb());
		const injection = "english'); select 1; --";
		for (const language of [injection, "a b", "", 1]) {
			await expect400(
				svc.fullTextSearch("post", ["title"], {}, { language } as any),
			);
		}
		await expect400(
			svc.fullTextSearch("post", ["title"], {}, { queryMode: "raw" } as any),
		);
		await expect400(
			svc.findAll(
				undefined,
				{},
				{
					search: {
						term: "post",
						columns: ["title"],
						mode: "fullText",
						language: "x'y",
					},
				},
			),
		);
	});

	it("honours filters, relations, select and counts like findAll", async () => {
		const svc = postsService(await sharedDb(), {
			relations: {
				author: { table: authors, localKey: "author_id" },
				tags: {
					type: "manyToMany",
					table: tags,
					through: postTags,
					throughLocalKey: "post_id",
					throughForeignKey: "tag_id",
				},
			},
		});
		const res = await svc.fullTextSearch(
			"post",
			["title"],
			{ limit: 100 },
			{
				filters: { author_id: 1 },
				relations: ["author"],
				select: ["id", "title", "author.name"],
			},
		);
		expect(res.total).toBe(10);
		expect(res.data).toHaveLength(10);
		for (const row of res.data as any[]) {
			expect(Object.keys(row).sort()).toEqual(["author", "id", "title"]);
			expect(row.author).toEqual({ name: "Ann" });
		}

		const byRelation = await svc.fullTextSearch(
			"post",
			["title"],
			{ limit: 100 },
			{ filters: { author: { name: "Bob" } } },
		);
		expect(byRelation.total).toBe(10);
		expect(byRelation.data.every((p: any) => p.author_id === 2)).toBe(true);

		const withTags = await svc.fullTextSearch(
			"post",
			["title"],
			{ limit: 100 },
			{ filters: { tags: { some: { name: "news" } } }, counts: ["tags"] },
		);
		expect(withTags.data.map((p: any) => p.id).sort()).toEqual([1, 2]);
		expect(withTags.data.find((p: any) => p.id === 1)?._count).toEqual({
			tags: 2,
		});
	});

	it("keeps the soft delete scope with filters", async () => {
		const svc = postsService(await freshDb());
		await svc.softDelete(1);
		const res = await svc.fullTextSearch(
			"post",
			["title"],
			{ limit: 100 },
			{ filters: { author_id: 1 } },
		);
		expect(res.total).toBe(9);
		const trash = await svc.fullTextSearch(
			"post",
			["title"],
			{ limit: 100 },
			{ filters: { author_id: 1 }, onlyDeleted: true },
		);
		expect(trash.data.map((p: any) => p.id)).toEqual([1]);
	});
});

describe("3.7.1: scoped upsert on MySQL", () => {
	it("names both dialects that support it", async () => {
		const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
		const svc = docsService(await sharedDb(), { dialect: "mysql" });
		warn.mockRestore();
		const error = await expect400(
			svc.upsert(
				{ title: "x", slug: "x" },
				{ conflictTarget: "slug" },
				asTenant(1),
			),
		);
		expect(error.message).toBe(
			"upsert on a scoped entity needs PostgreSQL or SQLite",
		);
	});
});

describe("3.7.1: select paths from the request", () => {
	it("treats __proto__ and constructor as plain names, not object internals", async () => {
		const svc: any = new Svc(base(await sharedDb(), authors));
		const tree = svc.parseSelect(["__proto__.x", "constructor.y", "name"]);
		expect(Object.getPrototypeOf(tree.relations)).toBeNull();
		expect(svc.selectFor(tree, "__proto__").base).toEqual(["x"]);
		expect(({} as any).base).toBeUndefined();
		expect(svc.selectFor(tree, "constructor").base).toEqual(["y"]);
		expect(
			svc.selectFor({ base: [], relations: {} }, "__proto__").base,
		).toEqual([]);
	});
});

// PGlite returns no rows, without an error, for a statement with more than
// 32,767 bound parameters (real Postgres takes 65,535). So these specs only
// assert the refusals past 65,535, which happen before anything is sent, and
// keep every statement that does run under 32,767.
describe("3.7.2: the bound parameter check sees the real statement", () => {
	const range = (from: number, n: number) =>
		Array.from({ length: n }, (_, i) => from + i);
	const tooMany = async (promise: Promise<unknown>) => {
		const error = await expect400(promise);
		expect(error.message).toMatch(
			/^Too many values in one statement: \d+ bound parameters, and PostgreSQL takes at most 65535\./,
		);
		return error;
	};

	it("A-01: counts two OR'd IN lists together", async () => {
		const svc = authorsService(await sharedDb());
		await tooMany(
			svc.findAll({
				or: [
					{ id: { in: range(1, 40_000) } },
					{ id: { in: range(40_001, 40_000) } },
				],
			}),
		);
	});

	it("A-01: counts the version checks of a versioned mass update", async () => {
		const db = await freshDb();
		await db.$client.exec(
			"INSERT INTO docs (tenant_id, title, slug) SELECT 1, 'd' || n, 'd' || n FROM generate_series(6, 25005) AS n",
		);
		const svc = docsService(db);
		const ids = range(6, 25_000);
		// The existence check binds 25,001 values and runs; the UPDATE binds
		// about three per id (id list, id and version), 75,000 in all.
		await tooMany(
			svc.massUpdate(ids, { title: "v" } as any, {
				...asTenant(1),
				expectedVersions: Object.fromEntries(ids.map((id) => [String(id), 1])),
			}),
		);
		expect(await svc.count({ title: "v" }, asTenant(1))).toBe(0);
	});

	it("A-01: checks the target lookup of attach", async () => {
		const svc = postsWithTags(await freshDb());
		await tooMany(svc.attach(1, "tags", range(1, 70_000)));
	});

	it("A-01: checks the child INSERT of a nested create, and rolls it all back", async () => {
		const db = await freshDb();
		const svc = new Svc({
			...base(db, authors),
			relations: {
				posts: { table: posts, type: "hasMany", foreignKey: "author_id" },
			},
			writableRelations: ["posts"],
		});
		await tooMany(
			svc.create({
				name: "Many",
				email: "many@x.io",
				role: "writer",
				posts: range(0, 25_000).map((i) => ({ title: `t${i}` })),
			} as any),
		);
		expect(await svc.count()).toBe(3);
	});

	it("A-01: refuses a huge massUpsert before it writes, without replaying it row by row", async () => {
		const { db, statements } = await countingDb();
		const svc = authorsService(db);
		const rows = range(0, 14_000).map((i) => ({
			name: `n${i}`,
			email: `n${i}@x.io`,
			role: "writer",
		}));
		await tooMany(svc.massUpsert(rows as any, { conflictTarget: "email" }));
		await tooMany(svc.massCreate(rows as any));
		expect(statements().filter((q) => /^\s*insert/i.test(q))).toEqual([]);
		expect(await svc.count()).toBe(3);
	});

	it("A-04: lets a one-column insert through that the old estimate refused", async () => {
		const svc = new Svc({
			...base(await freshDb(), tags),
			timestamps: undefined,
		});
		// 15,001 rows bind 15,001 values; the 3.7.1 guard counted five per row.
		const created = await svc.massCreate(
			range(0, 15_001).map((i) => ({ name: `tag${i}` })) as any,
		);
		expect(created).toHaveLength(15_001);
	});

	it("A-01: still answers a batch too big for Drizzle to build with a 400", async () => {
		const svc = authorsService(await sharedDb());
		// 250,000 values: Drizzle's own SQL builder overflows the call stack.
		const error = await expect400(
			svc.massCreate(
				range(0, 50_000).map((i) => ({
					name: `n${i}`,
					email: `n${i}@x.io`,
					role: "writer",
				})) as any,
			),
		);
		expect(error.message).toBe(
			"Too many values in one statement: more than 65535 bound parameters, and PostgreSQL takes at most 65535. Split the batch.",
		);
	});

	it("A-01: names the statement's own count", async () => {
		const svc = authorsService(await sharedDb());
		const error = await tooMany(svc.findAll({ id: { in: range(1, 65_536) } }));
		// 65,536 ids plus the LIMIT.
		expect(error.message).toContain("65537 bound parameters");
	});
});

describe("3.7.2: a belongs-to key stays inside the tenant (A-05)", () => {
	// Notes are scoped like docs, and point at a doc. Docs 1-3 are tenant 1's,
	// docs 4-5 tenant 2's.
	const notesService = (db: any) =>
		new Svc({
			...base(db, docNotes),
			softDelete: { enabled: false, column: "deleted_at" },
			timestamps: undefined,
			scope: (ctx) => ({ tenant_id: ctx.tenantId }),
			relations: { doc: { table: docs, localKey: "doc_id" } },
		});
	const response = async (promise: Promise<unknown>) =>
		(await expect400(promise)).getResponse();

	it("answers another tenant's doc exactly like a missing one, on every write", async () => {
		const svc = notesService(await freshDb());
		const as1 = asTenant(1);
		const missing = await response(
			svc.create({ doc_id: 999, body: "x" } as any, as1),
		);
		expect(missing).toMatchObject({ statusCode: 400 });
		expect(
			await response(svc.create({ doc_id: 4, body: "x" } as any, as1)),
		).toEqual(missing);
		expect(await response(svc.update(1, { doc_id: 4 } as any, as1))).toEqual(
			await response(svc.update(1, { doc_id: 999 } as any, as1)),
		);
		expect(
			await response(
				svc.upsert({ id: 1, doc_id: 4, body: "x" } as any, {}, as1),
			),
		).toEqual(missing);
		// The row is still where it was, and nothing new points at tenant 2.
		expect((await svc.find(1, as1))?.doc_id).toBe(1);
		expect(await svc.count({ doc_id: 4 }, asTenant(2))).toBe(1);
		// The caller's own doc is fine.
		await expect(
			svc.create({ doc_id: 2, body: "mine" } as any, as1),
		).resolves.toMatchObject({ doc_id: 2, tenant_id: 1 });
	});

	it("checks a batch with one SELECT and names the failing items", async () => {
		const { db, statements, reset } = await countingDb();
		const svc = notesService(db);
		const as1 = asTenant(1);
		reset();
		const failed = await caught(
			svc.massCreate(
				[
					{ doc_id: 1, body: "a" },
					{ doc_id: 4, body: "b" },
					{ doc_id: 2, body: "c" },
					{ doc_id: 5, body: "d" },
				] as any,
				as1,
			),
		);
		expect(failed).toBeInstanceOf(BulkOperationException);
		expect(failed.errors.map((e: any) => e.index)).toEqual([1, 3]);
		expect(statements().filter((q) => /from "docs"/.test(q))).toHaveLength(1);
		expect(failed.errors[0].error.getResponse()).toEqual(
			(
				await caught(svc.create({ doc_id: 999, body: "x" } as any, as1))
			).getResponse(),
		);
		expect(await svc.count(undefined, as1)).toBe(1);

		const updated = await caught(
			svc.massUpdate([1], { doc_id: 5 } as any, as1),
		);
		expect(updated).toBeInstanceOf(BulkOperationException);
		expect(updated.errors).toMatchObject([{ id: 1 }]);
		const upserted = await caught(
			svc.massUpsert([{ id: 1, doc_id: 4, body: "x" }] as any, {}, as1),
		);
		expect(upserted).toBeInstanceOf(BulkOperationException);
		expect(upserted.errors).toMatchObject([{ index: 0 }]);
	});

	it("leaves an unscoped call and a related table without the scope column alone", async () => {
		const db = await freshDb();
		// skipScope: no tenant, nothing to check.
		await expect(
			notesService(db).create({ doc_id: 4, body: "admin" } as any, {
				skipScope: true,
			}),
		).resolves.toMatchObject({ doc_id: 4 });
		// Comments point at authors, which have no tenant column.
		const scoped = new Svc({
			...base(db, comments),
			primaryKey: "uid",
			scope: () => ({ author_id: 1 }),
			relations: { author: { table: authors, localKey: "author_id" } },
		});
		await expect(scoped.create({ body: "hi" } as any)).resolves.toMatchObject({
			author_id: 1,
		});
	});
});

describe("3.7.2: filters inside counts are depth capped (A-07)", () => {
	it("refuses a 20,000 level count filter with a 400, not a stack overflow", async () => {
		const svc = authorsWithPosts(await sharedDb());
		let filter: any = { title: "x" };
		for (let i = 0; i < 20_000; i++) filter = { not: filter };
		const error = await expect400(
			svc.findAll(undefined, {}, { counts: { posts: filter } }),
		);
		expect(error.message).toMatch(/nested too deeply/);
	});
});

describe("3.7.2: the depth check survives a huge list (A-06)", () => {
	it("walks a 300,000 item IN list without overflowing the stack", () => {
		const list = Array.from({ length: 300_000 }, (_, i) => i);
		expect(() => assertFilterDepth({ id: { in: list } })).not.toThrow();
	});
});

describe("3.7.2: full-text search over a NULL column (A-14)", () => {
	const articles = pgTable("articles", {
		id: serial("id").primaryKey(),
		title: text("title").notNull(),
		body: text("body"),
	});

	it("still finds a row whose other column is NULL", async () => {
		const log: string[] = [];
		const db = await freshDb(log);
		await db.$client.exec(`
			CREATE TABLE articles (id serial PRIMARY KEY, title text NOT NULL, body text);
			INSERT INTO articles (title, body) VALUES
				('postgres tuning', 'a body'), ('postgres basics', NULL);
		`);
		const svc = new Svc({
			...base(db, articles),
			softDelete: { enabled: false, column: "deleted_at" },
			timestamps: undefined,
		});
		expect((await svc.fullTextSearch("postgres", ["title"])).total).toBe(2);
		const both = await svc.fullTextSearch("postgres", ["title", "body"]);
		expect(both.total).toBe(2);
		expect(both.data).toHaveLength(2);
		const listed = await svc.findAll(
			undefined,
			{},
			{
				search: {
					term: "postgres",
					columns: ["title", "body"],
					mode: "fullText",
				},
			},
		);
		expect(listed.total).toBe(2);
		// The expression a GIN index has to repeat to be used.
		expect(log.join("\n")).toContain(
			`to_tsvector('english', coalesce("articles"."title", '')) || to_tsvector('english', coalesce("articles"."body", ''))`,
		);
	});
});

// ---------------------------------------------------------------------------
// 3.8.0 performance. Statement shapes and counts come from Drizzle's logger,
// plans from EXPLAIN on the exact statement the service sent.
// ---------------------------------------------------------------------------

describe("3.8.0 P-01: keyset pages seek instead of filtering", () => {
	// The data statement of the second page of a walk, with its parameters.
	async function secondPage(
		svcOf: (db: any) => Svc,
		pagination: any,
		options?: any,
	) {
		const log: string[] = [];
		const params: unknown[][] = [];
		const db = await freshDb(log, params);
		const svc = svcOf(db);
		const first = await svc.findByCursor(
			{},
			{ limit: 3, ...pagination },
			options,
		);
		log.length = 0;
		params.length = 0;
		await svc.findByCursor(
			{},
			{ limit: 3, ...pagination, cursor: first.nextCursor },
			options,
		);
		return { db, query: log[0]!, params: params[0]! };
	}

	it("drops IS NULL for NOT NULL and primary key columns and adds a leading bound", async () => {
		const desc = await secondPage(postsService, {
			sortBy: "views",
			sortOrder: "desc",
		});
		expect(desc.query).not.toMatch(/"views" is null/);
		expect(desc.query).not.toMatch(/"id" is null/);
		expect(desc.query).toMatch(/"posts"\."views" <= \$\d+ and \(/);

		const asc = await secondPage(postsService, { sortBy: "views" });
		expect(asc.query).not.toMatch(/"(views|id)" is null/);
		// Same direction, no NULLs: one row comparison.
		expect(asc.query).toContain('("posts"."views", "posts"."id") > ($');

		const pk = await secondPage(postsService, {});
		expect(pk.query).not.toMatch(/"id" is null/);
	});

	it("keeps the NULL branch for nullable and relation sort columns", async () => {
		// published_at is nullable: NULLs come last ascending on Postgres, so
		// they stay reachable and the bound is left out.
		const asc = await secondPage(postsService, { sortBy: "published_at" });
		expect(asc.query).toMatch(/"posts"\."published_at" is null/);
		expect(asc.query).not.toMatch(/"published_at" >=/);
		// Descending, the 15 NULLs came first and are behind a cursor on a
		// date: bounded.
		const desc = await secondPage(postsService, {
			sortBy: "published_at",
			sortOrder: "desc",
			limit: 17,
		});
		expect(desc.query).toMatch(/"posts"\."published_at" <= \$\d+/);
		// A LEFT JOIN can make a NOT NULL relation column NULL.
		const relation = await secondPage(
			postsService,
			{ sortBy: ["author.name"] },
			{ relations: ["author"] },
		);
		expect(relation.query).toMatch(/"authors"\."name" is null/);
	});

	it("reads a projected sort column from the row instead of selecting it twice", async () => {
		const plain = await secondPage(postsService, { sortBy: "views" });
		const projection = plain.query.slice(0, plain.query.indexOf(" from "));
		expect(projection.match(/"views"/g)).toHaveLength(1);
		expect(projection.match(/"id"/g)).toHaveLength(1);
		// A date column is still hidden, cast to text for its microseconds.
		const dated = await secondPage(postsService, { sortBy: "created_at" });
		expect(dated.query).toContain('cast("created_at" as text)');
	});

	it("uses an index on (sort column, id) as an index condition", async () => {
		for (const sortOrder of ["asc", "desc"] as const) {
			const page = await secondPage(postsService, {
				sortBy: "views",
				sortOrder,
			});
			const client = page.db.$client as PGlite;
			await client.exec(
				"CREATE INDEX posts_views_id ON posts (views, id); SET enable_seqscan = off; SET enable_bitmapscan = off;",
			);
			const plan = await client.query<any>(
				`EXPLAIN ${page.query}`,
				page.params as any[],
			);
			const text = plan.rows.map((row) => row["QUERY PLAN"]).join("\n");
			expect(text).toMatch(/Index Cond: .*views/);
		}
	});
});

describe("3.8.0 P-06: a stored tsvector column searches as is", () => {
	const tsvector = customType<{ data: string }>({
		dataType: () => "tsvector",
	});
	const pages = pgTable("pages", {
		id: serial("id").primaryKey(),
		title: text("title").notNull(),
		body: text("body"),
		search: tsvector("search"),
	});

	it("matches through the column without wrapping it in to_tsvector", async () => {
		const log: string[] = [];
		const db = await freshDb(log);
		await db.$client.exec(`
			CREATE TABLE pages (
				id serial PRIMARY KEY, title text NOT NULL, body text,
				search tsvector GENERATED ALWAYS AS (
					to_tsvector('english', coalesce(title, '') || ' ' || coalesce(body, ''))
				) STORED
			);
			CREATE INDEX pages_search ON pages USING gin (search);
			INSERT INTO pages (title, body) VALUES
				('postgres tuning', 'a body'), ('postgres basics', NULL), ('mysql', 'x');
		`);
		const svc = new Svc({
			...base(db, pages),
			softDelete: { enabled: false, column: "deleted_at" },
			timestamps: undefined,
		});
		const found = await svc.fullTextSearch("postgres", ["search"]);
		expect(found.total).toBe(2);
		expect(found.data.map((row: any) => row.title).sort()).toEqual([
			"postgres basics",
			"postgres tuning",
		]);
		const listed = await svc.findAll(
			undefined,
			{},
			{ search: { term: "tuning", columns: ["search"], mode: "fullText" } },
		);
		expect(listed.data.map((row: any) => row.title)).toEqual([
			"postgres tuning",
		]);
		const sent = log.join("\n");
		expect(sent).toContain(`"pages"."search" @@ plainto_tsquery('english', $`);
		expect(sent).not.toMatch(/to_tsvector\([^)]*"search"/);
		// Mixed with a text column, the tsvector is coalesced, not converted.
		log.length = 0;
		const mixed = await svc.fullTextSearch("mysql", ["search", "title"]);
		expect(mixed.total).toBe(1);
		expect(log[0]).toContain(
			`coalesce("pages"."search", ''::tsvector) || to_tsvector('english', coalesce("pages"."title", ''))`,
		);
	});
});

describe("3.8.0 P-03 / F6: single-row writes without the read first", () => {
	// A row of posts as stored, soft-deleted or not.
	const stored = async (db: any, id: number) =>
		(await db.select().from(posts).where(eq(posts.id, id)))[0];

	it("sends one statement per write on the happy path", async () => {
		const { db, reset, statements } = await countingDb();
		const svc = postsService(db);
		const runs: Array<[string, () => Promise<unknown>]> = [
			["update", () => svc.update(1, { title: "u" })],
			["softDelete", () => svc.softDelete(2)],
			["restore", () => svc.restore(2)],
			["delete", () => svc.delete(3)],
			["forceDelete", () => svc.forceDelete(4)],
		];
		for (const [name, run] of runs) {
			reset();
			await run();
			expect([name, statements().length]).toEqual([name, 1]);
		}
		expect((await stored(db, 1)).title).toBe("u");
		expect(await stored(db, 3)).toBeUndefined();
		// Versioned and scoped: still one statement, the version in the WHERE.
		const docsDb = await countingDb();
		const docs = docsService(docsDb.db);
		docsDb.reset();
		const doc = await docs.update(
			1,
			{ title: "v2" },
			{
				...asTenant(1),
				expectedVersion: 1,
			},
		);
		expect(doc.version).toBe(2);
		expect(docsDb.statements()).toHaveLength(1);
		expect(docsDb.statements()[0]).toMatch(/"docs"\."version" = \$/);
	});

	it("answers a miss with the guard's 404 or 409", async () => {
		const db = await freshDb();
		const svc = postsService(db);
		expect((await caught(svc.update(999, { title: "x" }))).getStatus()).toBe(
			404,
		);
		expect((await caught(svc.softDelete(999))).getStatus()).toBe(404);
		expect((await caught(svc.delete(999))).getStatus()).toBe(404);
		await svc.softDelete(5);
		// A soft-deleted row is not there for update or a second softDelete.
		expect((await caught(svc.update(5, { title: "x" }))).getStatus()).toBe(404);
		expect((await caught(svc.softDelete(5))).getStatus()).toBe(404);
		expect((await caught(svc.delete(5))).getStatus()).toBe(404);
		expect(await stored(db, 5)).toBeDefined();
		// Restore on a live row stays a 404 and writes nothing.
		const before = await stored(db, 6);
		expect((await caught(svc.restore(6))).getStatus()).toBe(404);
		expect(await stored(db, 6)).toEqual(before);
		// A bad body on a missing row is still the 404, as when the guard ran
		// first.
		expect((await caught(svc.update(999, {}))).getStatus()).toBe(404);
		expect((await caught(svc.update(7, {}))).getStatus()).toBe(400);

		const docs = docsService(db);
		const stale = await caught(
			docs.update(1, { title: "x" }, { ...asTenant(1), expectedVersion: 7 }),
		);
		expect(stale).toBeInstanceOf(StaleVersionException);
		expect(stale.getStatus()).toBe(409);
		expect(
			(
				await caught(
					docs.update(
						99,
						{ title: "x" },
						{ ...asTenant(1), expectedVersion: 1 },
					),
				)
			).getStatus(),
		).toBe(404);
		// Another tenant's row is a 404, not a 409.
		expect(
			(
				await caught(
					docs.update(
						4,
						{ title: "x" },
						{ ...asTenant(1), expectedVersion: 7 },
					),
				)
			).getStatus(),
		).toBe(404);
		const staleDelete = await caught(
			docs.delete(2, { ...asTenant(1), expectedVersion: 3 }),
		);
		expect(staleDelete).toBeInstanceOf(StaleVersionException);
		expect(
			(
				await caught(docs.softDelete(2, { ...asTenant(1), expectedVersion: 3 }))
			).getStatus(),
		).toBe(409);
	});

	it("keeps the guard first when a before hook can observe the row", async () => {
		const { db, reset, statements } = await countingDb();
		const seen: unknown[] = [];
		class Hooked extends Svc {
			protected override async beforeUpdate(id: any, data: any) {
				seen.push(id);
				return data;
			}
		}
		const svc = new Hooked({
			...base(db, posts),
			relations: { author: { table: authors, localKey: "author_id" } },
		});
		reset();
		await svc.update(1, { title: "h" });
		expect(verbs(statements())).toEqual(["select", "update"]);
		// The hook never runs for a row that is not there.
		expect((await caught(svc.update(999, { title: "h" }))).getStatus()).toBe(
			404,
		);
		expect(seen).toEqual([1]);
		// A before event is observable too.
		const bus = new CrudEventBus();
		const events: string[] = [];
		bus.subscribe({ beforeWrite: (e) => void events.push(e.operation) });
		const evented = postsService(db, { events: bus });
		expect((await caught(evented.softDelete(999))).getStatus()).toBe(404);
		expect(events).toEqual([]);
		reset();
		await evented.softDelete(1, { skipEvents: true });
		expect(statements()).toHaveLength(1);
	});

	it("does not write a row a hook soft-deleted between the guard and the write", async () => {
		const db = await freshDb();
		const trash = (id: number) =>
			db.update(posts).set({ deleted_at: new Date() }).where(eq(posts.id, id));
		class Racing extends Svc {
			protected override async beforeUpdate(id: any, data: any) {
				await trash(id);
				return data;
			}
			protected override async beforeDelete(id: any) {
				await trash(id);
			}
			protected override async beforeRestore(id: any) {
				await db
					.update(posts)
					.set({ deleted_at: null })
					.where(eq(posts.id, id));
			}
		}
		const svc = new Racing(base(db, posts));
		const before = await stored(db, 8);
		expect((await caught(svc.update(8, { title: "lost" }))).getStatus()).toBe(
			404,
		);
		expect((await stored(db, 8)).title).toBe(before.title);
		// delete() of a row trashed meanwhile does not hard-delete it.
		expect((await caught(svc.delete(9))).getStatus()).toBe(404);
		expect(await stored(db, 9)).toBeDefined();
		// restore() of a row restored meanwhile writes nothing.
		await trash(10);
		const trashed = await stored(db, 10);
		expect((await caught(svc.restore(10))).getStatus()).toBe(404);
		expect((await stored(db, 10)).updated_at).toEqual(trashed.updated_at);
	});
});

describe("3.8.0 P-04 / F4: savepoints only where a failure needs them", () => {
	const savepoints = (log: string[]) =>
		log.filter((query) => /savepoint/i.test(query));
	const errorsOf = (error: any) => (error.getResponse() as any).errors;

	it("sends no savepoint in a transaction the service owns", async () => {
		const log: string[] = [];
		const db = await freshDb(log);
		const posts = postsService(db);
		const authors = authorsService(db);
		const ids = [1, 2, 3];
		const runs: Array<[string, () => Promise<unknown>, string[]]> = [
			[
				"massCreate",
				() =>
					authors.massCreate([{ name: "N", email: "n@x.io", role: "writer" }]),
				["insert"],
			],
			[
				"massUpsert",
				() =>
					authors.massUpsert(
						[{ name: "Ann 2", email: "ann@x.io", role: "admin" }],
						{ conflictTarget: "email" },
					),
				["insert"],
			],
			[
				"massUpdate",
				() => posts.massUpdate(ids, { title: "m" }),
				["select", "update"],
			],
			["massSoftDelete", () => posts.massSoftDelete(ids), ["select", "update"]],
			["massRestore", () => posts.massRestore(ids), ["select", "update"]],
			["massDelete", () => posts.massDelete([28, 29]), ["select", "delete"]],
		];
		for (const [name, run, verbsSent] of runs) {
			log.length = 0;
			await run();
			expect([name, savepoints(log)]).toEqual([name, []]);
			expect([name, verbs(log)]).toEqual([name, verbsSent]);
		}
	});

	it("reports the same failing items after the rollback, and writes nothing", async () => {
		const log: string[] = [];
		const db = await freshDb(log);
		const authors = authorsService(db);
		const dup = await caught(
			authors.massCreate([
				{ name: "New", email: "new@x.io", role: "writer" },
				{ name: "Dup", email: "bob@x.io", role: "writer" },
			]),
		);
		expect(dup).toBeInstanceOf(BulkOperationException);
		expect(errorsOf(dup)).toEqual([
			{ index: 1, status: 409, message: expect.any(String) },
		]);
		expect(await authors.findOne({ email: "new@x.io" })).toBeNull();
		// The replay ran in its own transaction, rolled back.
		expect(savepoints(log).length).toBeGreaterThan(0);

		const posts = postsService(db);
		const bad = await caught(
			posts.massUpdate([1, 2], { author_id: 99 } as any),
		);
		expect(errorsOf(bad)).toEqual([
			{ id: 1, status: 400, message: expect.any(String) },
			{ id: 2, status: 400, message: expect.any(String) },
		]);
		expect((await posts.find(1))?.author_id).toBe(1);
	});

	it("keeps savepoints in a caller's transaction, which survives a failed item", async () => {
		const log: string[] = [];
		const db = await freshDb(log);
		const posts = postsService(db);
		await db.transaction(async (tx: any) => {
			const error = await caught(
				posts.massUpdate([1, 999], { title: "x" }, { transaction: tx }),
			);
			expect(errorsOf(error)).toEqual([
				{ id: 999, status: 404, message: expect.any(String) },
			]);
			const dup = await caught(
				authorsService(db).massCreate(
					[{ name: "Dup", email: "ann@x.io", role: "writer" }],
					{ transaction: tx },
				),
			);
			expect(errorsOf(dup)).toEqual([
				{ index: 0, status: 409, message: expect.any(String) },
			]);
			// The caller's transaction is still usable and commits.
			await posts.update(2, { title: "after" }, { transaction: tx });
		});
		expect((await posts.find(2))?.title).toBe("after");
		expect(savepoints(log).length).toBeGreaterThan(0);
	});

	it("diagnoses inside the transaction once an event subscriber was handed it", async () => {
		const db = await freshDb();
		const bus = new CrudEventBus();
		bus.subscribe({
			beforeWrite: async (event) => {
				if (event.operation !== "create") return;
				await (event.transaction as any)
					.insert(authors)
					.values({ name: "Sub", email: "sub@x.io", role: "writer" });
			},
		});
		const svc = new Svc({ ...base(db, authors), events: bus });
		// The duplicate only exists inside the transaction, written by the
		// subscriber; a replay outside it could not name the item.
		const error = await caught(
			svc.massCreate([
				{ name: "Ok", email: "ok@x.io", role: "writer" },
				{ name: "Dup", email: "sub@x.io", role: "writer" },
			]),
		);
		expect(error).toBeInstanceOf(BulkOperationException);
		expect(errorsOf(error)).toEqual([
			{ index: 1, status: 409, message: expect.any(String) },
		]);
		expect(await authorsService(db).findOne({ email: "sub@x.io" })).toBeNull();
	});
});

describe("3.8.0 P-05 / F5: one UPDATE per distinct SET in massUpdate", () => {
	// beforeUpdate gives even and odd ids different titles: two SETs.
	class Parity extends Svc {
		protected override async beforeUpdate(id: any, data: any) {
			return { ...data, title: `${data.title}-${id % 2}` };
		}
	}
	const ids = Array.from({ length: 40 }, (_, i) => 40 - i);

	it("sends 2 UPDATEs for 2 distinct SETs over 40 ids, in input order", async () => {
		const log: string[] = [];
		const db = await freshDb(log);
		const svc = new Parity(base(db, posts));
		await svc.massCreate(
			Array.from({ length: 10 }, (_, i) => ({
				title: `Extra ${i}`,
				author_id: 1,
				status: "draft",
				views: 0,
			})),
		);
		log.length = 0;
		const rows = await svc.massUpdate(ids, { title: "t" });
		expect(verbs(log)).toEqual(["select", "update", "update"]);
		expect(log.filter((query) => /savepoint/i.test(query))).toEqual([]);
		expect(rows.map((row: any) => row.id)).toEqual(ids);
		expect(rows.map((row: any) => row.title)).toEqual(
			ids.map((id) => `t-${id % 2}`),
		);
	});

	it("still names the failing ids across groups", async () => {
		const db = await freshDb();
		class Moves extends Svc {
			protected override async beforeUpdate(id: any, data: any) {
				// Ids 1 and 2 point at a missing author, in two different SETs.
				return { ...data, author_id: id <= 2 ? 90 + id : 1 };
			}
		}
		const svc = new Moves(base(db, posts));
		const error = await caught(svc.massUpdate([3, 1, 2, 4], { title: "m" }));
		expect(error).toBeInstanceOf(BulkOperationException);
		expect((error.getResponse() as any).errors).toEqual([
			{ id: 1, status: 400, message: expect.any(String) },
			{ id: 2, status: 400, message: expect.any(String) },
		]);
		expect((await svc.find(3))?.title).toBe("Post 3");
	});
});

describe("3.8.0 F2: relation loaders chunk their IN lists", () => {
	// Four parent keys per batched relation query instead of tens of
	// thousands, so the spec stays far under PGlite's 32,767 bound values.
	class Chunked extends Svc {
		protected override relationChunkSize(): number {
			return 4;
		}
	}
	const config = (db: any): SqlCrudConfig => ({
		...base(db, authors),
		relations: {
			posts: {
				table: posts,
				type: "hasMany",
				foreignKey: "author_id",
				orderBy: [{ column: "id", order: "desc" }],
				relations: {
					tags: postTagsRelation,
					author: { table: authors, localKey: "author_id" },
				},
			},
		},
	});

	it("loads a nested level of 30 parents in ceil(30 / 4) queries, grouped as one query would", async () => {
		const { db, reset, statements } = await countingDb();
		const relations = ["posts", "posts.tags", "posts.author"];
		const whole = await new Svc(config(db)).findAll({}, {}, { relations });
		reset();
		const chunked = await new Chunked(config(db)).findAll(
			{},
			{},
			{ relations },
		);
		expect(chunked.data).toEqual(whole.data);
		// data + count, posts (3 author ids: 1), tags over 30 post ids (8),
		// author over 3 author ids (1).
		expect(statements()).toHaveLength(2 + 1 + 8 + 1);
		const ann = chunked.data[0] as any;
		expect(ann.posts.map((p: any) => p.id)).toEqual([
			28, 25, 22, 19, 16, 13, 10, 7, 4, 1,
		]);
		expect(ann.posts.at(-1).tags.map((t: any) => t.name)).toEqual([
			"news",
			"tech",
		]);
	});

	it("counts in chunks too", async () => {
		const { db, reset, statements } = await countingDb();
		const svc = new Chunked({
			...base(db, posts),
			relations: { tags: postTagsRelation },
		});
		reset();
		const page = await svc.findAll({}, { limit: 30 }, { counts: ["tags"] });
		expect(statements()).toHaveLength(2 + 8);
		expect(page.data.slice(0, 3).map((p: any) => p._count.tags)).toEqual([
			2, 1, 0,
		]);
	});
});

describe("3.8.0 P-08 / F8 / F9 / F10: statement trims", () => {
	// Every statement, plus "begin" and "end" around each transaction the
	// client opens, so a statement can be placed inside or after it.
	async function tracedDb() {
		const log: string[] = [];
		const db = await freshDb(log);
		const client = db.$client;
		const open = client.transaction.bind(client);
		client.transaction = async (run: any) => {
			log.push("begin");
			try {
				return await open(run);
			} finally {
				log.push("end");
			}
		};
		return { db, log, verbs: () => verbs(log) };
	}

	it("exists runs one statement, whatever relations and counts say", async () => {
		const { db, log } = await tracedDb();
		const svc = postsWithTags(db);
		log.length = 0;
		expect(
			await svc.exists(1, { relations: ["author", "tags"], counts: ["tags"] }),
		).toBe(true);
		expect(log).toHaveLength(1);
		expect(log[0]).not.toContain("authors");
		// Still checked against the allowlists.
		await expect400(
			postsWithTags(db, { loadableRelations: [] }).exists(1, {
				relations: ["tags"],
			}),
		);
	});

	it("links a new row's many-to-many ids without asking what it already links", async () => {
		const { db, verbs: sent, log } = await tracedDb();
		const svc = postsWithTags(db, { writableRelations: ["tags"] });
		log.length = 0;
		const post = await svc.create({
			title: "Linked",
			author_id: 1,
			status: "draft",
			views: 0,
			tags: [1, 2],
		});
		// The row, the targets check, the links.
		expect(sent()).toEqual(["begin", "insert", "select", "insert", "end"]);
		const tags = await svc.find(post.id, { relations: ["tags"] });
		expect(tags?.tags.map((t: any) => t.name)).toEqual(["news", "tech"]);
	});

	it("attach, sync and detach read the row once", async () => {
		const { db, verbs: sent, log } = await tracedDb();
		const svc = postsWithTags(db);
		log.length = 0;
		await svc.attach(2, "tags", [2]);
		// Row, targets, existing links, INSERT, the relation.
		expect(sent()).toEqual([
			"begin",
			"select",
			"select",
			"select",
			"insert",
			"select",
			"end",
		]);
		log.length = 0;
		const synced = await svc.sync(2, "tags", [1]);
		expect(synced.tags.map((t: any) => t.name)).toEqual(["news"]);
		expect(sent()).toEqual([
			"begin",
			"select",
			"select",
			"select",
			"delete",
			"select",
			"end",
		]);
		log.length = 0;
		const detached = await svc.detach(2, "tags", undefined, {
			relations: ["author"],
			select: ["id", "title", "author.name"],
		});
		expect(sent()).toEqual(["begin", "select", "delete", "select", "end"]);
		expect(detached).toEqual({
			id: 2,
			title: "Post 2",
			author: { name: "Bob" },
			tags: [],
		});
	});

	it("loads a mass write's relations after its own transaction commits", async () => {
		const { db, verbs: sent, log } = await tracedDb();
		const svc = postsWithTags(db);
		log.length = 0;
		const rows = await svc.massUpdate(
			[1, 2],
			{ title: "m" },
			{
				relations: ["tags", "author"],
				counts: ["tags"],
			},
		);
		expect(sent()).toEqual([
			"begin",
			"select",
			"update",
			"end",
			"select",
			"select",
			"select",
		]);
		expect(rows.map((row: any) => row.tags.length)).toEqual([2, 1]);
		expect(rows.map((row: any) => row._count.tags)).toEqual([2, 1]);
		expect(rows[0].author.name).toBe("Ann");
		// A count with a filter can fail on its value: it stays inside, so a
		// failure still rolls the write back.
		log.length = 0;
		await svc.massUpdate(
			[1],
			{ title: "n" },
			{
				counts: { tags: { name: "news" } },
			},
		);
		expect(sent()).toEqual(["begin", "select", "update", "select", "end"]);
		// So does everything in a caller's transaction.
		log.length = 0;
		await db.transaction((tx: any) =>
			svc.massCreate(
				[{ title: "c", author_id: 1, status: "draft", views: 0 }],
				{ transaction: tx, relations: ["tags"] },
			),
		);
		expect(sent()).toEqual([
			"begin",
			"savepoint",
			"insert",
			"release",
			"select",
			"end",
		]);
	});

	it("resolves the tenant scope once per call", async () => {
		const db = await freshDb();
		let calls = 0;
		const svc = docsService(db, {
			scope: (ctx) => {
				calls++;
				return { tenant_id: ctx.tenantId };
			},
		});
		const t1 = asTenant(1);
		const runs: Array<[string, () => Promise<unknown>]> = [
			[
				"findAll",
				() =>
					svc.findAll(
						{ notes: { some: { body: "n1" } } },
						{},
						{ ...t1, relations: ["notes"], counts: ["notes"] },
					),
			],
			[
				"findByCursor",
				() => svc.findByCursor({}, {}, { ...t1, relations: ["notes"] }),
			],
			["find", () => svc.find(1, { ...t1, relations: ["notes"] })],
			["count", () => svc.count({}, t1)],
			["create", () => svc.create({ title: "N", slug: "n" }, t1)],
			["update", () => svc.update(1, { title: "U" }, t1)],
			["massUpdate", () => svc.massUpdate([1, 2], { title: "M" }, t1)],
			["softDelete", () => svc.softDelete(3, t1)],
		];
		for (const [name, run] of runs) {
			calls = 0;
			await run();
			expect([name, calls]).toEqual([name, 1]);
		}
	});
});

describe("3.8.0: protected override points still win", () => {
	it("routes errors and keyset conditions through a subclass's overrides", async () => {
		const db = await freshDb();
		const seen = new Set<string>();
		class Custom extends Svc {
			protected override toClientError(error: any, operation?: any) {
				if (this.isUniqueViolation(error)) {
					return new HttpException("taken", 418);
				}
				return super.toClientError(error, operation);
			}
			protected override isUniqueViolation(error: any): boolean {
				seen.add("isUniqueViolation");
				return super.isUniqueViolation(error);
			}
			protected override keysetCondition(specs: any[], values: unknown[]) {
				seen.add("keysetCondition");
				return super.keysetCondition(specs, values);
			}
			protected override runSet<R>(...args: Parameters<Svc["runSet"]>) {
				seen.add("runSet");
				return super.runSet(...args) as Promise<R>;
			}
		}
		const authorsSvc = new Custom(base(db, authors));
		const dup = { name: "Dup", email: "ann@x.io", role: "writer" };
		expect((await caught(authorsSvc.create(dup))).getStatus()).toBe(418);
		const bulk = await caught(authorsSvc.massCreate([dup]));
		expect((bulk.getResponse() as any).errors).toEqual([
			{ index: 0, status: 418, message: "taken" },
		]);
		const postsSvc = new Custom(base(db, posts));
		const first = await postsSvc.findByCursor({}, { limit: 2 });
		await postsSvc.findByCursor({}, { limit: 2, cursor: first.nextCursor });
		expect([...seen].sort()).toEqual([
			"isUniqueViolation",
			"keysetCondition",
			"runSet",
		]);
	});
});

// 3.8.1: the findings of the 3.8.0 audit (D-01 to D-11).

// A fresh database with the standard fixture plus `ddl`, for a finding that
// needs a table of its own.
async function customDb(ddl: string, log?: string[]): Promise<any> {
	const db = await freshDb(log);
	await db.$client.exec(ddl);
	return db;
}

describe("3.8.1 D-01: the scope memo stays with its service", () => {
	// A table scoped by org_id, a different column from the docs' tenant_id.
	const orgItems = pgTable("org_items", {
		id: serial("id").primaryKey(),
		org_id: integer("org_id"),
		name: text("name").notNull(),
	});
	const orgDdl = `CREATE TABLE org_items (
  id serial PRIMARY KEY, org_id integer, name text NOT NULL
);
INSERT INTO org_items (org_id, name) VALUES (7, 'seven'), (8, 'eight');`;
	const orgService = (db: any) =>
		new Svc({
			...base(db, orgItems),
			softDelete: undefined,
			timestamps: undefined,
			scope: (ctx) => ({ org_id: ctx.orgId }),
		});

	it("a service with a null scope does not hand it to a scoped one", async () => {
		const db = await freshDb();
		const orders = docsService(db);
		let seen: string[] = [];
		class NotesService extends Svc {
			protected override async prepareCreate(data: any, options?: any) {
				const row = await super.prepareCreate(data, options);
				const page = await orders.findAll({}, {}, options);
				seen = page.data.map((doc: any) => `${doc.tenant_id}:${doc.title}`);
				return row;
			}
		}
		const notesSvc = new NotesService({
			...base(db, notes),
			softDelete: { enabled: true, column: "deletedAt" },
			timestamps: { createdAt: "createdAt", updatedAt: "updatedAt" },
			scope: () => null,
		});
		await notesSvc.create({ body: "x" }, asTenant(1));
		const direct = await orders.findAll({}, {}, asTenant(1));
		expect(direct.data).toHaveLength(3);
		expect(seen).toEqual(
			direct.data.map((doc: any) => `${doc.tenant_id}:${doc.title}`),
		);
	});

	it("a second scoped service resolves its own scope, once per call", async () => {
		const db = await customDb(orgDdl);
		const resolved: string[] = [];
		const other = new Svc({
			...base(db, orgItems),
			softDelete: undefined,
			timestamps: undefined,
			scope: (ctx) => {
				resolved.push("org");
				return { org_id: ctx.orgId };
			},
		});
		let listed: unknown[] = [];
		let created: any;
		class Orders extends Svc {
			protected override async prepareCreate(data: any, options?: any) {
				const row = await super.prepareCreate(data, options);
				created = await other.create({ name: "from docs" }, options);
				listed = (await other.findAll({}, {}, options)).data.map(
					(item: any) => item.name,
				);
				return row;
			}
		}
		const orders = new Orders({
			...base(db, docs),
			scope: (ctx) => {
				resolved.push("docs");
				return { tenant_id: ctx.tenantId };
			},
			versionColumn: "version",
		});
		const ctx = { context: { tenantId: 1, orgId: 7 } };
		await orders.create({ title: "T", slug: "t" }, ctx);
		expect(created).toMatchObject({ org_id: 7, name: "from docs" });
		expect(listed).toEqual(["seven", "from docs"]);
		// Each service resolves its own scope once for the whole call.
		expect(resolved.sort()).toEqual(["docs", "org"]);
		expect(await orgService(db).count({}, { context: { orgId: 7 } })).toBe(2);
	});

	it("a nested call with another context resolves that context", async () => {
		const db = await freshDb();
		let theirs: string[] = [];
		class Orders extends Svc {
			protected override async prepareCreate(data: any, options?: any) {
				const row = await super.prepareCreate(data, options);
				const page = await this.findAll(
					{},
					{},
					{
						...options,
						context: { tenantId: 2 },
					},
				);
				theirs = page.data.map((doc: any) => doc.title);
				return row;
			}
		}
		const orders = new Orders({
			...base(db, docs),
			scope: (ctx) => ({ tenant_id: ctx.tenantId }),
		});
		const created = await orders.create({ title: "T", slug: "t" }, asTenant(1));
		expect(created.tenant_id).toBe(1);
		expect(theirs).toEqual(["Four", "Five"]);
	});
});

describe("3.8.1 D-02: a text key compares exactly", () => {
	// Two tenants own codes that differ only in case.
	const codes = pgTable("codes", {
		code: text("code").primaryKey(),
		tenant_id: integer("tenant_id").notNull(),
	});
	const codedItems = pgTable("coded_items", {
		id: serial("id").primaryKey(),
		tenant_id: integer("tenant_id").notNull(),
		code: text("code"),
	});
	const codeLinks = pgTable("code_links", {
		item_id: integer("item_id").notNull(),
		code: text("code").notNull(),
	});
	const ddl = `CREATE TABLE codes (code text PRIMARY KEY, tenant_id integer NOT NULL);
CREATE TABLE coded_items (
  id serial PRIMARY KEY, tenant_id integer NOT NULL,
  code text REFERENCES codes(code)
);
CREATE TABLE code_links (
  item_id integer NOT NULL REFERENCES coded_items(id),
  code text NOT NULL REFERENCES codes(code),
  PRIMARY KEY (item_id, code)
);
INSERT INTO codes VALUES ('US', 1), ('us', 2);
INSERT INTO coded_items (tenant_id) VALUES (1);`;
	const itemsSvc = (db: any) =>
		new Svc({
			...base(db, codedItems),
			softDelete: undefined,
			timestamps: undefined,
			scope: (ctx) => ({ tenant_id: ctx.tenantId }),
			relations: {
				codeRef: { table: codes, localKey: "code", references: "code" },
				links: {
					table: codes,
					type: "manyToMany",
					through: codeLinks,
					throughLocalKey: "item_id",
					throughForeignKey: "code",
					references: "code",
				},
			},
		});
	const t1 = asTenant(1);

	it("refuses a batch that names another tenant's key in another case", async () => {
		const db = await customDb(ddl);
		const svc = itemsSvc(db);
		await expect400(svc.create({ code: "us" }, t1));
		const batch = await caught(
			svc.massCreate([{ code: "US" }, { code: "us" }], t1),
		);
		expect(batch).toBeInstanceOf(BulkOperationException);
		expect(batch.errors.map((e: any) => e.index)).toEqual([1]);
		// The same answer as a key that is not there at all.
		const missing = await caught(
			svc.massCreate([{ code: "US" }, { code: "uS" }], t1),
		);
		expect(batch.getResponse()).toEqual(missing.getResponse());
		expect(await svc.count({}, t1)).toBe(1);
		await expect(svc.massCreate([{ code: "US" }], t1)).resolves.toHaveLength(1);
	});

	it("refuses to link another tenant's key in another case", async () => {
		const db = await customDb(ddl);
		const svc = itemsSvc(db);
		const linked = await caught(svc.attach(1, "links", ["US", "us"], t1));
		expect(linked).toBeInstanceOf(BulkOperationException);
		expect(linked.errors).toMatchObject([{ id: "us" }]);
		const row = await svc.attach(1, "links", ["US"], t1);
		expect(row.links.map((c: any) => c.code)).toEqual(["US"]);
	});
});

describe("3.8.1 D-03: nested children get the tenant key check", () => {
	const tAuthors = pgTable("t_authors", {
		id: serial("id").primaryKey(),
		tenant_id: integer("tenant_id").notNull(),
		name: text("name").notNull(),
	});
	const tCategories = pgTable("t_categories", {
		id: serial("id").primaryKey(),
		tenant_id: integer("tenant_id").notNull(),
	});
	const tPosts = pgTable("t_posts", {
		id: serial("id").primaryKey(),
		tenant_id: integer("tenant_id").notNull(),
		author_id: integer("author_id").notNull(),
		category_id: integer("category_id"),
		title: text("title").notNull(),
	});
	const ddl = `CREATE TABLE t_authors (
  id serial PRIMARY KEY, tenant_id integer NOT NULL, name text NOT NULL
);
CREATE TABLE t_categories (id serial PRIMARY KEY, tenant_id integer NOT NULL);
CREATE TABLE t_posts (
  id serial PRIMARY KEY, tenant_id integer NOT NULL,
  author_id integer NOT NULL REFERENCES t_authors(id),
  category_id integer REFERENCES t_categories(id),
  title text NOT NULL
);
INSERT INTO t_categories (tenant_id) VALUES (1), (2);`;
	// With `declare` off, posts.category is not declared and only the
	// database's foreign key sees a bad category_id.
	const authorsSvc = (db: any, declare = true) =>
		new Svc({
			...base(db, tAuthors),
			softDelete: undefined,
			timestamps: undefined,
			scope: (ctx) => ({ tenant_id: ctx.tenantId }),
			relations: {
				posts: {
					type: "hasMany",
					table: tPosts,
					foreignKey: "author_id",
					...(declare && {
						relations: {
							category: { table: tCategories, localKey: "category_id" },
						},
					}),
				},
			},
			writableRelations: ["posts"],
		});
	const t1 = asTenant(1);
	const withPost = (name: string, category_id: number) => ({
		name,
		posts: [{ title: "n", category_id }],
	});

	it("refuses a child key to another tenant's row like a missing one", async () => {
		const db = await customDb(ddl);
		const svc = authorsSvc(db);
		const theirs = await expect400(svc.create(withPost("a", 2), t1));
		const missing = await expect400(svc.create(withPost("b", 999), t1));
		expect(theirs.getResponse()).toEqual(missing.getResponse());
		// The same answer the database's own foreign key gives.
		const undeclared = await expect400(
			authorsSvc(db, false).create(withPost("c", 999), t1),
		);
		expect(theirs.getResponse()).toEqual(undeclared.getResponse());
		expect(await db.select().from(tAuthors)).toEqual([]);
		expect(await db.select().from(tPosts)).toEqual([]);
		const mine = await svc.create(withPost("d", 1), t1);
		expect(await db.select().from(tPosts)).toMatchObject([
			{ author_id: mine.id, category_id: 1, tenant_id: 1 },
		]);
	});
});

describe("3.8.1 D-11: the tenant key check sends its SELECTs together", () => {
	const pairs = pgTable("doc_pairs", {
		id: serial("id").primaryKey(),
		tenant_id: integer("tenant_id").notNull(),
		doc_id: integer("doc_id").notNull(),
		other_id: integer("other_id").notNull(),
	});
	const ddl = `CREATE TABLE doc_pairs (
  id serial PRIMARY KEY, tenant_id integer NOT NULL,
  doc_id integer NOT NULL, other_id integer NOT NULL
);`;

	it("starts every relation's SELECT before awaiting the first", async () => {
		const db = await customDb(ddl);
		const svc = new Svc({
			...base(db, pairs),
			softDelete: undefined,
			timestamps: undefined,
			scope: (ctx) => ({ tenant_id: ctx.tenantId }),
			relations: {
				doc: { table: docs, localKey: "doc_id" },
				other: { table: docs, localKey: "other_id" },
			},
		});
		const trace: string[] = [];
		const client = db.$client;
		const query = client.query.bind(client);
		client.query = async (text: string, ...rest: any[]) => {
			const checked = /from "docs"/.test(text);
			if (checked) trace.push("start");
			try {
				return await query(text, ...rest);
			} finally {
				if (checked) trace.push("end");
			}
		};
		await svc.create({ doc_id: 1, other_id: 2 }, asTenant(1));
		expect(trace).toEqual(["start", "start", "end", "end"]);
		// A failure is still named by the first relation that refuses it.
		const failed = await expect400(
			svc.create({ doc_id: 4, other_id: 5 }, asTenant(1)),
		);
		expect(failed.message).toContain("doc_id");
	});
});

describe("3.8.1 D-04: a missing row is a 404 ahead of a value the database refuses", () => {
	it("answers update(999) with a bad value as a 404, and a real row with the 400", async () => {
		const db = await freshDb();
		const svc = postsService(db);
		// One statement: the UPDATE itself fails on "abc", before any row.
		const missing = await caught(svc.update(999, { views: "abc" } as any));
		expect(missing.getStatus()).toBe(404);
		// The row exists: the value error stands.
		await expect400(svc.update(1, { views: "abc" } as any));
	});
});

describe("3.8.1 D-05: emitEvent and prepareUpdate overrides keep the read first", () => {
	it("never shows an emitEvent override a write to another tenant's row", async () => {
		const db = await freshDb();
		const seen: string[] = [];
		class Watched extends Svc {
			protected override async emitEvent(
				...args: Parameters<Svc["emitEvent"]>
			) {
				const [phase, operation, , payload] = args;
				seen.push(`${phase}:${operation}:${payload.ids?.join(",")}`);
				return super.emitEvent(...args);
			}
		}
		const svc = new Watched({
			...base(db, docs),
			scope: (ctx) => ({ tenant_id: ctx.tenantId }),
		});
		const t1 = asTenant(1);
		for (const run of [
			() => svc.update(4, { title: "x" }, t1),
			() => svc.softDelete(4, t1),
			() => svc.delete(4, t1),
		]) {
			expect((await caught(run())).getStatus()).toBe(404);
		}
		expect(seen).toEqual([]);
	});

	it("reads first when a subclass overrides prepareUpdate", async () => {
		const { db, reset, statements } = await countingDb();
		const prepared: unknown[] = [];
		class Prepared extends Svc {
			protected override prepareUpdate(data: any, options?: any) {
				prepared.push(data);
				return super.prepareUpdate(data, options);
			}
		}
		const svc = new Prepared(base(db, posts));
		reset();
		expect((await caught(svc.update(999, { title: "x" }))).getStatus()).toBe(
			404,
		);
		expect(prepared).toEqual([]);
		expect(statements()).toHaveLength(1);
	});
});

describe("3.8.1 D-06: massCreate loads its relations inside its transaction", () => {
	it("stores nothing when the relation load fails", async () => {
		const db = await freshDb();
		let fail = true;
		class Flaky extends Svc {
			protected override async loadWriteRelations(
				...args: Parameters<Svc["loadWriteRelations"]>
			) {
				// A transient read failure: a pool timeout, a dropped connection.
				if (fail && args[1].length > 0) throw new Error("load failed");
				return super.loadWriteRelations(...args);
			}
		}
		const svc = new Flaky({
			...base(db, posts),
			relations: { author: { table: authors, localKey: "author_id" } },
		});
		const row = { title: "once", author_id: 1, status: "draft", views: 0 };
		await expect(
			svc.massCreate([row], { relations: ["author"] }),
		).rejects.toThrow("load failed");
		expect(await svc.count({ title: "once" })).toBe(0);
		// The retry stores the row once.
		fail = false;
		const [created] = await svc.massCreate([row], { relations: ["author"] });
		expect(created.author.name).toBe("Ann");
		expect(await svc.count({ title: "once" })).toBe(1);
	});
});
