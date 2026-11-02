import { expect, test } from "@playwright/test";

// /projects is a createCrudController with a tenant scope, optimistic locking,
// soft delete as the DELETE route and the bulk routes on. The tenant comes from
// the x-tenant-id header through CrudContext.middleware. Fixture: projects 1-3
// belong to tenant 1, 4-5 to tenant 2. Writes use their own rows.

const t1 = { "x-tenant-id": "1" };
const t2 = { "x-tenant-id": "2" };
const unique = (name: string) => `${name}-${process.pid}-${Math.random()}`;

test.describe("createCrudController: projects", () => {
	test("lists only the tenant's rows, offset, cursor and uncounted", async ({
		request,
	}) => {
		const one = await (
			await request.get("/projects?limit=50", { headers: t1 })
		).json();
		expect(one.data.length).toBeGreaterThanOrEqual(3);
		expect(one.data.every((p: any) => p.tenant_id === 1)).toBe(true);
		expect(one.total).toBe(one.data.length);

		const page = await (
			await request.get("/projects?cursor=&limit=1", { headers: t2 })
		).json();
		expect(page.data).toHaveLength(1);
		expect(page.nextCursor).toEqual(expect.any(String));

		const quick = await (
			await request.get("/projects?withCount=false&limit=1", { headers: t1 })
		).json();
		expect(quick.total).toBeNull();
		expect(quick.hasMore).toBe(true);
	});

	test("fails closed without a tenant, and 404s another tenant's id", async ({
		request,
	}) => {
		expect((await request.get("/projects")).status()).toBe(403);
		expect((await request.get("/projects/4", { headers: t1 })).status()).toBe(
			404,
		);
		expect((await request.get("/projects/4", { headers: t2 })).status()).toBe(
			200,
		);
		expect(
			(
				await request.patch("/projects/4", {
					headers: t1,
					data: { name: "stolen" },
				})
			).status(),
		).toBe(404);
		expect(
			(await request.delete("/projects/4", { headers: t1 })).status(),
		).toBe(404);
	});

	test("parses the id with ParseIntPipe from the serial key", async ({
		request,
	}) => {
		const res = await request.get("/projects/abc", { headers: t1 });
		expect(res.status()).toBe(400);
		expect((await res.json()).message).toContain("numeric string");
	});

	test("creates in the caller's tenant and enforces the version", async ({
		request,
	}) => {
		const created = await request.post("/projects", {
			headers: t1,
			data: { name: unique("p") },
		});
		expect(created.status()).toBe(201);
		const project = await created.json();
		expect(project).toMatchObject({ tenant_id: 1, version: 1 });

		const ok = await request.patch(`/projects/${project.id}`, {
			headers: t1,
			data: { name: unique("renamed"), version: 1 },
		});
		expect(ok.status()).toBe(200);
		expect((await ok.json()).version).toBe(2);

		const stale = await request.patch(`/projects/${project.id}`, {
			headers: t1,
			data: { name: unique("late"), version: 1 },
		});
		expect(stale.status()).toBe(409);
		// The DTO is validated: a version that is not an integer is a 400.
		expect(
			(
				await request.patch(`/projects/${project.id}`, {
					headers: t1,
					data: { version: "x" },
				})
			).status(),
		).toBe(400);
	});

	test("DELETE moves to the trash; restore brings it back", async ({
		request,
	}) => {
		const project = await (
			await request.post("/projects", {
				headers: t1,
				data: { name: unique("trash") },
			})
		).json();
		expect(
			(
				await request.delete(`/projects/${project.id}`, { headers: t1 })
			).status(),
		).toBe(200);
		expect(
			(await request.get(`/projects/${project.id}`, { headers: t1 })).status(),
		).toBe(404);
		const trash = await (
			await request.get("/projects/trash?limit=100", { headers: t1 })
		).json();
		expect(trash.data.map((p: any) => p.id)).toContain(project.id);

		const restored = await request.post(`/projects/${project.id}/restore`, {
			headers: t1,
		});
		expect(restored.status()).toBe(200);
		expect((await restored.json()).deleted_at).toBeNull();
		expect(
			(
				await request.post(`/projects/${project.id}/soft-delete`, {
					headers: t1,
				})
			).status(),
		).toBe(200);
	});

	test("bulk create, update, delete and restore", async ({ request }) => {
		const created = await request.post("/projects/bulk", {
			headers: t1,
			data: [{ name: unique("b1") }, { name: unique("b2") }],
		});
		expect(created.status()).toBe(201);
		const ids = (await created.json()).map((p: any) => p.id);
		expect(ids).toHaveLength(2);

		const invalid = await request.post("/projects/bulk", {
			headers: t1,
			data: [{ name: "" }],
		});
		expect(invalid.status()).toBe(400);

		const updated = await request.patch("/projects/bulk", {
			headers: t1,
			data: { ids, data: { name: unique("same") } },
		});
		expect(updated.status()).toBe(200);
		expect((await updated.json()).map((p: any) => p.version)).toEqual([2, 2]);

		const crossTenant = await request.post("/projects/bulk-delete", {
			headers: t1,
			data: { ids: [ids[0], 4] },
		});
		expect(crossTenant.status()).toBe(400);
		expect((await crossTenant.json()).errors).toEqual([
			{ id: 4, status: 404, message: expect.any(String) },
		]);

		expect(
			(
				await request.post("/projects/bulk-delete", {
					headers: t1,
					data: { ids },
				})
			).status(),
		).toBe(200);
		const back = await request.post("/projects/bulk-restore", {
			headers: t1,
			data: { ids },
		});
		expect(back.status()).toBe(200);
		expect((await back.json()).every((p: any) => p.deleted_at === null)).toBe(
			true,
		);
	});
});
