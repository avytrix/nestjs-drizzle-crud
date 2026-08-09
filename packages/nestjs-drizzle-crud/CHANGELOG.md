# Changelog

All notable changes to `nestjs-drizzle-crud` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Scope note: the 3.0.x line is PostgreSQL-first. MySQL-specific paths (non-`RETURNING`
restore, `ER_DUP_ENTRY` mapping, dialect locking) are tracked separately and unchanged here.

## [3.2.2] - 2026-08-09

### Fixed
- **Restored the foreign-key mapping that 3.2.1 lost.** `ForeignKeyViolationException` and
  `EntityInUseException` are exported again, and a Postgres `23503` is translated by direction:
  **400** when `create`/`update` reference a parent row that does not exist (the offending column
  is parsed out of the driver `detail`), **409** when a `delete` is blocked by rows that still
  reference this one. Non-FK errors on the delete path still bubble unchanged. Anyone who upgraded
  from 3.2.0 to 3.2.1 and started seeing 500s on bad references should move to this release.
- Covered by six specs in `test/bug-fixes.spec.ts`, including the wrapped `DrizzleQueryError`
  shape and the missing-`detail` fallback.

## [3.2.1] - 2026-07-17

### Changed
- Packaging and documentation only: `homepage` now points at
  [crud.viliha.com](https://crud.viliha.com), and the package and repository READMEs link the
  docs site, npm and GitHub. No runtime code changed.

### Known issue
- **The foreign-key mapping added in 3.2.0 is missing from this build.** The move to the
  Turborepo monorepo carried over a source tree from before 3.2.0, so `ForeignKeyViolationException`
  and `EntityInUseException` are not exported and a `23503` bubbles as a 500 again. **Fixed in
  3.2.2**, so upgrade rather than pinning here. The 3.1.1 and 3.2.0 entries below were lost in the
  same move and are restored here from the published tarballs.

## [3.2.0] - 2026-07-09

### Added
- **Foreign-key violations (Postgres `23503`) now map to a typed HTTP error instead of a raw 500**,
  and the direction decides the status:
  - `create`/`update` referencing a parent row that does not exist → **400**
    `ForeignKeyViolationException` (a client-supplied reference that points at nothing is bad input).
    The offending column is parsed out of the driver `detail` (e.g. `language_id`).
  - `delete` blocked because other rows still reference this one (`ON DELETE RESTRICT`/`NO ACTION`)
    → **409** `EntityInUseException`.
- Both exceptions are exported from the package root.

### Changed
- `delete` now wraps its statement execution so a `23503` on the delete side is translated (was
  previously left to bubble as a 500). Non-FK errors still bubble unchanged.
- Reverses the prior deliberate choice to let FK violations bubble: a client-supplied FK is a
  recoverable bad value, not a programming error. NOT-NULL violations are still left to bubble.

## [3.1.1] - 2026-07-03

### Changed
- Package metadata only, no code changes: repository and issues URLs now point to
  [myviliha/viliha-drizzle-crud](https://github.com/myviliha/viliha-drizzle-crud), and the
  homepage points to the docs site at [crud.viliha.com](https://crud.viliha.com/).

## [3.1.0] - 2026-06-29

### Added
- **`findAll`/`count` now support `options.search`.** Callers can pass a search term and a list of
  table columns, e.g. `{ search: { term: "na", columns: ["name", "code"] } }`. The default mode is
  cross-column `ILIKE '%term%'`; `mode: "fullText"` compiles a PostgreSQL
  `to_tsvector(...) @@ plainto_tsquery(...)` condition. The search predicate is applied to both the
  data query and the count query, so paginated `total` stays correct.

## [3.0.4] - 2026-06-21

Found while probing the package over real HTTP from the `drizzle-pkg-demo` consumer
(`scripts/probe.sh`). PostgreSQL-first. Verified by 56 jest specs + 56 HTTP e2e assertions.

### Fixed
- **Bad client input on `create`/`update` now maps to 400, not a raw 500.** A value that is too
  long for its column (Postgres `22001`), fails a `CHECK` constraint (`23514`), or is numerically
  out of range (`22003`) previously surfaced as an unhandled `DrizzleQueryError` → 500 Internal
  Server Error. These are now translated to `ValidationFailedException` (400), mirroring the
  existing unique-violation → 409 mapping. NOT-NULL/FK violations are intentionally left to bubble
  (they usually indicate a programming/config error, not a recoverable bad value).

## [3.0.3] - 2026-06-20

Correctness fix found while validating the package from a fresh NestJS consumer
(see `drizzle-pkg-demo`). PostgreSQL-first. Verified by 53 jest specs + 47 HTTP e2e assertions.

### Fixed
- **Case-insensitive string filters are now EXACT, not wildcard patterns.** A plain string
  value in a `findAll`/`count` filter (e.g. `{ name: "foo" }`) is documented as a
  case-insensitive *exact* match, but compiled to `ilike(column, value)`. So a value containing
  `%`, `_` or `\` was silently treated as a `LIKE` pattern and returned non-matching rows
  (e.g. `{ title: "a_b" }` matched `"aXb"`; `{ title: "a%" }` matched everything). It now compiles
  to `lower(column) = lower(value)`, so those characters are treated as literal data. The explicit
  `{ like }` / `{ ilike }` operators are unchanged for intentional pattern matching.

## [3.0.2] - 2026-06-19

Residual-edge hardening found by an end-to-end HTTP probe of 3.0.1 (all LOW severity;
no behavior change to the happy path). Verified by 35 HTTP assertions on Neon + 49 jest specs.

### Changed
- **`fullTextSearch` now returns the same envelope as `findAll`**, `{ data, total, page, limit }`
  instead of `{ data, total }`. `page`/`limit` are the resolved (clamped) values; the query is
  still only constrained when the caller passes `pagination`. Callers paginating search results
  can now read back the page/limit they got.

### Fixed
- **Invalid `sortOrder` now fails fast (400).** `?sortOrder=<anything but asc/desc>` previously
  fell through to ascending silently; it now throws `BadRequestException`, mirroring the
  unknown-`sortBy` check added in 3.0.1.
- **Non-finite numeric filter operands return 400, not 500.** A `{ gt: NaN }` / `{ lte: Infinity }`
  operand on `gt`/`gte`/`lt`/`lte` (e.g. from an unguarded `Number('abc')` in a controller) reached
  SQL and surfaced as an opaque `DatabaseException` (500). It is now rejected as
  `BadRequestException`. Non-number operands (dates, strings) are unaffected.

## [3.0.1] - 2026-06-19

Correctness pass: typed exceptions now map to real HTTP status codes, plus several read-path fixes.
(PostgreSQL-first.)

### Fixed
- **Exceptions extend `HttpException`** so Nest maps them automatically:
  `EntityNotFoundException` → 404, `DuplicateEntityException` → 409,
  `ValidationFailedException` / `BulkOperationException` → 400,
  `Database*` / `TransactionException` → 500. Previously every error surfaced as a generic 500.
- **Duplicate-key translation.** A Postgres unique violation (SQLSTATE `23505`, on either
  `err.code` or the Drizzle-wrapped `err.cause.code`) is converted to `DuplicateEntityException`
  (409), parsing the offending field/value from the driver `detail`.
- **`fullTextSearch` excludes soft-deleted rows** (added the `IS NULL` guard on the soft-delete
  column to both the data and count queries, matching `findAll`/`count`).
- **Pagination clamping.** `page < 1`, `limit <= 0`, and `limit > maxLimit` are clamped via a shared
  `resolvePagination` helper. No more negative `OFFSET` or `LIMIT 0`.
- **Unknown sort column fails fast.** A caller-supplied `sortBy` not on the table throws
  `BadRequestException`; an unknown column in a configured `defaultSort` is warned and skipped.
- **`restore()` returns the restored row** on the Postgres `RETURNING` path (no longer re-`find()`s,
  which would have excluded the just-restored row via the soft-delete filter).

### Added
- **Row-level lock options** on Postgres reads (`find`/`findOne`/`findAll`): `lock: 'update' | 'share'`
  and `forNoKeyUpdate` apply `.for(...)`. No-op on MySQL.

## [3.0.0] - 2026-06-19

- First release under the `nestjs-drizzle-crud` name with the 3.x API surface
  (`DrizzleCrudModule.forRoot`/`forRootAsync`/`forFeature`, `SqlBaseCrudService`).

## Earlier (≤ 2.2.0)

Published as `@quybquang/nestjs-drizzle-crud`. Notable: 2.2.0 added a configurable module-level
default sort; 2.1.2 documented the timestamps feature. See git history for details.

[3.1.0]: https://www.npmjs.com/package/nestjs-drizzle-crud/v/3.1.0
[3.0.4]: https://www.npmjs.com/package/nestjs-drizzle-crud/v/3.0.4
[3.0.3]: https://www.npmjs.com/package/nestjs-drizzle-crud/v/3.0.3
[3.0.2]: https://www.npmjs.com/package/nestjs-drizzle-crud/v/3.0.2
[3.0.1]: https://www.npmjs.com/package/nestjs-drizzle-crud/v/3.0.1
[3.0.0]: https://www.npmjs.com/package/nestjs-drizzle-crud/v/3.0.0
