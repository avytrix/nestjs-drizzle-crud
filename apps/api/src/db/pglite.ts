import * as schema from "./schema";

// An in-process Postgres for e2e runs: PGlite is the real Postgres engine
// compiled to WASM, so `RETURNING`, `ILIKE`, `to_tsvector` and the error codes
// the package maps all behave like the server. No container, no shared database
// to seed or clean up, and every run starts from the same fixture.
//
// Used when DATABASE_URL is `pglite` (or `pglite://...`); anything else is
// treated as a normal Postgres connection string. Both dependencies are
// devDependencies, so they are imported lazily and never reach a production
// bundle.
export function isPglite(url?: string): boolean {
	return !!url && (url === "pglite" || url.startsWith("pglite:"));
}

// Mirrors src/db/schema.ts. Kept as plain SQL because it is the fixture for a
// throwaway database, not a migration anyone has to run twice.
const DDL = `
CREATE TABLE regions (
  id serial PRIMARY KEY,
  name varchar NOT NULL,
  code varchar NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE countries (
  id serial PRIMARY KEY,
  name varchar NOT NULL,
  code varchar NOT NULL,
  region_id integer REFERENCES regions(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE states (
  id serial PRIMARY KEY,
  name varchar NOT NULL,
  code varchar NOT NULL,
  country_id integer REFERENCES countries(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE cities (
  id serial PRIMARY KEY,
  name varchar NOT NULL,
  state_id integer REFERENCES states(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE TABLE country_tags (
  country_id integer NOT NULL REFERENCES countries(id),
  tag_id uuid NOT NULL REFERENCES tags(id),
  PRIMARY KEY (country_id, tag_id)
);
CREATE TABLE projects (
  id serial PRIMARY KEY,
  tenant_id integer NOT NULL,
  name varchar NOT NULL,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
`;

// 5 regions, exactly 50 countries, states for the first three of them, cities
// for the first two states, two tags linked to the first two countries, and
// five projects: 1-3 for tenant 1, 4-5 for tenant 2. The e2e specs assert
// against these numbers.
const SEED = `
INSERT INTO regions (name, code) VALUES
  ('Asia', 'AS'), ('Europe', 'EU'), ('Africa', 'AF'),
  ('Americas', 'AM'), ('Oceania', 'OC');

INSERT INTO countries (name, code, region_id)
SELECT 'Country ' || n, 'C' || lpad(n::text, 2, '0'), ((n - 1) % 5) + 1
FROM generate_series(1, 47) AS n;

INSERT INTO countries (name, code, region_id) VALUES
  ('India', 'IN', 1), ('Nepal', 'NP', 1), ('Chad', 'TD', 3);

INSERT INTO states (name, code, country_id)
SELECT s.name, s.code, c.id
FROM countries c
JOIN (VALUES
  ('India', 'Karnataka', 'KA'),
  ('India', 'Kerala', 'KL'),
  ('India', 'Assam', 'AS'),
  ('Nepal', 'Bagmati', 'BA')
) AS s(country, name, code) ON s.country = c.name;

INSERT INTO cities (name, state_id)
SELECT c.name, s.id
FROM states s
JOIN (VALUES
  ('Karnataka', 'Bengaluru'),
  ('Karnataka', 'Mysuru'),
  ('Kerala', 'Kochi')
) AS c(state, name) ON c.state = s.name;

INSERT INTO tags (id, name) VALUES
  ('11111111-1111-1111-1111-111111111111', 'populous'),
  ('22222222-2222-2222-2222-222222222222', 'himalayan');

INSERT INTO country_tags (country_id, tag_id)
SELECT c.id, t.id
FROM countries c
JOIN tags t ON (c.name = 'India' AND t.name IN ('populous', 'himalayan'))
            OR (c.name = 'Nepal' AND t.name = 'himalayan');

INSERT INTO projects (tenant_id, name) VALUES
  (1, 'Apollo'), (1, 'Gemini'), (1, 'Mercury'),
  (2, 'Hubble'), (2, 'Kepler');
`;

// Build a fresh in-memory database, create the tables, seed the fixture, and
// return a Drizzle instance ready to hand to DrizzleCrudModule as `db`.
export async function createPgliteDb(): Promise<any> {
	const { PGlite } = await import("@electric-sql/pglite");
	const { drizzle } = await import("drizzle-orm/pglite");

	const client = await PGlite.create();
	await client.exec(DDL);
	await client.exec(SEED);
	return drizzle(client, { schema });
}
