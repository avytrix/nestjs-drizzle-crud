import { expect, test } from "@playwright/test";

// The example app serves its OpenAPI document at /docs-json. ApiCrudList on
// GET /countries and the factory's `openapi` option on /projects describe the
// list query parameters from each entity's allowlists.

test.describe("OpenAPI document", () => {
	test("documents the list query parameters", async ({ request }) => {
		const res = await request.get("/docs-json");
		expect(res.status()).toBe(200);
		const doc = await res.json();

		const params = (path: string) =>
			doc.paths[path].get.parameters.map((p: any) => p.name);
		const countries = params("/countries");
		for (const name of [
			"page",
			"limit",
			"sortBy",
			"cursor",
			"withCount",
			"with",
			"counts",
			"search",
			"fields",
			"name",
			"region[name]",
			"states[name]",
		]) {
			expect(countries).toContain(name);
		}
		// Not in filterableColumns, so not documented as a filter.
		expect(countries).not.toContain("created_at");

		expect(params("/projects")).toContain("name");
		expect(doc.paths["/projects/trash"].get).toBeDefined();
		expect(Object.keys(doc.paths["/projects/{id}"]).sort()).toEqual([
			"delete",
			"get",
			"patch",
		]);
		expect(doc.paths["/projects/bulk"].post).toBeDefined();
		const envelope =
			doc.paths["/countries"].get.responses["200"].content["application/json"]
				.schema;
		expect(Object.keys(envelope.properties)).toContain("hasMore");
	});
});
