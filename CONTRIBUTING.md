# Contributing to nestjs-drizzle-crud

Thanks for your interest in contributing. This project is open source (MIT) and
welcomes issues and pull requests from everyone.

## Ways to contribute

- **Report a bug:** open a [Bug report](https://github.com/myviliha/viliha-drizzle-crud/issues/new/choose) issue.
- **Request a feature:** open a Feature request issue.
- **Fix or improve:** send a pull request (see below). Merged PRs make you a project contributor. 🎉
- **Ask or discuss:** use [Discussions](https://github.com/myviliha/viliha-drizzle-crud/discussions).
- **Fund the work:** [sponsor on GitHub](https://github.com/sponsors/myviliha). It is what keeps the package maintained and free.

## Development setup

Requirements: **Node.js >= 20** and **pnpm 10** (`corepack enable` picks up the
version pinned in `package.json`). This is a Turborepo monorepo, so everything
runs from the repository root.

```bash
# 1. Fork the repo on GitHub, then clone YOUR fork
git clone https://github.com/<your-username>/viliha-drizzle-crud.git
cd viliha-drizzle-crud

# 2. Add the upstream remote (to keep your fork in sync)
git remote add upstream https://github.com/myviliha/viliha-drizzle-crud.git

# 3. Install dependencies
pnpm install

# 4. Run the checks
pnpm lint         # Biome
pnpm typecheck    # tsc --noEmit, the only gate that sees type errors
pnpm build
pnpm test         # library unit tests, plus the api e2e (self-contained)
```

Working on one workspace:

```bash
pnpm --filter nestjs-drizzle-crud test              # unit tests
pnpm --filter nestjs-drizzle-crud test -- -t "soft delete"
pnpm dev                                            # docs site on :3000
pnpm dev:api                                        # example api on :4000
pnpm dev:all                                        # both together
```

The e2e suite needs no setup, and never touches a real database. `pnpm --filter api
test` runs Playwright against the example app, and the app runs against PGlite
(Postgres compiled to WASM) with a seeded fixture, in-process. It exercises the
real SQL the package generates, so a green run does prove the database paths. The
Playwright config pins `DATABASE_URL=pglite` for the server it boots, so your own
`DATABASE_URL` is ignored there; it applies to `pnpm dev:api`, which reads
`apps/api/.env`. If a spec needs different data, extend the fixture in
`apps/api/src/db/pglite.ts` rather than pointing the tests at a server.

## Pull request workflow

External contributors work from a **fork**; you do not need write access.

1. Sync your fork's `main` with upstream: `git fetch upstream && git rebase upstream/main`.
2. Create a branch off `main`:
   - `feat/<short-name>` for features
   - `fix/<short-name>` for bug fixes
   - `docs/<short-name>`, `test/<short-name>`, `chore/<short-name>` as appropriate
3. Make your change **with tests**, and keep `pnpm lint`, `pnpm typecheck`, `pnpm build` and `pnpm test` green.
4. **Update the changelog and the docs in the same change.** See the rule below; a PR that touches behaviour without them is incomplete.
5. Commit using [Conventional Commits](https://www.conventionalcommits.org/):
   - `feat(crud): add pagination to findAll`
   - `fix(module): handle null relations in update`
   - `docs:`, `test:`, `chore:`, `refactor:` and so on
6. Push to your fork and open a pull request against `myviliha/viliha-drizzle-crud:main`.
7. Fill in the PR template. CI (lint, typecheck, build, test) runs automatically and must pass.
8. A maintainer reviews. Address feedback by pushing more commits to the same branch.

> Maintainers may push to `main` directly, but only on a tree whose verify set
> just passed. Contributions from outside the org always land through a PR.

## Changelog and docs are part of the change

Any change to behaviour must, in the same PR:

- add an entry to `packages/nestjs-drizzle-crud/CHANGELOG.md` (Keep a Changelog style) and bump `package.json` per semver when the change ships in the package,
- update every doc surface that describes the thing: the package `README.md`, the consumer agent guide `AGENT.md`, and the matching page under `apps/docs/content/docs/`,
- mirror the changelog entry into `apps/docs/content/docs/(reference)/changelog.mdx`.

Then re-read what you wrote and humanize it: plain language, no filler, and no em
dashes used as punctuation. The full rules, including the SEO and AEO
requirements for docs pages, are in [`AGENTS.md`](./AGENTS.md).

## Coding standards

- TypeScript, strict. Keep the public API typed, and export anything public from `src/index.ts`.
- Run `pnpm format` (Biome) before committing. Tabs, double quotes, 80 columns.
- Add or adjust tests for any behaviour change. Coverage should not regress (`pnpm --filter nestjs-drizzle-crud test:cov`).
- No new runtime dependency. The package ships with peers only.
- Keep changes focused: one logical change per PR.

`AGENTS.md` holds the full architecture notes and the invariants to preserve.
Read it before your first non-trivial change, whether you are a human or an
agent.

## Releasing (maintainers)

The normal path is a tag. `.github/workflows/release.yml` re-runs the verify set
and publishes to npm with provenance:

```bash
pnpm lint && pnpm typecheck && pnpm build && pnpm test   # must be green first
# bump packages/nestjs-drizzle-crud/package.json + CHANGELOG.md, commit, then:
git tag v3.2.2 && git push origin v3.2.2
```

`pnpm release` is the manual fallback. It runs `prepublishOnly` (build plus
tests) and publishes from `packages/nestjs-drizzle-crud`, without provenance.

## Reporting security issues

Please do **not** open a public issue for security vulnerabilities. See [SECURITY.md](./SECURITY.md).

## Code of Conduct

By participating you agree to our [Code of Conduct](./CODE_OF_CONDUCT.md).
