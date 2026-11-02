/**
 * @jest-environment node
 *
 * The controller factory's route table and the OpenAPI decorators, read back
 * from the metadata Nest and @nestjs/swagger use. The routes themselves run
 * over HTTP in apps/api/e2e/authors.spec.ts.
 */

import { describe, expect, it } from "@jest/globals";
import {
	Injectable,
	type CanActivate,
	ParseIntPipe,
	RequestMethod,
	UseGuards,
} from "@nestjs/common";
import {
	GUARDS_METADATA,
	METHOD_METADATA,
	PATH_METADATA,
	ROUTE_ARGS_METADATA,
} from "@nestjs/common/constants";
import { integer, pgEnum, pgTable, serial, text } from "drizzle-orm/pg-core";
import { SqlBaseCrudService } from "../src/core/abstract/sql-base-crud.service";
import { createCrudController } from "../src/controller/crud-controller.factory";
import { CrudService } from "../src/decorators/crud-service.decorator";
import { ApiCrudList, ApiCrudQuery } from "../src/openapi/api-crud.decorators";

const mood = pgEnum("mood", ["happy", "sad"]);
const regions = pgTable("regions", {
	id: serial("id").primaryKey(),
	name: text("name").notNull(),
});
const people = pgTable("people", {
	id: serial("id").primaryKey(),
	name: text("name").notNull(),
	age: integer("age"),
	mood: mood("mood").notNull(),
	region_id: integer("region_id"),
});

@CrudService({
	dialect: "postgresql",
	table: people,
	primaryKey: "id",
	relations: { region: { table: regions, localKey: "region_id" } },
	filterableColumns: ["name", "age", "mood", "region.name"],
	searchableColumns: ["name"],
})
class PeopleService extends SqlBaseCrudService<any, any, any, any> {}

@Injectable()
class AllowAll implements CanActivate {
	canActivate() {
		return true;
	}
}

const routesOf = (controller: any) =>
	Object.getOwnPropertyNames(controller.prototype)
		.filter((name) =>
			Reflect.hasMetadata(PATH_METADATA, controller.prototype[name] ?? {}),
		)
		.map((name) => {
			const handler = controller.prototype[name];
			return `${RequestMethod[Reflect.getMetadata(METHOD_METADATA, handler)]} ${Reflect.getMetadata(PATH_METADATA, handler)} ${name}`;
		});

describe("createCrudController", () => {
	it("registers the default routes with static paths before /:id", () => {
		const Ctrl = createCrudController(PeopleService);
		expect(routesOf(Ctrl)).toEqual([
			"GET / list",
			"GET trash trash",
			"GET :id get",
			"POST / create",
			"PATCH :id update",
			"DELETE :id delete",
			"POST :id/soft-delete softDelete",
			"POST :id/restore restore",
		]);
	});

	it("turns routes on and off and applies decorators and an id pipe", () => {
		const Ctrl = createCrudController(PeopleService, {
			path: "people",
			idType: "int",
			routes: {
				bulkDelete: true,
				trash: false,
				delete: { decorators: [UseGuards(AllowAll)] },
			},
			decorators: [UseGuards(AllowAll)],
		});
		expect(routesOf(Ctrl)).toContain("POST bulk-delete bulkDelete");
		expect(routesOf(Ctrl)).not.toContain("GET trash trash");
		expect(Reflect.getMetadata(PATH_METADATA, Ctrl)).toBe("people");
		const guards = Reflect.getMetadata(GUARDS_METADATA, Ctrl.prototype.delete);
		expect(guards).toEqual([AllowAll, AllowAll]);
		const args = Reflect.getMetadata(ROUTE_ARGS_METADATA, Ctrl, "get");
		const idArg = Object.values<any>(args).find((arg) => arg.data === "id");
		expect(idArg.pipes).toEqual([ParseIntPipe]);
	});

	it("runs a route decorator that wraps the handler, and keeps the route", async () => {
		const calls: string[] = [];
		const wrap: MethodDecorator = (_target, _key, descriptor: any) => {
			const original = descriptor.value;
			return {
				...descriptor,
				value(...args: unknown[]) {
					calls.push("wrapper");
					return original.apply(this, args);
				},
			};
		};
		const Ctrl = createCrudController(PeopleService, {
			path: "people",
			routes: { delete: { decorators: [wrap] } },
		});
		expect(routesOf(Ctrl)).toContain("DELETE :id delete");
		const instance: any = new (Ctrl as any)({
			parseId: (id: unknown) => id,
			delete: async () => true,
		});
		await instance.delete(1);
		expect(calls).toEqual(["wrapper"]);
	});
});

describe("ApiCrudQuery / ApiCrudList", () => {
	const params = (decorator: MethodDecorator) => {
		class Probe {
			list() {}
		}
		const descriptor = Object.getOwnPropertyDescriptor(
			Probe.prototype,
			"list",
		)!;
		decorator(Probe.prototype, "list", descriptor);
		return {
			query: Reflect.getMetadata("swagger/apiParameters", descriptor.value),
			responses: Reflect.getMetadata("swagger/apiResponse", descriptor.value),
		};
	};

	it("documents pagination, sort, cursor, search and every filterable column", () => {
		const { query } = params(ApiCrudQuery(PeopleService));
		const byName = Object.fromEntries(query.map((p: any) => [p.name, p]));
		for (const name of [
			"page",
			"limit",
			"sortBy",
			"withCount",
			"fields",
			"with",
			"counts",
			"search",
			"cursor",
			"name",
			"age",
			"mood",
			"region[name]",
		]) {
			expect(byName[name]).toBeDefined();
		}
		expect(byName.age.schema).toEqual({ type: "integer" });
		expect(byName.mood.schema).toEqual({
			type: "string",
			enum: ["happy", "sad"],
		});
		expect(byName.region_id).toBeUndefined();
		expect(query.every((p: any) => p.required === false)).toBe(true);
	});

	it("adds the page envelope with the row schema", () => {
		const { responses } = params(
			ApiCrudList({ table: people, allowTrash: true }, { cursor: false }),
		);
		const schema = responses["200"].schema;
		expect(Object.keys(schema.properties)).toEqual([
			"data",
			"total",
			"page",
			"limit",
			"hasMore",
			"nextCursor",
		]);
		expect(schema.properties.data.items.properties.age).toEqual({
			type: "integer",
			nullable: true,
		});
	});

	it("explains what to pass when the class has no @CrudService metadata", () => {
		class Plain {}
		expect(() => ApiCrudQuery(Plain)).toThrow(/CrudService/);
	});
});
