import { type INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../src/app.module";

// End-to-end against the real Postgres in DATABASE_URL. Reads exercise the
// seeded geo tables (countries); writes go to the empty `tags` table and clean
// up after themselves so the shared DB is left untouched.
// Skipped when DATABASE_URL is unset (e.g. fork PRs without the secret).
const describeE2e = process.env.DATABASE_URL ? describe : describe.skip;

describeE2e("API (e2e)", () => {
	let app: INestApplication;

	beforeAll(async () => {
		const moduleRef = await Test.createTestingModule({
			imports: [AppModule],
		}).compile();

		app = moduleRef.createNestApplication();
		app.useGlobalPipes(
			new ValidationPipe({
				whitelist: true,
				transform: true,
				transformOptions: { enableImplicitConversion: true },
			}),
		);
		await app.init();
	});

	afterAll(async () => {
		await app.close();
	});

	describe("countries (read)", () => {
		it("paginates", async () => {
			const res = await request(app.getHttpServer())
				.get("/countries?limit=5")
				.expect(200);
			expect(res.body.total).toBe(50);
			expect(res.body.data).toHaveLength(5);
			expect(res.body.limit).toBe(5);
			expect(res.body.page).toBe(1);
		});

		it("eager-loads the region relation", async () => {
			const res = await request(app.getHttpServer())
				.get("/countries?limit=1&withRegion=true")
				.expect(200);
			const [country] = res.body.data;
			expect(country).toHaveProperty("region");
			// region is either a joined object or null, never a bag of nulls
			if (country.region !== null) {
				expect(typeof country.region).toBe("object");
				expect(country.region).toHaveProperty("name");
			}
		});

		it("filters by code (case-insensitive)", async () => {
			const res = await request(app.getHttpServer())
				.get("/countries?limit=50")
				.expect(200);
			const sample = res.body.data[0];
			const filtered = await request(app.getHttpServer())
				.get(`/countries?code=${sample.code.toLowerCase()}`)
				.expect(200);
			expect(filtered.body.total).toBeGreaterThanOrEqual(1);
			expect(filtered.body.data[0].code.toLowerCase()).toBe(
				sample.code.toLowerCase(),
			);
		});

		it("fetches one by id", async () => {
			const list = await request(app.getHttpServer()).get("/countries?limit=1");
			const id = list.body.data[0].id;
			const res = await request(app.getHttpServer())
				.get(`/countries/${id}`)
				.expect(200);
			expect(res.body.id).toBe(id);
		});

		it("404s for a missing country", async () => {
			await request(app.getHttpServer()).get("/countries/99999999").expect(404);
		});

		it("400s for a non-numeric id", async () => {
			await request(app.getHttpServer()).get("/countries/abc").expect(400);
		});
	});

	describe("countries (has-many + column selection)", () => {
		it("eager-loads the states collection for a whole page", async () => {
			const res = await request(app.getHttpServer())
				.get("/countries?limit=10&withStates=true")
				.expect(200);
			expect(res.body.data).toHaveLength(10);
			// Every row carries an array, even when the country has no states.
			for (const country of res.body.data) {
				expect(Array.isArray(country.states)).toBe(true);
				for (const state of country.states) {
					expect(state.country_id).toBe(country.id);
				}
			}
			// At least one country in the seed set actually has states.
			expect(res.body.data.some((c: any) => c.states.length > 0)).toBe(true);
		});

		it("keeps total right when a has-many relation is loaded", async () => {
			const plain = await request(app.getHttpServer()).get(
				"/countries?limit=5",
			);
			const withStates = await request(app.getHttpServer()).get(
				"/countries?limit=5&withStates=true",
			);
			expect(withStates.body.total).toBe(plain.body.total);
			expect(withStates.body.data).toHaveLength(5);
		});

		it("eager-loads a has-many collection on a single country", async () => {
			const list = await request(app.getHttpServer()).get(
				"/countries?limit=50&withStates=true",
			);
			const parent = list.body.data.find((c: any) => c.states.length > 0);
			const res = await request(app.getHttpServer())
				.get(`/countries/${parent.id}?withStates=true`)
				.expect(200);
			expect(res.body.states.length).toBe(parent.states.length);
		});

		it("returns only the requested columns", async () => {
			const res = await request(app.getHttpServer())
				.get("/countries?limit=1&fields=id,name")
				.expect(200);
			expect(Object.keys(res.body.data[0]).sort()).toEqual(["id", "name"]);
		});

		it("narrows relation columns with a dotted path", async () => {
			const res = await request(app.getHttpServer())
				.get(
					"/countries?limit=50&withRegion=true&withStates=true&fields=id,name,region.name,states.name",
				)
				.expect(200);
			const country = res.body.data.find((c: any) => c.states.length > 0);
			// The has-many child keeps its foreign key: grouping needs it.
			expect(Object.keys(country.states[0]).sort()).toEqual([
				"country_id",
				"name",
			]);
			if (country.region) {
				expect(Object.keys(country.region)).toEqual(["name"]);
			}
		});

		it("filters countries by a child column", async () => {
			const list = await request(app.getHttpServer()).get(
				"/countries?limit=50&withStates=true",
			);
			const parent = list.body.data.find((c: any) => c.states.length > 0);
			const stateName = parent.states[0].name;
			const res = await request(app.getHttpServer())
				.get(`/countries?stateName=${encodeURIComponent(stateName)}`)
				.expect(200);
			expect(res.body.total).toBeGreaterThanOrEqual(1);
			expect(res.body.data.map((c: any) => c.id)).toContain(parent.id);
		});
	});

	describe("tags (write, uuid pk)", () => {
		let createdId: string;

		it("creates a tag with a generated uuid", async () => {
			const res = await request(app.getHttpServer())
				.post("/tags")
				.send({ name: `e2e-${Date.now()}` })
				.expect(201);
			expect(res.body.id).toMatch(
				/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
			);
			createdId = res.body.id;
		});

		it("fetches the created tag by uuid", async () => {
			await request(app.getHttpServer()).get(`/tags/${createdId}`).expect(200);
		});

		it("rejects an invalid uuid with 400", async () => {
			await request(app.getHttpServer()).get("/tags/not-a-uuid").expect(400);
		});

		it("deletes the tag and then 404s", async () => {
			await request(app.getHttpServer())
				.delete(`/tags/${createdId}`)
				.expect(200);
			await request(app.getHttpServer()).get(`/tags/${createdId}`).expect(404);
		});
	});
});
