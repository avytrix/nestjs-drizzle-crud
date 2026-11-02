# AGENTS.md

Deterministic rules for AI agents working in this repo. Read this first.

## What this repo is

Turborepo + pnpm monorepo. One published library, two private apps:

- `packages/nestjs-drizzle-crud` (npm: `nestjs-drizzle-crud`), the only public artifact. Built with `tsc` to `dist/`.
- `apps/docs`, Next.js 16 + Fumadocs, static-exported to GitHub Pages at [crud.avytrix.dev](https://crud.avytrix.dev). This is what `pnpm dev` runs, on **:3000**. Its own rules live in `apps/docs/AGENTS.md`.
- `apps/api`, an example NestJS 11 app that doubles as the e2e testbed. `pnpm dev:api`, on **:4000**. `pnpm dev:all` runs both. Its e2e suite is Playwright over real HTTP against **PGlite** (Postgres compiled to WASM, in-process), so it needs no container, no credentials and no browser download.

Node >= 20, pnpm 10, TypeScript 7 (except `apps/docs`, which pins 5.9). Lint and format are Biome, tabs, double quotes, 80 columns.

## Where things go (do exactly this)

| Task | Location |
| --- | --- |
| New or changed CRUD behaviour (queries, filters, pagination, relations, locks) | `packages/nestjs-drizzle-crud/src/core/abstract/sql-base-crud.service.ts` |
| New public type or config option | `src/core/interfaces/*.ts` or `src/core/types/sql.types.ts`, then **re-export from `src/index.ts`** |
| New exception | `src/exceptions/crud.exceptions.ts`, extending the NestJS `HttpException` subclass that carries the right status |
| Module wiring, defaults, per-entity config merge | `src/modules/drizzle-crud.module.ts` |
| Generated CRUD routes (`createCrudController`) | `src/controller/crud-controller.factory.ts` |
| OpenAPI decorators (`ApiCrudQuery`, `ApiCrudList`) | `src/openapi/api-crud.decorators.ts`, requiring `@nestjs/swagger` lazily |
| Module-level write events (`CrudEventBus`) | `src/core/events/crud-event-bus.ts`, wired in the module when `hooks.enableGlobalHooks` is on |
| Per-request context for tenant scopes (`CrudContext`) | `src/core/context/crud-context.ts` (Node `AsyncLocalStorage`) |
| Driver or connection lifecycle | `src/modules/drizzle-connection.ts` |
| Helper shipped to consumers for their tests | `src/test-utils/` (exported from `src/index.ts`) |
| MCP server tools, protocol handling, doc sources | `src/mcp/server.ts` (zero deps, stdio JSON-RPC; the `nestjs-drizzle-crud-mcp` bin) |
| Rules an agent consuming the package must follow | `AGENT.md`, pointed at by `AGENTS.template.md` and `CLAUDE.template.md` |
| Unit test | `packages/nestjs-drizzle-crud/test/<area>.spec.ts` |
| Proof it works over real HTTP and real Postgres | `apps/api/e2e/*.spec.ts` (Playwright), plus a route under `apps/api/src/<entity>/` if the feature needs one |
| e2e fixture: tables and seed rows the specs assert against | `apps/api/src/db/pglite.ts` (DDL + seed), mirroring `apps/api/src/db/schema.ts` |
| New docs page | `apps/docs/content/docs/(<section>)/<name>.mdx` plus its `meta.json` entry |
| Docs layout, design tokens, nav | `apps/docs/AGENTS.md`, never ad hoc |

## Single sources of truth, never duplicate

- **Public API surface** goes in `src/index.ts`. If it is not exported there, consumers do not have it, so adding a class or type without touching that file is an incomplete change.
- **Config defaults and merge order** live in `drizzle-crud.module.ts` (`normalizeConfig`, `buildEntityConfig`) and the `defaultConfig` field on `SqlBaseCrudService`. Do not add a fourth place that decides a default.
- **Release history** is `packages/nestjs-drizzle-crud/CHANGELOG.md`. The docs page `apps/docs/content/docs/(reference)/changelog.mdx` mirrors it; it is a copy, not a second record.
- **Documented package version** is `apps/docs/lib/seo.ts` (`siteConfig.version`), plus the home page snapshot in `apps/docs/components/home/latest-releases.tsx`.
- **Connection ownership** is `DrizzleConnection`. Nothing else opens or closes a driver.

## Architecture: config in, one service, Drizzle out

`SqlBaseCrudService` holds essentially all behaviour. A consumer service is normally an empty subclass that only declares its generics; `apps/api/src/countries/countries.service.ts` is the reference. There is no query-builder layer between the service and Drizzle, and there should not be one.

Config reaches a service through three merge layers, each overriding the one before:

1. **Project defaults.** `forRoot` / `forRootAsync` config passes through `normalizeConfig`, which fills in soft delete, timestamps, pagination and the `sql` flags, then publishes the result as `DRIZZLE_CRUD_CONFIG`.
2. **Per entity.** `buildEntityConfig` layers `@CrudService` decorator metadata (`crud:config`), then the `config` object from `forFeature`, then the injected `db` and `table`.
3. **Service construction.** The constructor spreads the incoming config over its own `defaultConfig` and validates it.

Two consequences you must preserve:

- **A behaviour bug is usually a merge-order bug.** Before changing query code, check which of the three layers set the value you are seeing.
- **Services are not `@Injectable()`.** `forFeature` builds them with a `useFactory` and hands the config to the constructor. Adding a decorator or a second constructor parameter breaks registration.

Other invariants:

- **Dialect awareness is real, not cosmetic.** `useReturning` defaults on for `postgresql` and is force-disabled for `mysql`. `wasAffected()` normalizes postgres-js, node-postgres and mysql2 result shapes. New mutations go through it rather than reading `.rowCount` directly.
- **Connections are only owned when built here.** A caller supplied `db` is used as is and left alone. A `connectionString` is postgres only, and the connection it creates is closed on module destroy.
- **Only a top-level belongs-to is joined.** Belongs-to (`localKey` referencing `references`) rides along in the main query as a `LEFT JOIN`; `findAll` joins the union of those and the relation filter relations for the data query, but only the filter relations for the count query. Keep that split; joining eager relations into the count query changes `total`. Everything else is batched by `loadRelations`: has-many (`foreignKey`), many-to-many (`through` + `throughLocalKey` + `throughForeignKey`), and every nested level whatever its shape. A collection must never be joined, and a collection filter must stay an `IN (SELECT ...)` subquery (`buildCollectionFilter`): a join multiplies parent rows and breaks both `total` and pagination.
- **Eager loading is never per row.** `loadRelations` costs one query per relation per level for the whole result set, whatever the row count, and siblings run concurrently. A new read path that loops a query over rows is the N+1 bug this exists to prevent.
- **A narrowed projection still carries its keys.** `withRequiredKeys` and `keysForChildren` add back the parent key, the child foreign key and any key a nested level needs. Drop one and the grouping silently produces empty collections.
- **Soft delete is a predicate, not a mode.** Every read appends `isNull(deleted_at)` when it is enabled. A new read path that forgets it will happily return deleted rows.
- **The tenant scope rides on the same predicate.** Reads, counts and existence checks take their WHERE from `rowScope(options)` (tenant scope plus soft delete), and every UPDATE or DELETE takes it from `writeWhere(ids, options)` (primary key, tenant scope, expected version). A new read or write path builds its WHERE from these two, never from `softDeleteScope` or a bare `eq(pk, id)`, or it leaks across tenants. Inserts go through `prepareCreate`, which writes the scope onto the row.
- **Events fire once per call.** A mass write raises one before and one after event with every id, from inside its transaction. Do not emit per item from a set statement.
- **Relation filters below the first belongs-to are subqueries.** A path (`state.country.code`) is `EXISTS` on an aliased table, and `none` / `every` are `NOT EXISTS`. Only a top-level belongs-to may be joined.
- **Errors map to HTTP by construction.** The exceptions extend `NotFoundException`, `ConflictException` and `BadRequestException`, so Nest's default filter returns 404, 409 and 400 without a custom filter. Driver error codes are translated at the service boundary. Never let a raw `DrizzleQueryError` reach the client as a 500 when it is caused by bad input.

## Hard rules

1. **Public API changes go through `src/index.ts`.** Anything exported is a contract; removing or renaming it is a major version.
2. **Strict TypeScript.** The `any` in the config plumbing is deliberate because Drizzle table types are structural, but new code takes typed parameters and returns typed results. Do not spread `any` outward into the public surface.
3. **No new runtime dependency.** The package has zero dependencies and only peers (`@nestjs/common`, `@nestjs/core`, `drizzle-orm`, `reflect-metadata`, optional `postgres`). Adding one is a breaking decision for every consumer, so solve it with what is there.
4. **Peer imports of optional drivers stay dynamic.** `postgres` and `drizzle-orm/postgres-js` are imported inside `DrizzleConnection.init` with `await import(...)` so a consumer who passes their own `db` never needs them installed. `@nestjs/swagger` is required inside `ApiCrudQuery` / `ApiCrudList` the first time one runs. Keep it that way.
5. **One query per operation where the SQL allows it.** Data and count run as a single `Promise.all`. Do not add a per row lookup, and never loop a query over an array of ids when `inArray` covers it.
6. **Bulk operations run in a transaction** and report per item failures through `BulkOperationException`. A partial write that silently succeeds is a bug.
7. **Type checking is a separate gate.** Tests run through `@swc/jest`, which only strips types, so a type error will not fail the test run. `pnpm typecheck` is the check that catches it, and it is not optional.
8. **Do not swap the toolchain.** `ts-jest` is incompatible with TypeScript 7, typescript-eslint caps below it, and `apps/docs` pins 5.9 for Fumadocs Twoslash. These are worked around on purpose; do not "fix" them by downgrading.
9. **Comment deliberate no-ops.** A swallowed error or an intentionally empty hook gets a line saying why. Never silently discard an error anywhere else.
10. **Every behaviour change carries a test.** Unit tests for logic, an e2e assertion in `apps/api/e2e` for anything that has to be true over real HTTP against real Postgres. The e2e suite runs everywhere with no setup, so "I could not test the database path" is not a reason to skip it.
11. **The e2e suite runs on PGlite, never on Docker and never on a real database.** `apps/api/playwright.config.ts` pins `DATABASE_URL=pglite` for the server it boots, which overrides anything in the shell or in `apps/api/.env`, so the suite cannot reach a real server. Do not add a container, a service, a compose file or a `DATABASE_URL` secret to make tests pass; extend the fixture in `apps/api/src/db/pglite.ts` instead. A real connection string stays a `pnpm dev:api` concern only.
12. **Changelog and docs on every change (mandatory, see below).** No feature or fix is done until the changelog and the relevant docs are updated in the same change. After writing them you re-read and humanize the prose, and make it SEO and AEO friendly.

## Changelog and docs, mandatory on every change, never skip

Any change that adds, changes, removes or fixes behaviour **must** update the docs in the same commit or PR. This is not optional and cannot be deferred:

1. **`packages/nestjs-drizzle-crud/CHANGELOG.md`**, an entry under the target version (Added / Changed / Fixed / Removed), Keep a Changelog style. If the change ships in the npm package (anything under `packages/nestjs-drizzle-crud/**`), also **bump `package.json`** per semver: patch for a fix, minor for a feature, major for a break.
2. **Every doc surface that describes the thing.** They are single sources; do not let them drift.
   - `packages/nestjs-drizzle-crud/README.md` (npm facing) and `packages/nestjs-drizzle-crud/AGENT.md` (the guide for agents consuming the package) for anything user facing.
   - The docs site under `apps/docs/content/docs/**`: the matching page, plus the section `meta.json` if you add a page, plus `(reference)/api.mdx`, `(reference)/exports.mdx` and `(reference)/config-types.mdx` when the surface changes.
   - `(reference)/changelog.mdx`, which mirrors the package changelog.
   - The reference docs for the workflow itself (`README.md`, `CONTRIBUTING.md`, this file) when the rules change.
3. **A release also syncs the version references**: `apps/docs/lib/seo.ts` (`siteConfig.version`) and `apps/docs/components/home/latest-releases.tsx`, in the same change as the package bump.
4. **After writing any docs, check and humanize them (mandatory).** Once the prose is drafted (README, changelog entries, docs pages, reader facing comments, this file), re-read it before committing and rewrite anything that sounds machine generated. This is a required final pass, not optional. In that pass:
   - **Remove every em dash (the `—` character) used as punctuation, no exceptions.** It is the single biggest AI tell. Rewrite around it with a comma, a colon, parentheses, or by splitting the sentence. The only acceptable use is a literal reference to the character, as in this rule.
   - Use plain, direct language and vary sentence length.
   - Cut filler and the usual AI tells: "delve", "seamless", "robust", "leverage", "it's worth noting", hedging, padded bullet lists.
   - Prefer a concrete example over an abstract claim, and match the voice already in the repo.
   - If a sentence reads like boilerplate, rewrite it or delete it.
5. **Docs must be SEO and AEO friendly (mandatory).** Write every doc so both search engines and answer engines (Google, plus assistants like ChatGPT, Claude and Perplexity) can find, index and quote it. Apply this in the same pass as the humanize check.
   - **SEO:** give each docs page a unique, keyword led `title` and `description` in its frontmatter; one `H1` per page, then a logical `H2`/`H3` outline built from real search terms; descriptive link text; a self canonical. New pages reach the sitemap through `apps/docs/lib/source.ts`, so verify the route appears.
   - **AEO:** open the page, and each major section, with a one sentence direct answer to the question it addresses, before the detail. Phrase headings the way people ask them ("How do I filter by a related column?"). Keep statements factual, self contained and quotable, define a term on first use, and show real code. Those are the passages an answer engine lifts.

If you are unsure whether a doc applies, it does, so update it. A change that touches code but no docs or changelog is incomplete.

## Verify before "done" (must pass)

```bash
pnpm lint                                   # biome, whole workspace
pnpm typecheck                              # the only gate that sees type errors
pnpm build
pnpm --filter nestjs-drizzle-crud test      # unit
pnpm --filter api test                      # e2e: Playwright + PGlite, no setup needed
```

Single test while iterating:

```bash
pnpm --filter nestjs-drizzle-crud test -- test/bug-fixes.spec.ts
pnpm --filter nestjs-drizzle-crud test -- -t "soft delete"
```

The e2e suite is self-contained: Playwright builds and boots `apps/api` with `DATABASE_URL=pglite`, an in-process Postgres seeded from `apps/api/src/db/pglite.ts`, then drives it over HTTP. A green run does prove the database paths. Rebuild the library first (`pnpm --filter nestjs-drizzle-crud build`) when you run the e2e suite directly, or run it through Turbo from the root, otherwise the app loads a stale `dist/`.

If a spec needs a new table or new seed rows, add them to `apps/api/src/db/pglite.ts` **and** `apps/api/src/db/schema.ts`, and keep the counts the specs assert (50 countries) intact.

Plus, not optional: the changelog and docs update from the rule above, and a `packages/nestjs-drizzle-crud/package.json` bump if the change ships in the package.

## Working style: build the least that works

Prefer the smallest change that solves the problem. Reach for the standard library or an already installed dependency before adding a new one, a native platform feature before hand rolled code, and one line before fifty. Skip speculative abstractions (no interface with one implementation, no config for a value that never changes) and say so in a line rather than building for a future that may not arrive. Non trivial logic still leaves one runnable check behind. This is the default for both humans and agents here.

## Git conventions

- Author is **Suman Bonakurthi**. Do **not** add a Claude or AI co-author trailer or attribution.
- [Conventional Commits](https://www.conventionalcommits.org/), small and focused: `feat(crud): …`, `fix(module): …`, `docs(3.2.1): …`, `chore(release): …`.
- **Every task runs the same loop. Do not skip a step.**

  **Before starting**
  1. `git checkout main && git pull` (rebase if the tree diverged).
  2. Run the verify set on the untouched tree, so a pre-existing failure is never mistaken for yours.
  3. Branch: one branch per feature, bug or issue (`feat/…`, `fix/…`, `docs/…`, `chore/…`).

  **Before committing**
  4. `git pull --rebase origin main` again, to pick up whatever landed while you worked.
  5. Run the full verify set again. It has to be green.
  6. Update the changelog and every doc the change touches, and bump the package version if the change ships in the package.

  **Finishing**
  7. Merge into `main`, push, then delete the branch (local and remote).
  8. One task, one branch. Follow-up work for the same task goes on the same branch. If a second branch already exists and both are unmerged, rebase it onto the first and continue there, so `main` never gets a half consistent merge.

- **Pushing to `main` is allowed.** It is allowed because step 5 is done, not instead of it. Never push a tree you have not just verified, and never leave `main` red: if something lands broken, fix it forward immediately rather than waiting to be asked. External contributors still work from a fork and a PR (see `CONTRIBUTING.md`).

## Release and CI/CD

- **Every workflow pins its actions to a commit SHA**, with the version in a trailing comment. Dependabot bumps them monthly (`chore(ci)` prefix). Never reintroduce a floating `@v4` tag.
- **CI** (`ci.yml`) runs lint, typecheck, build and test on Node 20 and 24 for every push and PR to `main`. **CodeQL**, **Semgrep**, **Gitleaks** and a production `pnpm audit` run alongside it.
- **Docs** deploy from `deploy-docs.yml` on push to `main`: a static export to GitHub Pages served at the `CNAME` domain.
- **Releases publish on a `v*` tag**, not on a GitHub Release. The workflow re-runs the verify set, writes the npm token to `~/.npmrc` explicitly (pnpm does not reliably read `NODE_AUTH_TOKEN`), and publishes with provenance:

  ```bash
  # after the version bump and changelog entry are committed and green
  git tag v3.2.2 && git push origin v3.2.2
  ```

- The manual fallback is `pnpm release` from the repo root, which runs `pnpm publish` in the package after `prepublishOnly` rebuilds and re-tests it. It publishes without provenance, so prefer the tag. Use pnpm for everything here; there is no npm-based path in this repo.

## Performance defaults

- **Two queries per list, no more.** `findAll` runs the data query and the count query together. Anything that turns a list into per row queries is a regression.
- **Join only what is used.** Eager relations join the data query; filter relations join both. Do not join a relation nobody selected or filtered on.
- **Set operations over loops.** `inArray` for id sets, one `UPDATE` for a mass update, one transaction for a bulk write.
- **Select what you need.** `options.select` builds a partial select; use it in hot paths rather than hydrating every column.
- **Locks are explicit.** `options.lock` maps to `FOR UPDATE` / `FOR SHARE`. Take one only inside a transaction, and prefer `forNoKeyUpdate` when the row's key is not changing.
- **Keep the cold path cold.** Optional drivers load through dynamic import, so a consumer who never uses them never pays for them.
