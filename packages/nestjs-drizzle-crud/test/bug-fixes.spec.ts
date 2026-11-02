/**
 * @jest-environment node
 *
 * Bug-reproduction + fix-verification specs (PostgreSQL-first).
 * Each `describe` targets one bug from the audit. Before the fixes these fail
 * (RED); after the fixes they pass (GREEN). Bug #2 (fullTextSearch soft-delete)
 * is filtering done in SQL and can't be proven with a dumb mock — it is verified
 * end-to-end in the HTTP lab instead (see drizzle-crud-lab/test/full-results.md).
 */

import { beforeEach, describe, expect, it } from "@jest/globals";
import {
	BadRequestException,
	ConflictException,
	HttpException,
} from "@nestjs/common";
import {
	int,
	MySqlDialect,
	mysqlTable,
	varchar as myVarchar,
} from "drizzle-orm/mysql-core";
import { drizzle as mysqlDrizzle } from "drizzle-orm/mysql2";
import { PgDialect, pgTable, serial, varchar } from "drizzle-orm/pg-core";
import { SqlBaseCrudService } from "../src/core/abstract/sql-base-crud.service";
import {
	DuplicateEntityException,
	EntityInUseException,
	EntityNotFoundException,
	ForeignKeyViolationException,
	ValidationFailedException,
} from "../src/exceptions/crud.exceptions";
import { TestCrudFactory } from "../src/test-utils/test-factory";

interface E {
	id: number;
	name: string;
	email: string;
	deleted_at?: Date | null;
}
class Svc extends SqlBaseCrudService<E, any, any, any> {}

// A thenable query-builder mock: every chain method returns itself, and awaiting
// it resolves to `result`. Lets us assert which builder methods were called.
function chain(result: any) {
	const obj: any = {};
	for (const m of [
		"select",
		"from",
		"where",
		"limit",
		"offset",
		"orderBy",
		"for",
		"leftJoin",
		"set",
	]) {
		obj[m] = jest.fn(() => obj);
	}
	// biome-ignore lint/suspicious/noThenProperty: deliberately mocks Drizzle's awaitable query builder
	obj.then = (res: any, rej: any) => Promise.resolve(result).then(res, rej);
	return obj;
}

describe("Bug #1: exceptions map to HTTP status codes", () => {
	it("EntityNotFoundException is a 404 HttpException", () => {
		const e = new EntityNotFoundException("regions", 9999);
		expect(e).toBeInstanceOf(HttpException);
		expect((e as any).getStatus()).toBe(404);
	});

	it("DuplicateEntityException is a 409 HttpException", () => {
		const e = new DuplicateEntityException("regions", "code", "EU");
		expect(e).toBeInstanceOf(HttpException);
		expect((e as any).getStatus()).toBe(409);
	});

	it("ValidationFailedException is a 400 HttpException", () => {
		const e = new ValidationFailedException("bad");
		expect(e).toBeInstanceOf(HttpException);
		expect((e as any).getStatus()).toBe(400);
	});
});

describe("Bug #3: unique violation -> DuplicateEntityException (409)", () => {
	const mockTable = TestCrudFactory.createMockTable();

	it("translates a raw Postgres 23505 error", async () => {
		const insert: any = {
			values: jest.fn(() => insert),
			returning: jest.fn(() =>
				Promise.reject(Object.assign(new Error("dup"), { code: "23505" })),
			),
		};
		const db: any = { insert: jest.fn(() => insert) };
		const svc = TestCrudFactory.createTestService(Svc, db, mockTable);
		await expect(
			(svc as any).create({ name: "x", email: "y" }),
		).rejects.toBeInstanceOf(ConflictException);
	});

	it("translates a wrapped DrizzleQueryError (cause.code 23505)", async () => {
		const insert: any = {
			values: jest.fn(() => insert),
			returning: jest.fn(() =>
				Promise.reject(
					Object.assign(new Error("drizzle"), { cause: { code: "23505" } }),
				),
			),
		};
		const db: any = { insert: jest.fn(() => insert) };
		const svc = TestCrudFactory.createTestService(Svc, db, mockTable);
		await expect(
			(svc as any).create({ name: "x", email: "y" }),
		).rejects.toBeInstanceOf(ConflictException);
	});
});

describe("Bug #8: data violations -> ValidationFailedException (400)", () => {
	const mockTable = TestCrudFactory.createMockTable();

	it("maps a raw Postgres 22001 (value too long) on create to 400", async () => {
		const insert: any = {
			values: jest.fn(() => insert),
			returning: jest.fn(() =>
				Promise.reject(Object.assign(new Error("too long"), { code: "22001" })),
			),
		};
		const db: any = { insert: jest.fn(() => insert) };
		const svc = TestCrudFactory.createTestService(Svc, db, mockTable);
		await expect(
			(svc as any).create({ name: "x", email: "y" }),
		).rejects.toBeInstanceOf(ValidationFailedException);
	});

	it("maps a wrapped DrizzleQueryError (cause.code 23514, CHECK) on create to 400", async () => {
		const insert: any = {
			values: jest.fn(() => insert),
			returning: jest.fn(() =>
				Promise.reject(
					Object.assign(new Error("drizzle"), { cause: { code: "23514" } }),
				),
			),
		};
		const db: any = { insert: jest.fn(() => insert) };
		const svc = TestCrudFactory.createTestService(Svc, db, mockTable);
		const err = await (svc as any)
			.create({ name: "x", email: "y" })
			.catch((e: unknown) => e);
		expect(err).toBeInstanceOf(HttpException);
		expect((err as HttpException).getStatus()).toBe(400);
	});

	it("still lets an unmapped error (e.g. 42P01) bubble unchanged", async () => {
		const raw = Object.assign(new Error("relation does not exist"), {
			code: "42P01",
		});
		const insert: any = {
			values: jest.fn(() => insert),
			returning: jest.fn(() => Promise.reject(raw)),
		};
		const db: any = { insert: jest.fn(() => insert) };
		const svc = TestCrudFactory.createTestService(Svc, db, mockTable);
		await expect((svc as any).create({ name: "x", email: "y" })).rejects.toBe(
			raw,
		);
	});
});

describe("Bug #4: pagination clamping", () => {
	let svc: any;
	beforeEach(() => {
		svc = TestCrudFactory.createTestService(
			Svc,
			TestCrudFactory.createMockDb(),
			TestCrudFactory.createMockTable(),
		);
	});

	it("clamps limit <= 0 up to 1", () => {
		expect(svc.resolvePagination(1, 0).limit).toBe(1);
		expect(svc.resolvePagination(1, -5).limit).toBe(1);
	});

	it("clamps limit above maxLimit down to maxLimit", () => {
		expect(svc.resolvePagination(1, 9999).limit).toBe(100);
	});

	it("clamps page < 1 to page 1 and offset 0", () => {
		expect(svc.resolvePagination(0, 20)).toMatchObject({ page: 1, offset: 0 });
		expect(svc.resolvePagination(-3, 20)).toMatchObject({ page: 1, offset: 0 });
	});

	it("computes a non-negative offset for valid input", () => {
		expect(svc.resolvePagination(3, 10).offset).toBe(20);
	});
});

describe("Bug #5: unknown sort column fails fast", () => {
	let svc: any;
	beforeEach(() => {
		svc = TestCrudFactory.createTestService(
			Svc,
			TestCrudFactory.createMockDb(),
			TestCrudFactory.createMockTable(),
		);
	});

	it("throws BadRequest when caller sortBy is not a real column", () => {
		expect(() => svc.buildOrderBy("not_a_column", "asc")).toThrow(
			BadRequestException,
		);
	});

	it("still sorts by a valid column", () => {
		expect(svc.buildOrderBy("name", "asc")).toHaveLength(2);
	});
});

describe("Bug #6 (guard): restore returns the row on Postgres RETURNING path", () => {
	it("returns the restored row directly", async () => {
		const restored = { id: 1, name: "a", email: "b", deleted_at: null };
		const upd: any = {
			set: jest.fn(() => upd),
			where: jest.fn(() => upd),
			returning: jest.fn(() => Promise.resolve([restored])),
		};
		// The guard SELECT finds the row in the trash, then the UPDATE restores it.
		const db: any = {
			select: jest.fn(() => chain([{ id: 1 }])),
			update: jest.fn(() => upd),
		};
		const svc = TestCrudFactory.createTestService(
			Svc,
			db,
			TestCrudFactory.createMockTable(),
		);
		await expect((svc as any).restore(1)).resolves.toEqual(restored);
	});
});

describe("Bug #7: lock options applied on Postgres reads", () => {
	it("appends .for('update') to find() when options.lock = 'update'", async () => {
		const q = chain([]);
		const db: any = { select: jest.fn(() => q) };
		const svc = TestCrudFactory.createTestService(
			Svc,
			db,
			TestCrudFactory.createMockTable(),
		);
		await (svc as any).find(1, { lock: "update" });
		// `of` the base table, so a LEFT JOINed relation is never locked.
		expect(q.for).toHaveBeenCalledWith("update", {
			of: (svc as any).config.table,
		});
	});
});

// ---- 3.0.2 residual edges (found by the HTTP probe; see lab test/fix-plan.md) ----

describe("F1: fullTextSearch returns the same envelope as findAll", () => {
	it("includes page and limit (resolved), not just { data, total }", async () => {
		const q = chain([]); // both data + count queries resolve to []
		const db: any = { select: jest.fn(() => q) };
		const svc = TestCrudFactory.createTestService(
			Svc,
			db,
			TestCrudFactory.createMockTable(),
		);
		const res = await (svc as any).fullTextSearch("term", ["name"], {
			page: 2,
			limit: 5,
		});
		expect(res).toMatchObject({ page: 2, limit: 5 });
		expect(res).toHaveProperty("total");
		expect(res).toHaveProperty("data");
	});
});

describe("F2: invalid sortOrder fails fast (mirrors unknown-column)", () => {
	let svc: any;
	beforeEach(() => {
		svc = TestCrudFactory.createTestService(
			Svc,
			TestCrudFactory.createMockDb(),
			TestCrudFactory.createMockTable(),
		);
	});

	it("throws BadRequest on a sortOrder that isn't asc/desc", () => {
		expect(() => svc.buildOrderBy("name", "sideways")).toThrow(
			BadRequestException,
		);
	});

	it("still accepts asc and desc", () => {
		expect(svc.buildOrderBy("name", "asc")).toHaveLength(2);
		expect(svc.buildOrderBy("name", "desc")).toHaveLength(2);
	});
});

describe("F3: non-finite numeric filter operand -> 400 (not a raw 500)", () => {
	let svc: any;
	beforeEach(() => {
		svc = TestCrudFactory.createTestService(
			Svc,
			TestCrudFactory.createMockDb(),
			TestCrudFactory.createMockTable(),
		);
	});

	it("rejects { gt: NaN }", () => {
		expect(() => svc.applyComplexFilter([], "views", { gt: NaN })).toThrow(
			BadRequestException,
		);
	});

	it("rejects { lte: Infinity }", () => {
		expect(() =>
			svc.applyComplexFilter([], "views", { lte: Infinity }),
		).toThrow(BadRequestException);
	});
});

describe("F4: case-insensitive string filter is EXACT, not a wildcard pattern", () => {
	// A plain string filter value is documented as a case-insensitive *exact*
	// match. It previously compiled to `ilike(column, value)`, so a value
	// containing `%` / `_` / `\` was treated as a LIKE pattern (wrong rows).
	// The fix compiles it to `lower(column) = lower(value)` instead. Rendered to
	// SQL with the real Postgres dialect so the operator is asserted directly.
	const dialect = new PgDialect();
	const table = pgTable("e", {
		id: serial("id").primaryKey(),
		name: varchar("name", { length: 100 }),
	});
	// The table has no deleted_at or timestamp columns, so both are off: since
	// 3.3.1 a configured column the table lacks fails at construction.
	const svc: any = TestCrudFactory.createTestService(
		Svc,
		TestCrudFactory.createMockDb(),
		table,
		{
			softDelete: { enabled: false, column: "deleted_at" },
			timestamps: undefined,
		},
	);

	const render = (filters: any) => {
		const { conditions } = svc.buildFilterConditions(filters);
		expect(conditions).toHaveLength(1);
		return dialect.sqlToQuery(conditions[0]).sql.toLowerCase();
	};

	it("compiles a plain string to lower()=lower(), never ilike", () => {
		const sqlText = render({ name: "a%b" });
		expect(sqlText).toContain("lower(");
		expect(sqlText).not.toContain("ilike");
	});

	it("treats %/_ as literal data: same SQL shape as a wildcard-free value", () => {
		// The wildcard chars must be parameters, not pattern syntax — so the SQL
		// template is identical whether or not the value contains % or _.
		expect(render({ name: "a%b" })).toBe(render({ name: "abc" }));
	});

	it("still uses ILIKE for the explicit { ilike } operator", () => {
		expect(render({ name: { ilike: "a%" } })).toContain("ilike");
	});

	it("still uses an exact comparison for an array (IN) value", () => {
		expect(render({ name: ["x", "y"] })).toContain("in (");
	});
});

describe("F5: findAll supports cross-column search options", () => {
	const dialect = new PgDialect();
	const table = pgTable("e", {
		id: serial("id").primaryKey(),
		name: varchar("name", { length: 100 }),
		email: varchar("email", { length: 100 }),
	});
	let svc: any;

	beforeEach(() => {
		svc = TestCrudFactory.createTestService(
			Svc,
			TestCrudFactory.createMockDb(),
			table,
			{
				softDelete: { enabled: false, column: "deleted_at" },
				timestamps: undefined,
			},
		);
	});

	it("compiles default search mode as an OR of ILIKE contains checks", () => {
		const condition = svc.buildSearchCondition({
			term: "john",
			columns: ["name", "email"],
		});
		const sqlText = dialect.sqlToQuery(condition).sql.toLowerCase();

		expect(sqlText).toContain("ilike");
		expect(sqlText).toContain(" or ");
	});

	it("compiles fullText search mode with to_tsvector/plainto_tsquery", () => {
		const condition = svc.buildSearchCondition({
			term: "john",
			columns: ["name", "email"],
			mode: "fullText",
		});
		const sqlText = dialect.sqlToQuery(condition).sql.toLowerCase();

		expect(sqlText).toContain("to_tsvector");
		expect(sqlText).toContain("plainto_tsquery");
	});

	it("ignores blank terms and unknown columns", () => {
		expect(
			svc.buildSearchCondition({ term: "   ", columns: ["name"] }),
		).toBeUndefined();
		expect(
			svc.buildSearchCondition({ term: "john", columns: ["missing"] }),
		).toBeUndefined();
	});

	it("applies the search condition to both data and count queries", async () => {
		const dataQuery = chain([{ id: 1, name: "John", email: "j@example.com" }]);
		const countQuery = chain([{ count: 1 }]);
		const db: any = {
			select: jest
				.fn()
				.mockReturnValueOnce(dataQuery)
				.mockReturnValueOnce(countQuery),
		};
		const searchSvc = TestCrudFactory.createTestService(Svc, db, table, {
			softDelete: { enabled: false, column: "deleted_at" },
			timestamps: undefined,
		});

		const res = await (searchSvc as any).findAll(
			undefined,
			{ page: 1, limit: 20 },
			{ search: { term: "john", columns: ["name", "email"] } },
		);

		expect(dataQuery.where).toHaveBeenCalledTimes(1);
		expect(countQuery.where).toHaveBeenCalledTimes(1);
		expect(res).toMatchObject({ total: 1, page: 1, limit: 20 });
	});
});

describe("FK violations (23503) map by direction, restored in 3.2.2", () => {
	const mockTable = TestCrudFactory.createMockTable();

	function fkError(detail?: string, wrapped = false) {
		const err = new Error("fk");
		return wrapped
			? Object.assign(err, { cause: { code: "23503", detail } })
			: Object.assign(err, { code: "23503", detail });
	}

	it("maps a create referencing a missing parent row to 400", async () => {
		const insert: any = {
			values: jest.fn(() => insert),
			returning: jest.fn(() =>
				Promise.reject(
					fkError('Key (region_id)=(99) is not present in table "regions".'),
				),
			),
		};
		const db: any = { insert: jest.fn(() => insert) };
		const svc = TestCrudFactory.createTestService(Svc, db, mockTable);

		await expect((svc as any).create({ name: "x" })).rejects.toBeInstanceOf(
			ForeignKeyViolationException,
		);
	});

	it("names the offending column from the driver detail", async () => {
		const svc = TestCrudFactory.createTestService(Svc, {}, mockTable);
		const ex = (svc as any).toForeignKeyException(
			fkError('Key (region_id)=(99) is not present in table "regions".'),
		);

		expect(ex.message).toContain("region_id");
		expect(ex.getStatus()).toBe(400);
	});

	it("falls back to 'reference' when the detail is missing", async () => {
		const svc = TestCrudFactory.createTestService(Svc, {}, mockTable);
		const ex = (svc as any).toForeignKeyException(fkError());

		expect(ex.message).toContain("reference");
	});

	it("reads the code off a wrapped DrizzleQueryError cause", () => {
		const svc = TestCrudFactory.createTestService(Svc, {}, mockTable);

		expect((svc as any).isForeignKeyViolation(fkError(undefined, true))).toBe(
			true,
		);
		expect(
			(svc as any).isForeignKeyViolation(
				Object.assign(new Error("other"), { code: "23505" }),
			),
		).toBe(false);
	});

	it("maps a blocked delete to 409 EntityInUseException", async () => {
		const del: any = {
			where: jest.fn(() =>
				Promise.reject(
					fkError('Key (id)=(1) is still referenced from table "cities".'),
				),
			),
		};
		const db: any = {
			select: jest.fn(() => chain([{ id: 1, name: "x", email: "y" }])),
			delete: jest.fn(() => del),
		};
		const svc = TestCrudFactory.createTestService(Svc, db, mockTable, {
			softDelete: { enabled: false, column: "deleted_at" },
		});

		await expect((svc as any).delete(1)).rejects.toBeInstanceOf(
			EntityInUseException,
		);
	});

	it("lets a non-FK delete error bubble unchanged", async () => {
		const del: any = {
			where: jest.fn(() => Promise.reject(new Error("connection lost"))),
		};
		const db: any = {
			select: jest.fn(() => chain([{ id: 1, name: "x", email: "y" }])),
			delete: jest.fn(() => del),
		};
		const svc = TestCrudFactory.createTestService(Svc, db, mockTable, {
			softDelete: { enabled: false, column: "deleted_at" },
		});

		await expect((svc as any).delete(1)).rejects.toThrow("connection lost");
	});
});

describe("BUG-15: MySQL gets LIKE, never ILIKE", () => {
	// MySQL has no ILIKE operator; its default collations compare
	// case-insensitively, so LIKE is the equivalent.
	const dialect = new MySqlDialect();
	const table = mysqlTable("t", {
		id: int("id").primaryKey(),
		name: myVarchar("name", { length: 50 }),
	});
	const svc: any = TestCrudFactory.createTestService(
		Svc,
		TestCrudFactory.createMockDb(),
		table,
		{
			dialect: "mysql",
			softDelete: { enabled: false, column: "deleted_at" },
			timestamps: undefined,
		},
	);
	const render = (condition: any) =>
		dialect.sqlToQuery(condition).sql.toLowerCase();

	it("compiles search to LIKE", () => {
		const sqlText = render(
			svc.buildSearchCondition({ term: "jo", columns: ["name"] }),
		);
		expect(sqlText).toContain(" like ");
		expect(sqlText).not.toContain("ilike");
	});

	it("compiles the ilike operator to LIKE", () => {
		const { conditions } = svc.buildFilterConditions({
			name: { ilike: "jo%" },
		});
		const sqlText = render(conditions[0]);
		expect(sqlText).toContain(" like ");
		expect(sqlText).not.toContain("ilike");
	});
});

describe("3.7.0: MySQL row locks and data errors", () => {
	const table = mysqlTable("t", {
		id: int("id").primaryKey(),
		name: myVarchar("name", { length: 50 }),
	});
	const db = mysqlDrizzle.mock();
	const svc: any = TestCrudFactory.createTestService(Svc, db, table, {
		dialect: "mysql",
		softDelete: { enabled: false, column: "deleted_at" },
		timestamps: undefined,
	});
	const locked = (options: any) =>
		svc.applyLock(db.select().from(table), options).toSQL().sql.toLowerCase();

	it("adds FOR UPDATE and FOR SHARE instead of ignoring the lock", () => {
		expect(locked({ lock: "update" })).toMatch(/ for update$/);
		expect(locked({ lock: "share" })).toMatch(/ for share$/);
		// MySQL has no FOR NO KEY UPDATE; FOR UPDATE is the safe stand-in.
		expect(locked({ forNoKeyUpdate: true })).toMatch(/ for update$/);
		expect(locked({ lock: "none" })).not.toContain(" for ");
	});

	it("maps strict mode data errors to a 400 naming the column", () => {
		const mysqlError = (errno: number, message: string) => ({
			message: "Failed query",
			cause: Object.assign(new Error(message), { errno }),
		});
		const tooLong = svc.toClientError(
			mysqlError(1406, "Data too long for column 'name' at row 1"),
		);
		expect(tooLong).toBeInstanceOf(ValidationFailedException);
		expect(tooLong.message).toContain("too long for its column: name");
		const missing = svc.toClientError(
			mysqlError(1048, "Column 'name' cannot be null"),
		);
		expect(missing.message).toContain("a required value is missing: name");
		// An errno that is not a data error stays a server error.
		const other = mysqlError(1205, "Lock wait timeout exceeded");
		expect(svc.toClientError(other)).toBe(other);
	});
});
