import { expect, test } from "@playwright/test";

// GET /countries runs the whole query string through service.parseQuery, so
// these go over real HTTP into PGlite: bracket operators, relation filters,
// or / not groups, multi-column sorts, keyset pages and the allowlists set in
// countries.module.ts. Fixture: 50 countries, 12 in Asia (region 1).

const get = async (request: any, url: string) => {
	const res = await request.get(url);
	return { status: res.status(), body: await res.json() };
};

test.describe("query string parser", () => {
	test("coerces bracket operators by column type", async ({ request }) => {
		const { body } = await get(
			request,
			"/countries?region_id[in]=1,3&limit=50",
		);
		expect(body.total).toBe(22);
		expect(body.data.every((c: any) => [1, 3].includes(c.region_id))).toBe(
			true,
		);
	});

	test("filters by a belongs-to column", async ({ request }) => {
		const { body } = await get(request, "/countries?region[name]=Asia");
		expect(body.total).toBe(12);
	});

	test("escapes startsWith", async ({ request }) => {
		const { body } = await get(
			request,
			"/countries?name[startsWith]=Country%204&limit=50",
		);
		expect(body.total).toBe(9);
	});

	test("ORs and NOTs, relations included", async ({ request }) => {
		const either = await get(
			request,
			"/countries?or[0][code]=IN&or[1][code]=NP",
		);
		expect(either.body.data.map((c: any) => c.name)).toEqual([
			"India",
			"Nepal",
		]);
		const notAsia = await get(request, "/countries?not[region][name]=Asia");
		expect(notAsia.body.total).toBe(38);
	});

	test("sorts by a relation column, then by name", async ({ request }) => {
		const { body } = await get(
			request,
			"/countries?sortBy=region.name,-name&with=region&limit=50",
		);
		const keys = body.data.map((c: any) => [c.region.name, c.name]);
		const sorted = [...keys].sort((a, b) =>
			a[0] === b[0] ? (a[1] < b[1] ? 1 : -1) : a[0] < b[0] ? -1 : 1,
		);
		expect(keys).toEqual(sorted);
		expect(keys[0][0]).toBe("Africa");
	});

	test("answers bad input with a 400", async ({ request }) => {
		for (const url of [
			"/countries?limit=abc",
			"/countries?region_id=abc",
			"/countries?nope=1",
			"/countries?name[roughly]=x",
			"/countries?or[0][nope]=1",
		]) {
			expect((await request.get(url)).status(), url).toBe(400);
		}
	});
});

test.describe("allowlists", () => {
	test("rejects a column or relation outside the lists", async ({
		request,
	}) => {
		for (const url of [
			"/countries?fields=id,updated_at",
			"/countries?created_at[gte]=2020-01-01",
			"/countries?sortBy=region_id",
			"/countries?states[code]=KA",
			"/countries?with=bogus",
			"/countries/1?fields=updated_at",
		]) {
			expect((await request.get(url)).status(), url).toBe(400);
		}
	});

	test("allows what is listed", async ({ request }) => {
		const { status, body } = await get(
			request,
			"/countries?code=in&fields=id,name,states.name&with=states",
		);
		expect(status).toBe(200);
		expect(body.data[0].states).toHaveLength(3);
	});
});

test.describe("keyset pagination", () => {
	test("walks every country once, in the offset order", async ({ request }) => {
		const offset = await get(request, "/countries?limit=50");
		const seen: number[] = [];
		let cursor = "";
		for (let i = 0; i < 10; i++) {
			const { body } = await get(
				request,
				`/countries?limit=15&cursor=${encodeURIComponent(cursor)}`,
			);
			seen.push(...body.data.map((c: any) => c.id));
			if (!body.nextCursor) break;
			cursor = body.nextCursor;
		}
		expect(seen).toEqual(offset.body.data.map((c: any) => c.id));
	});

	test("counts only when asked", async ({ request }) => {
		const plain = await get(request, "/countries?cursor=&limit=5");
		expect(plain.body.total).toBeUndefined();
		const counted = await get(request, "/countries?cursor=&limit=5&count=true");
		expect(counted.body.total).toBe(50);
		expect((await request.get("/countries?cursor=garbage")).status()).toBe(400);
	});
});

// 3.5.0: relation counts, quantified collection filters and uncounted pages
// over HTTP. India has 3 states, Nepal 1, every other country none.
test.describe("counts, quantifiers and withCount", () => {
	test("puts _count on each row", async ({ request }) => {
		const { body } = await get(
			request,
			"/countries?code[in]=IN,NP,TD&counts=states,tags",
		);
		expect(
			body.data.map((c: any) => [c.code, c._count.states, c._count.tags]),
		).toEqual([
			["TD", 0, 0],
			["IN", 3, 2],
			["NP", 1, 1],
		]);
	});

	test("filters a collection with some / none / every", async ({ request }) => {
		const some = await get(request, "/countries?states[some]=");
		expect(some.body.data.map((c: any) => c.code)).toEqual(["IN", "NP"]);
		const none = await get(
			request,
			"/countries?code[in]=IN,NP&states[none][name]=Kerala",
		);
		expect(none.body.data.map((c: any) => c.code)).toEqual(["NP"]);
		const every = await get(
			request,
			"/countries?code[in]=IN,NP&states[every][name][startsWith]=Ba",
		);
		expect(every.body.data.map((c: any) => c.code)).toEqual(["NP"]);
	});

	test("withCount=false skips the count", async ({ request }) => {
		const { body } = await get(request, "/countries?withCount=false&limit=10");
		expect(body.total).toBeNull();
		expect(body.hasMore).toBe(true);
		expect(body.data).toHaveLength(10);
	});

	test("rejects a count on a belongs-to", async ({ request }) => {
		expect((await request.get("/countries?counts=region")).status()).toBe(400);
	});
});
