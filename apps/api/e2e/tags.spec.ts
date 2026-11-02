import { expect, test } from "@playwright/test";

// Writes go to the uuid-keyed tags table and clean up after themselves, so the
// seeded fixture is left as the read specs expect it.
test.describe("tags: write paths on a uuid primary key", () => {
	let createdId: string;

	test("creates a tag with a generated uuid", async ({ request }) => {
		const res = await request.post("/tags", {
			data: { name: `e2e-${process.pid}` },
		});
		expect(res.status()).toBe(201);
		const tag = await res.json();
		expect(tag.id).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
		);
		expect(tag.created_at).toBeTruthy();
		createdId = tag.id;
	});

	test("fetches it back by uuid", async ({ request }) => {
		const res = await request.get(`/tags/${createdId}`);
		expect(res.status()).toBe(200);
		expect((await res.json()).id).toBe(createdId);
	});

	test("rejects an invalid uuid with 400", async ({ request }) => {
		expect((await request.get("/tags/not-a-uuid")).status()).toBe(400);
	});

	test("deletes it, then 404s", async ({ request }) => {
		expect((await request.delete(`/tags/${createdId}`)).status()).toBe(200);
		expect((await request.get(`/tags/${createdId}`)).status()).toBe(404);
	});
});

// massDelete runs every id in its own savepoint inside one transaction: one bad
// id is reported on its own, and nothing is deleted unless every id succeeds.
test.describe("tags: bulk delete", () => {
	const missing = "99999999-9999-4999-8999-999999999999";

	test("reports each failed id in the response body", async ({ request }) => {
		const created = await (
			await request.post("/tags", { data: { name: `bulk-${process.pid}` } })
		).json();

		const res = await request.post("/tags/bulk-delete", {
			data: { ids: [missing, created.id] },
		});
		expect(res.status()).toBe(400);
		const body = await res.json();
		expect(body.message).toContain("1 error(s)");
		expect(body.errors).toEqual([
			{ id: missing, status: 404, message: expect.any(String) },
		]);
		// The good id was rolled back with the rest, so the tag is still there.
		expect((await request.get(`/tags/${created.id}`)).status()).toBe(200);

		const ok = await request.post("/tags/bulk-delete", {
			data: { ids: [created.id] },
		});
		expect(ok.status()).toBe(200);
		expect((await request.get(`/tags/${created.id}`)).status()).toBe(404);
	});
});

// Tags are soft-deleted. A trashed tag disappears from reads, shows up with
// ?onlyDeleted=true, can be restored, and is gone for good after a purge.
test.describe("tags: trash and purge", () => {
	test("archive, list the trash, restore, purge", async ({ request }) => {
		const tag = await (
			await request.post("/tags", { data: { name: `trash-${process.pid}` } })
		).json();
		const inTrash = async () =>
			(
				await (await request.get("/tags?onlyDeleted=true&limit=100")).json()
			).data
				.map((t: any) => t.id)
				.includes(tag.id);

		expect((await request.post(`/tags/${tag.id}/archive`)).status()).toBe(200);
		expect((await request.get(`/tags/${tag.id}`)).status()).toBe(404);
		expect(await inTrash()).toBe(true);
		// A plain delete only sees live rows.
		expect((await request.delete(`/tags/${tag.id}`)).status()).toBe(404);

		const restored = await request.post(`/tags/${tag.id}/restore`);
		expect(restored.status()).toBe(200);
		expect((await restored.json()).deleted_at).toBeNull();
		expect(await inTrash()).toBe(false);

		await request.post(`/tags/${tag.id}/archive`);
		expect((await request.delete(`/tags/${tag.id}/purge`)).status()).toBe(200);
		expect(await inTrash()).toBe(false);
		const all = await (
			await request.get("/tags?withDeleted=true&limit=100")
		).json();
		expect(all.data.map((t: any) => t.id)).not.toContain(tag.id);
		expect((await request.delete(`/tags/${tag.id}/purge`)).status()).toBe(404);
	});

	test("purges a mix of live and trashed tags in one call", async ({
		request,
	}) => {
		const [a, b] = await Promise.all(
			["p1", "p2"].map(async (name) =>
				(
					await request.post("/tags", {
						data: { name: `${name}-${process.pid}` },
					})
				).json(),
			),
		);
		await request.post(`/tags/${a.id}/archive`);
		const res = await request.post("/tags/purge", {
			data: { ids: [a.id, b.id] },
		});
		expect(res.status()).toBe(200);
		const all = await (
			await request.get("/tags?withDeleted=true&limit=100")
		).json();
		const left = all.data.map((t: any) => t.id);
		expect(left).not.toContain(a.id);
		expect(left).not.toContain(b.id);
	});

	test("rejects trash flags on an entity that does not allow them", async ({
		request,
	}) => {
		expect((await request.get("/countries?onlyDeleted=true")).status()).toBe(
			400,
		);
	});
});
