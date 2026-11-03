/**
 * The core CRUD paths, written once and run against every dialect that is not
 * PGlite: SQLite (libSQL, in memory, in the normal unit run) and MySQL (only
 * when MYSQL_URL points at a server, as in the CI MySQL job). Each dialect
 * spec supplies the Drizzle tables and a function that builds an empty schema;
 * the seed below goes through Drizzle, so it is the same everywhere.
 *
 * Seed: authors Ann (1), Bob (2), Cy (3). Posts 1-12 titled "Post n", by
 * author ((n - 1) % 3) + 1, views n % 4, score n for odd n and NULL for even
 * n. Tags news (1) and tech (2); post 1 has both, post 2 has news. Docs 1-2
 * belong to tenant 1, doc 3 to tenant 2.
 */

import { describe, expect, it } from "@jest/globals";
import { SqlBaseCrudService } from "../src/core/abstract/sql-base-crud.service";
import type { SqlCrudConfig } from "../src/core/interfaces/sql-crud-config.interface";
import type { SqlDialect } from "../src/core/types/sql.types";
import { BulkOperationException } from "../src/exceptions/crud.exceptions";

export interface DialectTables {
	authors: any;
	posts: any;
	tags: any;
	postTags: any;
	docs: any;
}

export interface DialectSetup {
	dialect: SqlDialect;
	tables: DialectTables;
	// An empty schema: every table created, no rows.
	emptyDb: () => Promise<any>;
}

export class Svc extends SqlBaseCrudService<any, any, any, any> {}

// Resolves to the thrown error so its type and HTTP status can be asserted.
export async function caught(promise: Promise<unknown>): Promise<any> {
	try {
		await promise;
	} catch (error) {
		return error;
	}
	throw new Error("expected the call to throw");
}

export async function expectStatus(promise: Promise<unknown>, status: number) {
	const error = await caught(promise);
	expect(error?.getStatus?.()).toBe(status);
	return error;
}

export async function seed(db: any, t: DialectTables): Promise<void> {
	await db.insert(t.authors).values([
		{ name: "Ann", email: "ann@x.io" },
		{ name: "Bob", email: "bob@x.io" },
		{ name: "Cy", email: "cy@x.io" },
	]);
	await db.insert(t.posts).values(
		Array.from({ length: 12 }, (_, i) => {
			const n = i + 1;
			return {
				title: `Post ${n}`,
				author_id: ((n - 1) % 3) + 1,
				views: n % 4,
				score: n % 2 === 1 ? n : null,
			};
		}),
	);
	await db.insert(t.tags).values([{ name: "news" }, { name: "tech" }]);
	await db.insert(t.postTags).values([
		{ post_id: 1, tag_id: 1 },
		{ post_id: 1, tag_id: 2 },
		{ post_id: 2, tag_id: 1 },
	]);
	await db.insert(t.docs).values([
		{ tenant_id: 1, title: "One", slug: "one" },
		{ tenant_id: 1, title: "Two", slug: "two" },
		{ tenant_id: 2, title: "Three", slug: "three" },
	]);
}

export function services(setup: DialectSetup, db: any) {
	const t = setup.tables;
	const base = (table: any, extra: Partial<SqlCrudConfig> = {}) =>
		new Svc({
			dialect: setup.dialect,
			db,
			table,
			primaryKey: "id",
			softDelete: { enabled: true, column: "deleted_at" },
			timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
			pagination: { defaultLimit: 20, maxLimit: 100 },
			sql: {
				caseSensitive: false,
				useReturning: setup.dialect !== "mysql",
				jsonSupport: true,
				enableFullTextSearch: false,
			},
			...extra,
		});
	return {
		authors: base(t.authors, {
			relations: {
				posts: { type: "hasMany", table: t.posts, foreignKey: "author_id" },
			},
		}),
		posts: base(t.posts, {
			relations: {
				author: { table: t.authors, localKey: "author_id" },
				tags: {
					type: "manyToMany",
					table: t.tags,
					through: t.postTags,
					throughLocalKey: "post_id",
					throughForeignKey: "tag_id",
				},
			},
		}),
		docs: base(t.docs, { versionColumn: "version" }),
		tenantDocs: base(t.docs, { scope: { tenant_id: 1 } }),
		base,
	};
}

const ids = (rows: any[]) => rows.map((row) => Number(row.id));

export function describeDialectContract(setup: DialectSetup): void {
	const fresh = async () => {
		const db = await setup.emptyDb();
		await seed(db, setup.tables);
		return { db, ...services(setup, db) };
	};

	describe(`${setup.dialect}: reads`, () => {
		it("creates a row and finds it again", async () => {
			const { authors } = await fresh();
			const row = await authors.create({ name: "Dee", email: "dee@x.io" });
			expect(Number(row.id)).toBe(4);
			expect(row.name).toBe("Dee");
			expect(row.created_at).toBeInstanceOf(Date);
			expect(await authors.find(4)).toMatchObject({ email: "dee@x.io" });
			expect(await authors.findOne({ email: "dee@x.io" })).toMatchObject({
				name: "Dee",
			});
		});

		it("filters, sorts and pages findAll", async () => {
			const { posts } = await fresh();
			const byAuthor = await posts.findAll({ author_id: 1 });
			expect(ids(byAuthor.data)).toEqual([1, 4, 7, 10]);
			expect(byAuthor.total).toBe(4);

			const sorted = await posts.findAll(
				{ views: { gte: 3 } },
				{ sortBy: "title" },
			);
			expect(ids(sorted.data)).toEqual([11, 3, 7]);

			const multi = await posts.findAll(undefined, {
				sortBy: ["-views", "id"],
				limit: 3,
			});
			expect(ids(multi.data)).toEqual([3, 7, 11]);

			const page = await posts.findAll(undefined, { page: 2, limit: 5 });
			expect(ids(page.data)).toEqual([6, 7, 8, 9, 10]);
			expect(page.total).toBe(12);

			const uncounted = await posts.findAll(undefined, {
				limit: 5,
				withCount: false,
			});
			expect(uncounted.hasMore).toBe(true);
		});

		it("matches text case-insensitively and escapes wildcards", async () => {
			const { authors, posts } = await fresh();
			expect(ids((await authors.findAll({ name: "ANN" })).data)).toEqual([1]);

			const search = await posts.findAll(
				undefined,
				{ limit: 50 },
				{ search: { term: "post 1", columns: ["title"] } },
			);
			expect(ids(search.data)).toEqual([1, 10, 11, 12]);

			await posts.create({ title: "50% off", author_id: 1, views: 0 });
			const literal = await posts.findAll(
				undefined,
				{},
				{ search: { term: "0%", columns: ["title"] } },
			);
			expect(literal.data.map((row: any) => row.title)).toEqual(["50% off"]);
			const contains = await posts.findAll({ title: { iContains: "0%" } });
			expect(contains.data.map((row: any) => row.title)).toEqual(["50% off"]);
			const underscore = await posts.findAll({ title: { contains: "_" } });
			expect(underscore.total).toBe(0);
		});

		it("walks keyset pages over a column with NULLs, both ways", async () => {
			const { posts } = await fresh();
			for (const sortOrder of ["asc", "desc"] as const) {
				const expected = ids(
					(
						await posts.findAll(undefined, {
							sortBy: "score",
							sortOrder,
							limit: 100,
						})
					).data,
				);
				const seen: number[] = [];
				let cursor: string | null | undefined;
				do {
					const page = await posts.findByCursor(undefined, {
						sortBy: "score",
						sortOrder,
						limit: 5,
						cursor: cursor ?? undefined,
					});
					seen.push(...ids(page.data));
					cursor = page.nextCursor;
				} while (cursor);
				expect(seen).toEqual(expected);
				expect(new Set(seen).size).toBe(12);
			}
		});

		it("counts, groups and filters by relations", async () => {
			const { authors, posts } = await fresh();
			expect(await posts.count({ views: 0 })).toBe(3);
			const groups = await posts.countBy("author_id");
			expect(groups.map((g) => g.count)).toEqual([4, 4, 4]);

			const bob = await posts.findAll({ author: { name: "Bob" } });
			expect(ids(bob.data)).toEqual([2, 5, 8, 11]);
			const writers = await authors.findAll({
				posts: { some: { title: "Post 2" } },
			});
			expect(ids(writers.data)).toEqual([2]);
		});

		it("loads belongs-to, has-many and many-to-many relations", async () => {
			const { authors, posts } = await fresh();
			const post = await posts.find(1, { relations: ["author", "tags"] });
			expect(post?.author?.name).toBe("Ann");
			expect(post?.tags.map((tag: any) => tag.name).sort()).toEqual([
				"news",
				"tech",
			]);

			const ann = await authors.find(1, {
				relations: ["posts"],
				counts: ["posts"],
			});
			expect(ids(ann?.posts ?? [])).toEqual([1, 4, 7, 10]);
			expect(ann?._count).toEqual({ posts: 4 });

			const list = await posts.findAll(
				{ author_id: 2 },
				{ limit: 2 },
				{ relations: ["author"], select: ["id", "title", "author.name"] },
			);
			expect(list.data[0]).toMatchObject({ id: 2, author: { name: "Bob" } });
		});

		// 3.7.2 (A-01, A-02): the limit is the database's, per statement.
		it("runs a statement just under the bound parameter limit and refuses one past it", async () => {
			const { posts } = await fresh();
			const limit = setup.dialect === "sqlite" ? 32_766 : 65_535;
			const range = (n: number) => Array.from({ length: n }, (_, i) => i + 1);
			// The ids plus the LIMIT, two under the limit.
			const under = await posts.findAll(
				{ id: { in: range(limit - 3) } },
				{ limit: 100 },
			);
			expect(under.total).toBe(12);
			const error = await expectStatus(
				posts.findAll({ id: { in: range(limit + 1) } }),
				400,
			);
			expect(error.message).toContain(`takes at most ${limit}`);
			// Five values a row (three columns and two timestamps): just over.
			const many = range(Math.floor(limit / 5) + 1).map((n) => ({
				title: `T${n}`,
				author_id: 1,
				views: 0,
			}));
			const refused = await expectStatus(posts.massCreate(many), 400);
			expect(refused.message).toContain(`takes at most ${limit}`);
			expect(await posts.count()).toBe(12);
			// MySQL takes a few seconds over two statements of 65,000 values.
		}, 60_000);

		it("keeps a scoped entity inside its tenant", async () => {
			const { tenantDocs } = await fresh();
			expect((await tenantDocs.findAll()).total).toBe(2);
			expect(await tenantDocs.find(3)).toBeNull();
		});
	});

	describe(`${setup.dialect}: writes`, () => {
		it("updates a row, and answers a missing one with a 404", async () => {
			const { posts } = await fresh();
			const before = await posts.find(1);
			const row = await posts.update(1, { title: "Changed" });
			expect(row.title).toBe("Changed");
			expect(row.updated_at).toBeInstanceOf(Date);
			expect(before?.title).toBe("Post 1");
			await expectStatus(posts.update(999, { title: "x" }), 404);
		});

		it("soft deletes and restores", async () => {
			const { posts } = await fresh();
			expect(await posts.softDelete(1)).toBe(true);
			expect(await posts.find(1)).toBeNull();
			expect(await posts.find(1, { withDeleted: true })).not.toBeNull();
			expect(await posts.count()).toBe(11);
			const restored = await posts.restore(1);
			expect(restored.deleted_at).toBeNull();
			expect(await posts.count()).toBe(12);
		});

		it("maps a duplicate to 409, a bad reference to 400 and a referenced delete to 409", async () => {
			const { authors, posts } = await fresh();
			await expectStatus(
				authors.create({ name: "Twin", email: "ann@x.io" }),
				409,
			);
			await expectStatus(
				posts.create({ title: "Orphan", author_id: 999, views: 0 }),
				400,
			);
			await expectStatus(authors.delete(1), 409);
			await expectStatus(authors.create({ email: "nameless@x.io" }), 400);
		});

		// 3.7.2 (A-03): SQLite reported these as a 500 (a STRICT table's
		// extended code 3091, and SQLITE_MISMATCH for a rowid).
		it("maps a value of the wrong type to 400, the primary key included", async () => {
			const { authors, posts } = await fresh();
			const wrongType = await expectStatus(
				posts.create({ title: "Typo", author_id: 1, views: "abc" }),
				400,
			);
			expect(wrongType.message).toMatch(/does not match its column type/);
			const textId = await expectStatus(
				authors.create({ id: "abc", name: "Dee", email: "dee@x.io" }),
				400,
			);
			expect(textId.message).toMatch(/does not match its column type/);
			expect(await authors.count()).toBe(3);
		});

		it("runs the mass writes in one transaction", async () => {
			const { authors, posts } = await fresh();
			const created = await authors.massCreate([
				{ name: "Dee", email: "dee@x.io" },
				{ name: "Eve", email: "eve@x.io" },
			]);
			expect(created.map((row) => row.name)).toEqual(["Dee", "Eve"]);

			const failed = await caught(
				authors.massCreate([
					{ name: "Fay", email: "fay@x.io" },
					{ name: "Twin", email: "ann@x.io" },
				]),
			);
			expect(failed).toBeInstanceOf(BulkOperationException);
			expect(failed.errors.map((e: any) => e.index)).toEqual([1]);
			expect(await authors.count()).toBe(5);

			const updated = await posts.massUpdate([1, 2], { views: 9 });
			expect(updated.map((row) => row.views)).toEqual([9, 9]);
			expect(await posts.massSoftDelete([1, 2])).toBe(true);
			expect(await posts.count()).toBe(10);
			const restored = await posts.massRestore([1, 2]);
			expect(ids(restored)).toEqual([1, 2]);
			expect(await posts.massDelete([11, 12])).toBe(true);
			expect(await posts.count()).toBe(10);

			const inUse = await caught(authors.massDelete([1]));
			expect(inUse).toBeInstanceOf(BulkOperationException);
			expect(inUse.errors[0].error.getStatus()).toBe(409);
		});

		it("upserts by a unique key", async () => {
			const { authors } = await fresh();
			const updated = await authors.upsert(
				{ name: "Ann B", email: "ann@x.io" },
				{ conflictTarget: "email" },
			);
			expect(Number(updated.id)).toBe(1);
			expect(updated.name).toBe("Ann B");
			const inserted = await authors.upsert(
				{ name: "Dee", email: "dee@x.io" },
				{ conflictTarget: "email" },
			);
			// Not 4: a conflicting insert may use up an auto-increment value.
			expect(Number(inserted.id)).toBeGreaterThan(3);
			expect(inserted.name).toBe("Dee");
			const many = await authors.massUpsert(
				[
					{ name: "Bob B", email: "bob@x.io" },
					{ name: "Eve", email: "eve@x.io" },
				],
				{ conflictTarget: "email" },
			);
			expect(many.map((row) => row.name).sort()).toEqual(["Bob B", "Eve"]);
			expect(await authors.count()).toBe(5);
		});

		it("attaches, detaches and syncs many-to-many links", async () => {
			const { posts } = await fresh();
			const attached = await posts.attach(3, "tags", [1, 2]);
			expect(attached.tags).toHaveLength(2);
			const detached = await posts.detach(3, "tags", [1]);
			expect(detached.tags.map((tag: any) => tag.name)).toEqual(["tech"]);
			const synced = await posts.sync(3, "tags", []);
			expect(synced.tags).toEqual([]);
		});

		it("refuses a stale version with a 409", async () => {
			const { docs } = await fresh();
			const row = await docs.update(1, { title: "New", version: 1 });
			expect(row.version).toBe(2);
			await expectStatus(docs.update(1, { title: "Old", version: 1 }), 409);
		});
	});
}
