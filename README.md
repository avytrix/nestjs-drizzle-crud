# nestjs-drizzle-crud

[![docs](https://img.shields.io/badge/docs-crud.avytrix.dev-E0234E)](https://crud.avytrix.dev)
[![npm](https://img.shields.io/npm/v/nestjs-drizzle-crud?color=E0234E)](https://www.npmjs.com/package/nestjs-drizzle-crud)
[![license](https://img.shields.io/npm/l/nestjs-drizzle-crud)](./LICENSE)
[![CI](https://github.com/avytrix/nestjs-drizzle-crud/actions/workflows/ci.yml/badge.svg)](https://github.com/avytrix/nestjs-drizzle-crud/actions/workflows/ci.yml)
[![Sponsor @avytrix](https://img.shields.io/badge/Sponsor-%40avytrix-db61a2?style=for-the-badge&logo=githubsponsors&logoColor=white)](https://github.com/sponsors/avytrix)

Built and maintained by **[Avytrix Technologies](https://avytrix.dev)**.

## ❤️ Sponsoring is what keeps this free

`nestjs-drizzle-crud` handles the parts of a production CRUD layer nobody wants
to own: dialect differences, driver result shapes, database errors that need to
become the right HTTP status, and counts that stay correct once filters and
joins are involved. It is free under MIT, and keeping up with NestJS, Drizzle
and TypeScript releases takes steady work.

**Even $1 a month helps.** It pays for bug fixes, new guides and the next release.

> Sponsors are listed on the [sponsor page](https://crud.avytrix.dev/docs/sponsor).

### [Sponsor on GitHub →](https://github.com/sponsors/avytrix) &nbsp;·&nbsp; thank you

---

This is the monorepo for [**nestjs-drizzle-crud**](./packages/nestjs-drizzle-crud),
type-safe CRUD for [Drizzle ORM](https://orm.drizzle.team/) in
[NestJS](https://nestjs.com/).

It uses Turborepo, pnpm and TypeScript 7, with [Biome](https://biomejs.dev/) for lint and format.

**Docs:** [crud.avytrix.dev](https://crud.avytrix.dev) ·
**npm:** [nestjs-drizzle-crud](https://www.npmjs.com/package/nestjs-drizzle-crud) ·
**Sponsor:** [github.com/sponsors/avytrix](https://github.com/sponsors/avytrix)

## Install the package

```bash
pnpm add nestjs-drizzle-crud
pnpm add @nestjs/common @nestjs/core drizzle-orm reflect-metadata   # peers
pnpm add postgres          # PostgreSQL, only when the module builds the connection
```

Configure the connection once, and every entity gets the full set of CRUD methods:

```typescript
// app.module.ts
DrizzleCrudModule.forRoot({
  dialect: 'postgresql',
  connectionString: process.env.DATABASE_URL,
  schema,
});

// users.service.ts: a complete CRUD service
export class UsersService extends SqlBaseCrudService<User> {}

// users.module.ts
DrizzleCrudModule.forFeature([{ service: UsersService, table: users }]);
```

Guides, the API reference and an FAQ are at [crud.avytrix.dev](https://crud.avytrix.dev).

## Layout

```
packages/
  nestjs-drizzle-crud/   The published npm package (the only public artifact)
apps/
  docs/                  Next.js 16 + Fumadocs docs site → GitHub Pages (static export)
  api/                   Example NestJS 11 app; doubles as the Playwright e2e testbed
```

Only `packages/nestjs-drizzle-crud` is published to npm. `apps/*` are private.

## Develop

```bash
pnpm install
pnpm dev          # docs site on http://localhost:3000
pnpm build        # turbo: builds the library, then the apps that depend on it
pnpm test         # library unit tests + api e2e (no database setup needed)
pnpm typecheck
pnpm lint         # biome, whole workspace
pnpm format       # biome --write
```

Per package:

```bash
pnpm --filter nestjs-drizzle-crud test
pnpm dev:api                                 # example api on http://localhost:4000
pnpm dev:all                                 # docs and api together
```

`pnpm dev` runs the docs site, the same way it does in the other Avytrix Technologies repos.

Publishing is for maintainers, once the verify set is green. Push a `v*` tag;
`pnpm release` is the manual fallback:

```bash
git tag v3.2.2 && git push origin v3.2.2   # release.yml publishes with provenance
pnpm release                                # or publish straight from the package
```

## Working with AI agents

Repo-wide rules for agents live in [`AGENTS.md`](./AGENTS.md), with `CLAUDE.md`
and `GEMINI.md` pointers at the root and a `CLAUDE.md` in each workspace. The
docs site adds its own rules in [`apps/docs/AGENTS.md`](./apps/docs/AGENTS.md).
`.mcp.json` registers this repo's own MCP server for anyone working here.

Consumers of the npm package get their own guide: the tarball ships `AGENT.md`
plus a pointer you can copy into your project, under whatever filename your
agent reads.

```bash
cp node_modules/nestjs-drizzle-crud/AGENTS.template.md ./AGENTS.md   # Codex, Cursor, Copilot, Zed, Cline, Windsurf
cp node_modules/nestjs-drizzle-crud/CLAUDE.template.md ./CLAUDE.md   # Claude Code
```

The package also ships an MCP server, so an agent can search the docs while it
works: `npx nestjs-drizzle-crud-mcp`. Setup per client is in
[the AI agents guide](https://crud.avytrix.dev/docs/ai-agents).

## TypeScript 7 toolchain notes

TS 7 ships the native compiler, and a few tools cannot use its API yet. Where
that caused trouble, the workspace works around the tool instead of downgrading
TypeScript:

- **Tests** use `@swc/jest`, not `ts-jest`, which is incompatible with TS 7.
  Types are still enforced by `tsc --noEmit` in `typecheck`.
- **Lint and format** use Biome, not `typescript-eslint`, which caps at TS < 6.1.
- **`apps/docs`** pins TypeScript 5.9 locally, because Fumadocs' Twoslash
  code-sample renderer needs the classic compiler API. The published library and
  the api app are on TS 7.

## The example api (apps/api)

A real NestJS app that uses the library. It maps the geo tables (regions →
countries → states → cities) plus a uuid-keyed `tags` table and a `country_tags`
join table, so it covers belongs-to, has-many, many-to-many and nested relations,
and exposes `/countries` and `/tags`.

`pnpm --filter api test` runs the e2e suite: **Playwright** drives the app over
real HTTP, and the app runs against **PGlite**, Postgres compiled to WASM,
in-process. No container, no credentials, nothing to seed by hand, and no browser
download (Playwright's `request` fixture never launches one). The fixture lives in
`apps/api/src/db/pglite.ts`: 5 regions, 50 countries, 4 states, 3 cities, 2 tags.

```bash
pnpm --filter api test          # 22 specs in apps/api/e2e
pnpm --filter api test:ui       # the same, in the Playwright UI
```

`DATABASE_URL=pglite` selects that in-process database, and the Playwright config
pins it for the server it boots, overriding anything in your shell or in
`apps/api/.env`. The suite therefore cannot reach a real database, by design. A
real connection string is for `pnpm dev:api` only.

## CI / CD

- **CI** (`.github/workflows/ci.yml`): lint, typecheck, build and test on push and PR.
- **Docs** (`deploy-docs.yml`): static export to GitHub Pages on push to `main`,
  served at [crud.avytrix.dev](https://crud.avytrix.dev). One-time setup is
  Settings → Pages → Source = GitHub Actions. The site has Cmd+K search and an
  "Ask the docs" assistant that runs entirely in the browser.
- **Release** (`release.yml`): on a `v*` tag, re-runs the verify set and publishes
  [`nestjs-drizzle-crud`](https://www.npmjs.com/package/nestjs-drizzle-crud) to npm
  with provenance through npm trusted publishing (no token: npm trusts this
  repo's `release.yml`).
- **Security**: CodeQL, Semgrep, Gitleaks and a production `pnpm audit` on every
  push and PR. Every action is pinned to a commit SHA and bumped by Dependabot.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the PR workflow, and
[AGENTS.md](./AGENTS.md) for the rules every change follows, including the
mandatory changelog and docs update.

## License

MIT
