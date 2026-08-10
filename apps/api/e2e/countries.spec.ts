import { expect, test } from "@playwright/test";

// Reads against the seeded fixture in src/db/pglite.ts: 5 regions, 50 countries,
// 4 states (3 for India, 1 for Nepal), 3 cities, and 2 tags linked through
// country_tags. Every assertion below goes over real HTTP into a real Postgres.

test.describe("countries: list, filter, search", () => {
	test("paginates", async ({ request }) => {
		const res = await request.get("/countries?limit=5");
		expect(res.status()).toBe(200);
		const body = await res.json();
		expect(body.total).toBe(50);
		expect(body.data).toHaveLength(5);
		expect(body.limit).toBe(5);
		expect(body.page).toBe(1);
	});

	test("filters by code, case-insensitively", async ({ request }) => {
		const res = await request.get("/countries?code=in");
		const body = await res.json();
		expect(body.total).toBe(1);
		expect(body.data[0].name).toBe("India");
	});

	test("searches name and code", async ({ request }) => {
		const res = await request.get("/countries?search=nepal");
		const body = await res.json();
		expect(body.total).toBe(1);
		expect(body.data[0].code).toBe("NP");
	});

	test("sorts by a column", async ({ request }) => {
		const res = await request.get(
			"/countries?limit=50&sortBy=name&sortOrder=asc",
		);
		const body = await res.json();
		const names = body.data.map((c: any) => c.name);
		expect(names).toEqual([...names].sort());
	});

	test("rejects an unknown sort column with 400", async ({ request }) => {
		const res = await request.get("/countries?sortBy=nope");
		expect(res.status()).toBe(400);
	});

	test("fetches one by id and 404s for a missing one", async ({ request }) => {
		const list = await (await request.get("/countries?code=in")).json();
		const id = list.data[0].id;
		const res = await request.get(`/countries/${id}`);
		expect(res.status()).toBe(200);
		expect((await res.json()).id).toBe(id);
		expect((await request.get("/countries/99999999")).status()).toBe(404);
		expect((await request.get("/countries/abc")).status()).toBe(400);
	});
});

test.describe("countries: eager loading without N+1", () => {
	test("loads the belongs-to region", async ({ request }) => {
		const res = await request.get("/countries?code=in&with=region");
		const [country] = (await res.json()).data;
		expect(country.region.name).toBe("Asia");
		expect(country.region.code).toBe("AS");
	});

	test("loads the has-many states for a whole page", async ({ request }) => {
		const res = await request.get("/countries?limit=50&with=states");
		const body = await res.json();
		expect(body.data).toHaveLength(50);
		for (const country of body.data) {
			expect(Array.isArray(country.states)).toBe(true);
			for (const state of country.states) {
				expect(state.country_id).toBe(country.id);
			}
		}
		const india = body.data.find((c: any) => c.name === "India");
		const chad = body.data.find((c: any) => c.name === "Chad");
		// orderBy on the relation: alphabetical, not insertion order.
		expect(india.states.map((s: any) => s.name)).toEqual([
			"Assam",
			"Karnataka",
			"Kerala",
		]);
		// A parent with no children gets an empty array, never undefined.
		expect(chad.states).toEqual([]);
	});

	test("keeps total correct when a collection is loaded", async ({
		request,
	}) => {
		const plain = await (await request.get("/countries?limit=5")).json();
		const withAll = await (
			await request.get("/countries?limit=5&with=states,states.cities,tags")
		).json();
		expect(withAll.total).toBe(plain.total);
		expect(withAll.data).toHaveLength(5);
	});

	test("loads a has-many under a has-many with a dotted path", async ({
		request,
	}) => {
		const res = await request.get(
			"/countries?code=in&with=states,states.cities",
		);
		const [india] = (await res.json()).data;
		const byName = Object.fromEntries(
			india.states.map((s: any) => [s.name, s.cities]),
		);
		expect(byName.Karnataka.map((c: any) => c.name)).toEqual([
			"Bengaluru",
			"Mysuru",
		]);
		expect(byName.Kerala.map((c: any) => c.name)).toEqual(["Kochi"]);
		expect(byName.Assam).toEqual([]);
	});

	test("loads a many-to-many through the join table", async ({ request }) => {
		const res = await request.get("/countries?limit=50&with=tags");
		const body = await res.json();
		const india = body.data.find((c: any) => c.name === "India");
		const nepal = body.data.find((c: any) => c.name === "Nepal");
		const chad = body.data.find((c: any) => c.name === "Chad");
		expect(india.tags.map((t: any) => t.name)).toEqual([
			"himalayan",
			"populous",
		]);
		expect(nepal.tags.map((t: any) => t.name)).toEqual(["himalayan"]);
		expect(chad.tags).toEqual([]);
		// The internal grouping key never reaches the response.
		expect(Object.keys(india.tags[0]).sort()).toEqual([
			"created_at",
			"id",
			"name",
			"updated_at",
		]);
	});

	test("loads relations on a single country too", async ({ request }) => {
		const list = await (await request.get("/countries?code=in")).json();
		const res = await request.get(
			`/countries/${list.data[0].id}?with=region,states,states.cities,tags`,
		);
		const india = await res.json();
		expect(india.region.name).toBe("Asia");
		expect(india.states).toHaveLength(3);
		expect(india.states[1].cities).toHaveLength(2);
		expect(india.tags).toHaveLength(2);
	});
});

test.describe("countries: column selection", () => {
	test("returns only the requested columns", async ({ request }) => {
		const res = await request.get("/countries?limit=1&fields=id,name");
		const body = await res.json();
		expect(Object.keys(body.data[0]).sort()).toEqual(["id", "name"]);
	});

	test("narrows relation columns with dotted paths", async ({ request }) => {
		const res = await request.get(
			"/countries?code=in&with=region,states,states.cities,tags&fields=name,region.name,states.name,states.cities.name,tags.name",
		);
		const [india] = (await res.json()).data;
		// id comes back because the collections need it for grouping.
		expect(Object.keys(india).sort()).toEqual([
			"id",
			"name",
			"region",
			"states",
			"tags",
		]);
		expect(Object.keys(india.region)).toEqual(["name"]);
		// children keep the foreign key that maps them to their parent, and the id
		// their own nested relation needs, plus that relation
		expect(Object.keys(india.states[0]).sort()).toEqual([
			"cities",
			"country_id",
			"id",
			"name",
		]);
		const karnataka = india.states.find((s: any) => s.name === "Karnataka");
		expect(Object.keys(karnataka.cities[0]).sort()).toEqual([
			"name",
			"state_id",
		]);
		expect(Object.keys(india.tags[0])).toEqual(["name"]);
	});

	test("selecting only relation columns keeps the parent whole", async ({
		request,
	}) => {
		const res = await request.get(
			"/countries?code=in&with=region&fields=region.name",
		);
		const [india] = (await res.json()).data;
		expect(india.code).toBe("IN");
		expect(Object.keys(india.region)).toEqual(["name"]);
	});
});

test.describe("countries: filtering by a related collection", () => {
	test("filters by a has-many child column", async ({ request }) => {
		const res = await request.get("/countries?stateName=Kerala");
		const body = await res.json();
		expect(body.total).toBe(1);
		expect(body.data[0].name).toBe("India");
	});

	test("filters by a many-to-many tag", async ({ request }) => {
		const res = await request.get(
			"/countries?tagName=himalayan&sortBy=name&sortOrder=asc",
		);
		const body = await res.json();
		// Both India and Nepal carry the tag, and neither row is duplicated.
		expect(body.total).toBe(2);
		expect(body.data.map((c: any) => c.name)).toEqual(["India", "Nepal"]);
	});

	test("a collection filter does not multiply rows", async ({ request }) => {
		// India has 3 states; a JOIN would report 3 and paginate wrongly.
		const res = await request.get("/countries?stateName=Kerala&limit=10");
		const body = await res.json();
		expect(body.data).toHaveLength(1);
		expect(body.total).toBe(1);
	});
});
