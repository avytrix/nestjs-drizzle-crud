import { defineConfig } from "@playwright/test";

// API-level e2e: Playwright drives the real HTTP server through its `request`
// fixture, so no browser is launched and none has to be installed. The server
// runs against PGlite (an in-process Postgres) seeded from src/db/pglite.ts, so
// a run needs no container, no credentials and no shared database.
const PORT = Number(process.env.E2E_PORT ?? 4100);

export default defineConfig({
	testDir: "./e2e",
	// The fixture is read-only apart from the tags suite, which cleans up after
	// itself, and every worker would otherwise get its own seeded database.
	workers: 1,
	reporter: process.env.CI ? "list" : [["list"]],
	use: { baseURL: `http://127.0.0.1:${PORT}` },
	webServer: {
		command: `pnpm build && PORT=${PORT} node dist/main.js`,
		url: `http://127.0.0.1:${PORT}/countries?limit=1`,
		env: { DATABASE_URL: "pglite" },
		reuseExistingServer: false,
		stdout: "pipe",
		stderr: "pipe",
		timeout: 120_000,
	},
});
