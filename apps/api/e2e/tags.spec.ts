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
