# viliha-drizzle

[![docs](https://img.shields.io/badge/docs-crud.viliha.com-E0234E)](https://crud.viliha.com)
[![npm](https://img.shields.io/npm/v/nestjs-drizzle-crud?color=E0234E)](https://www.npmjs.com/package/nestjs-drizzle-crud)
[![license](https://img.shields.io/npm/l/nestjs-drizzle-crud)](./LICENSE)
[![CI](https://github.com/myviliha/viliha-drizzle-crud/actions/workflows/ci.yml/badge.svg)](https://github.com/myviliha/viliha-drizzle-crud/actions/workflows/ci.yml)
[![Sponsor @myviliha](https://img.shields.io/badge/Sponsor-%40myviliha-db61a2?style=for-the-badge&logo=githubsponsors&logoColor=white)](https://github.com/sponsors/myviliha)

## ❤️ Sponsoring is what keeps this free

`nestjs-drizzle-crud` absorbs the work of owning a CRUD layer in production:
dialect differences, driver result shapes, error codes that have to become the
right HTTP status, counts that stay correct once filters and joins are in play.
It is given away under MIT, and keeping it current with NestJS, Drizzle and
TypeScript releases is ongoing work.

**Even $1 a month helps.** It funds bug fixes, new guides, and the next release.

> Sponsors get a spot on the [sponsor page](https://crud.viliha.com/docs/sponsor)
> and our genuine thanks.

### 👉 [Sponsor on GitHub →](https://github.com/sponsors/myviliha) &nbsp;·&nbsp; thank you 🙏

---

Monorepo for [**nestjs-drizzle-crud**](./packages/nestjs-drizzle-crud), a
complete, type-safe CRUD abstraction for [Drizzle ORM](https://orm.drizzle.team/)
in [NestJS](https://nestjs.com/).

Turborepo + pnpm, TypeScript 7. Lint and format via [Biome](https://biomejs.dev/).

**Docs:** [crud.viliha.com](https://crud.viliha.com) ·
**npm:** [nestjs-drizzle-crud](https://www.npmjs.com/package/nestjs-drizzle-crud) ·
**Sponsor:** [github.com/sponsors/myviliha](https://github.com/sponsors/myviliha)

## Install the package

```bash
pnpm add nestjs-drizzle-crud
pnpm add @nestjs/common @nestjs/core drizzle-orm reflect-metadata   # peers
pnpm add postgres          # PostgreSQL, only when the module builds the connection
```

Configure the connection once, then every entity gets the full CRUD surface:

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

Full guides, API reference and an FAQ are at [crud.viliha.com](https://crud.viliha.com).

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

`pnpm dev` runs the docs site, the same way it does in the other Viliha repos.

Publishing (maintainers), after the verify set is green. A `v*` tag is the normal
path; `pnpm release` is the manual fallback:

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
[the AI agents guide](https://crud.viliha.com/docs/ai-agents).

## TypeScript 7 toolchain notes

TS 7 ships the native compiler, and a few ecosystem tools do not consume its API
yet. Where that bit, the workspace routes around it rather than downgrading the
package:

- **Tests** use `@swc/jest`, not `ts-jest`, which is incompatible with TS 7.
  Types are still enforced by `tsc --noEmit` in `typecheck`.
- **Lint and format** use Biome, not `typescript-eslint`, which caps at TS < 6.1.
- **`apps/docs`** pins TypeScript 5.9 locally, because Fumadocs' Twoslash
  code-sample renderer needs the classic compiler API. The published library and
  the api app are on TS 7.

## The example api (apps/api)

A real NestJS app exercising the library. It maps the geo tables (regions →
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

`DATABASE_URL=pglite` selects that in-process database. Point it at a real
Postgres connection string instead and the same app talks to that server, which
is what `pnpm dev:api` does with `apps/api/.env`.

## CI / CD

- **CI** (`.github/workflows/ci.yml`): lint, typecheck, build and test on push and PR.
- **Docs** (`deploy-docs.yml`): static export to GitHub Pages on push to `main`,
  served at [crud.viliha.com](https://crud.viliha.com). One-time setup is
  Settings → Pages → Source = GitHub Actions.
- **Release** (`release.yml`): on a `v*` tag, re-runs the verify set and publishes
  [`nestjs-drizzle-crud`](https://www.npmjs.com/package/nestjs-drizzle-crud) to npm
  with provenance (needs the `NPM_TOKEN` secret).
- **Security**: CodeQL, Semgrep, Gitleaks and a production `pnpm audit` on every
  push and PR. Every action is pinned to a commit SHA and bumped by Dependabot.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the PR workflow, and
[AGENTS.md](./AGENTS.md) for the rules every change follows, including the
mandatory changelog and docs update.

## License

MIT
