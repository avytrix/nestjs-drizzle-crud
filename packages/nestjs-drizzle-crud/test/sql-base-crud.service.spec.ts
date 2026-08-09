/**
 * @jest-environment node
 */

import { beforeEach, describe, expect, it } from "@jest/globals";
import { SqlBaseCrudService } from "../src/core/abstract/sql-base-crud.service";
import { DrizzleCrudModule } from "../src/modules/drizzle-crud.module";
import { TestCrudFactory } from "../src/test-utils/test-factory";

// Define test interfaces
interface TestEntity {
	id: number;
	name: string;
	email: string;
	created_at?: Date;
	updated_at?: Date;
	deleted_at?: Date | null;
}

interface TestCreateDto {
	name: string;
	email: string;
}

interface TestUpdateDto {
	name?: string;
	email?: string;
}

interface TestFilterDto {
	name?: string;
	email?: string;
}

// Create a concrete implementation for testing
class TestCrudService extends SqlBaseCrudService<
	TestEntity,
	TestCreateDto,
	TestUpdateDto,
	TestFilterDto
> {
	protected async validateCreate(data: TestCreateDto): Promise<void> {
		if (!data.name) throw new Error("Name is required");
	}

	protected async validateUpdate(_id: any, data: TestUpdateDto): Promise<void> {
		if (data.name && data.name.length < 2) throw new Error("Name too short");
	}

	protected mapCreateDtoToEntity(data: TestCreateDto): Record<string, any> {
		return { ...data };
	}

	protected mapUpdateDtoToEntity(data: TestUpdateDto): Record<string, any> {
		return { ...data };
	}
}

describe("SqlBaseCrudService", () => {
	let service: TestCrudService;
	let mockDb: any;
	let mockTable: any;

	beforeEach(() => {
		mockDb = TestCrudFactory.createMockDb();
		mockTable = TestCrudFactory.createMockTable();
		service = TestCrudFactory.createTestService(
			TestCrudService,
			mockDb,
			mockTable,
		);
	});

	describe("constructor and validation", () => {
		it("should create service instance with valid config", () => {
			expect(service).toBeDefined();
			expect(service["config"]).toBeDefined();
		});

		it("should throw error if database instance is not provided", () => {
			expect(() => {
				new TestCrudService({
					dialect: "postgresql",
					db: null,
					table: mockTable,
				} as any);
			}).toThrow("Database instance is required");
		});

		it("should throw error if table config is not provided", () => {
			expect(() => {
				new TestCrudService({
					dialect: "postgresql",
					db: mockDb,
					table: null,
				} as any);
			}).toThrow("Table configuration is required");
		});
	});

	describe("configuration methods", () => {
		it("should return correct entity name", () => {
			const entityName = (service as any).getEntityName();
			expect(entityName).toBeDefined();
		});

		it("should build where conditions correctly", () => {
			const filters = { name: "Test", email: "test@example.com" };
			const conditions = (service as any).buildWhereConditions(filters);
			expect(Array.isArray(conditions)).toBe(true);
		});
	});

	describe("validation methods", () => {
		it("should validate create data", async () => {
			await expect(
				service["validateCreate"]({ name: "", email: "test@example.com" }),
			).rejects.toThrow("Name is required");

			await expect(
				service["validateCreate"]({
					name: "Valid Name",
					email: "test@example.com",
				}),
			).resolves.not.toThrow();
		});

		it("should validate update data", async () => {
			await expect(service["validateUpdate"](1, { name: "A" })) // Too short
				.rejects.toThrow("Name too short");

			await expect(
				service["validateUpdate"](1, { name: "Valid Name" }),
			).resolves.not.toThrow();
		});
	});

	describe("mapping methods", () => {
		it("should map create DTO to entity", () => {
			const createDto = { name: "Test Name", email: "test@example.com" };
			const entity = service["mapCreateDtoToEntity"](createDto);
			expect(entity).toEqual(createDto);
		});

		it("should map update DTO to entity", () => {
			const updateDto = { name: "Updated Name" };
			const entity = service["mapUpdateDtoToEntity"](updateDto);
			expect(entity).toEqual(updateDto);
		});
	});

	describe("hook methods", () => {
		it("should run beforeCreate hook", async () => {
			const createDto = { name: "Test Name", email: "test@example.com" };
			const result = await service["beforeCreate"](createDto);
			expect(result).toEqual(createDto);
		});

		it("should run beforeUpdate hook", async () => {
			const updateDto = { name: "Test Name" };
			const result = await service["beforeUpdate"](1, updateDto);
			expect(result).toEqual(updateDto);
		});
	});

	describe("buildOrderBy (default sort)", () => {
		const orderBy = (sortBy?: string, sortOrder?: any) =>
			(service as any).buildOrderBy(sortBy, sortOrder);

		it("uses the explicit caller sortBy when the column exists", () => {
			expect(orderBy("name", "asc")).toHaveLength(1);
		});

		it("returns no ordering when no sortBy and no defaultSort", () => {
			expect(orderBy()).toHaveLength(0);
		});

		it("falls back to a single-column defaultSort", () => {
			service["config"].defaultSort = [{ column: "name" }];
			expect(orderBy()).toHaveLength(1);
		});

		it("applies a multi-column defaultSort in order", () => {
			service["config"].defaultSort = [
				{ column: "name", order: "asc" },
				{ column: "created_at", order: "desc" },
			];
			expect(orderBy()).toHaveLength(2);
		});

		it("explicit sortBy replaces the configured default", () => {
			service["config"].defaultSort = [
				{ column: "name" },
				{ column: "created_at" },
			];
			// One expression (the caller column), not the two defaults.
			expect(orderBy("email", "asc")).toHaveLength(1);
		});

		it("skips unknown columns in defaultSort", () => {
			service["config"].defaultSort = [
				{ column: "name" },
				{ column: "does_not_exist" },
			];
			expect(orderBy()).toHaveLength(1);
		});

		it("throws BadRequest when caller sortBy is an unknown column", () => {
			service["config"].defaultSort = [{ column: "name" }];
			// Fail-fast: a client-supplied sort column that doesn't exist is a 400,
			// not a silent fallback to the default order.
			expect(() => orderBy("nope", "asc")).toThrow();
		});
	});

	describe("forFeature default sort fallback", () => {
		const buildService = (defaults: any) => {
			const { providers } = DrizzleCrudModule.forFeature([
				{ service: TestCrudService, table: mockTable },
			]) as any;
			const globalConfig = {
				dialect: "postgresql",
				defaults: {
					softDelete: true,
					timestamps: true,
					pagination: { defaultLimit: 20, maxLimit: 100 },
					...defaults,
				},
			};
			return providers[0].useFactory(mockDb, globalConfig) as TestCrudService;
		};

		it("synthesizes a createdAt default when global sortOrder is set", () => {
			const svc = buildService({ sortOrder: "desc" });
			expect(svc["config"].defaultSort).toEqual([
				{ column: "created_at", order: "desc" },
			]);
		});

		it("leaves defaultSort unset when global sortOrder is omitted", () => {
			const svc = buildService({});
			expect(svc["config"].defaultSort).toBeUndefined();
		});

		it("does not apply the fallback when timestamps are disabled", () => {
			const svc = buildService({ sortOrder: "desc", timestamps: false });
			expect(svc["config"].defaultSort).toBeUndefined();
		});
	});
});
