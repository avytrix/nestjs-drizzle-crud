# Changelog

All notable changes to `nestjs-drizzle-crud` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Scope note: the 3.0.x line is PostgreSQL-first. MySQL-specific paths (non-`RETURNING`
restore, `ER_DUP_ENTRY` mapping, dialect locking) are tracked separately and unchanged here.

## [3.4.0] - 2026-11-02

The P1 features from the November 2026 audit. Every one is covered by specs that run real SQL
against PGlite (`test/pglite.integration.spec.ts`) and by e2e specs over real HTTP in the example
app.

### Added

- **A query string parser.** `service.parseQuery(query)` and the standalone `parseCrudQuery(query,
  table, options)` turn
  `?age[gte]=18&status=active&region[name]=Asia&or[0][code]=IN&sortBy=-name&page=2&limit=20&fields=id,name&with=region&search=jo`
  into `{ filters, pagination, options, isCursor }`. Values are coerced by Drizzle column type:
  integers and other numbers to `number`, `bigint` to `bigint`, booleans, dates to `Date` (an
  invalid one is a 400), `numeric` checked and kept as an exact string, and text, uuid and enum left
  as strings. An unknown column, relation, operator, sort column, `fields` entry or `with` path is a
  400. It reads both Express 5's flat `age[gte]` keys and `qs` nested objects.
- **Per-entity allowlists.** `filterableColumns`, `sortableColumns`, `selectableColumns`,
  `searchableColumns` and `loadableRelations` limit what a caller may filter, sort, select, search
  and eager-load; `writableColumns` limits what create, update and upsert may write. Anything
  outside a set list is a 400, in the service and in the parser. Unset lists allow everything.
  `skipAllowlists: true` skips them for a trusted call, and `findOne` where keys are not checked.
- **Trash view and purge.** `withDeleted: true` and `onlyDeleted: true` work on every read (`find`,
  `findOne`, `findAll`, `findByCursor`, `count`, `exists`, `fullTextSearch`). `forceDelete(id)` and
  `massForceDelete(ids)` hard-delete rows whether they are soft-deleted or not.
- **Upsert.** `upsert(dto, { conflictTarget, update })` and `massUpsert(rows, ...)` insert or update
  in one statement: `ON CONFLICT DO UPDATE` on Postgres, `ON DUPLICATE KEY UPDATE` on MySQL. A clash
  on another unique key is a 409, bad input a 400, and the same key twice in one `massUpsert`
  (`21000`) a 400.
- **`and`, `or` and `not` filter groups.** `{ or: [{ status: 'a' }, { author: { name: 'Bob' } }],
  not: { tags: { name: 'x' } } }`. Groups nest, hold column, relation and collection filters, work
  inside a relation filter, and apply to `count`.
- **New filter operators.** `notIn`, `between`, `startsWith`, `endsWith` and `contains` (escaped,
  case-insensitive unless `sql.caseSensitive` is on), `iStartsWith`, `iEndsWith` and `iContains`
  (always case-insensitive), and on PostgreSQL `arrayContains`, `arrayOverlaps` and `jsonContains`.
  A pattern operator on a non-text column, an array operator on a non-array column, or a PostgreSQL
  only operator on MySQL is a 400.
- **Keyset pagination.** `findByCursor(filters, { cursor, limit, sortBy, count }, options)` returns
  `{ data, limit, nextCursor, total? }`. The cursor is base64url JSON of the last row's sort values
  plus the primary key, so pages stay stable under inserts and deep pages cost the same as the
  first. It works with every sort, filter, relation and `select`, keeps timestamp microseconds and
  follows the database's NULL ordering. The count only runs with `count: true`. A cursor that is not
  valid, or was made for another sort, is a 400.
- **Multi-column and relation sorts from the caller.** `sortBy` takes a list: `['region.name',
  '-name']` or `[{ column, order }]`, and a comma separated string means the same. A dotted entry
  sorts by a top-level belongs-to column, joined for the data query only. A collection column is a
  400.
- **`bulkMode: 'perItem'`** keeps the 3.3 behaviour of one single-row call per item, in its own
  savepoint.
- **New exports:** `parseCrudQuery`, and the types `CrudFilter`, `FilterGroup`, `FilterOperators`,
  `FilterOperator`, `FilterScalar`, `ColumnFilter`, `SortInput`, `CursorPaginationOptions`,
  `CursorPage`, `CrudAllowlists`, `UpsertOptions`, `BulkMode`, `ParseCrudQueryOptions` and
  `ParsedCrudQuery`. The Drizzle helpers `between`, `not` and `notInArray` are re-exported.

### Changed

These change behaviour that existing code may rely on. Check each one before upgrading.

- **Mass writes are set-based.** `massUpdate`, `massSoftDelete`, `massRestore` and `massDelete` cost
  one `SELECT` that checks every id plus one `UPDATE` or `DELETE ... WHERE id IN (...)`, and
  `massCreate` one multi-row `INSERT`, instead of one or two queries per id. The
  `BulkOperationException` body is unchanged: when the statement fails, the batch is replayed item
  by item inside a savepoint that is rolled back, only to name the failing items. Hooks still run
  once per item, but the `after*` hooks now run once the whole set is written instead of after each
  item. Duplicate ids are written once. Pass `bulkMode: 'perItem'` for the old behaviour.
- **Create and update ignore the columns the package manages.** Without `writableColumns`, the soft
  delete column is dropped from a create or update body, and the primary key and the `createdAt`
  column from an update body. An update whose only key was one of these is now a 400 ("there are no
  columns to update"). To write them on purpose, list them in `writableColumns`.
- **`PaginationOptions.sortBy` is `SortInput`** (`string | Array<string | SortColumn>`). Code that
  passes a string is unaffected; code that reads `sortBy` back as a `string` needs a narrowing
  check.
- **`between` is an operator now.** `{ col: { between: [a, b] } }` used to be a 400 ("Unknown filter
  operator").
- `buildOrderBy` takes a `SortInput`, and `buildFilterConditions` and `buildCollectionFilter` take
  an optional `options` argument, for subclasses that call them.

### Fixed

- **Mass operations cost a fixed number of queries** (BUG-16). `massUpdate` over 10 ids was 20
  queries; it is now 2.
- **The soft delete guide's trash and purge recipes work** (BUG-17). They used raw Drizzle because
  `findAll({ deleted_at: { isNotNull: true } })` always returned nothing; the guide now uses
  `onlyDeleted` and `forceDelete`.

## [3.3.1] - 2026-11-02

Fixes from the November 2026 audit. Every fix below is proven by a spec that runs real SQL against
PGlite (`test/pglite.integration.spec.ts`) and failed before the change.

### Fixed
- **String filters on integer, uuid and enum columns no longer return a 500.** Query strings send
  every value as text, and with the default `caseSensitive: false` a filter such as
  `{ author_id: '1' }` became `lower(author_id)`, which Postgres rejects. `lower()` now only wraps
  text, varchar and char columns; every other column compares with `=` and Postgres casts the value.
  Relation and collection filters get the same fix.
- **Date strings work on date and timestamp columns.** `{ publishedAt: { gt: '2024-01-01' } }` used
  to crash inside the driver (`value.toISOString is not a function`). The string is now turned into
  a `Date`; a value that is not a date is a 400.
- **A soft-deleted belongs-to parent is no longer returned.** The `LEFT JOIN` for an eager load or a
  relation filter now carries `deleted_at IS NULL` in its `ON` clause, so the parent comes back as
  `null` and `{ author: { name: 'Bob' } }` does not match a deleted author.
- **`findOne` can no longer hand back an arbitrary row.** `findOne({ email: undefined })` used to run
  `LIMIT 1` with no condition and return the first row in the table. It is now a 400, as is a key
  that is not a column. `null` now means `IS NULL` instead of being skipped. An operator object works
  as it does in `findAll`.
- **A soft-delete or timestamp column the table does not have is caught at startup.** With
  camelCase keys (`deletedAt: timestamp('deleted_at')`) the default config used to break every read
  with a SQL syntax error, and `updatedAt` silently never moved. The service now throws when it is
  built, naming the key to use: `softDelete.column is "deleted_at", but the table has no column
  under that key. The column "deleted_at" is declared under the key "deletedAt"; set
  softDelete.column to "deletedAt".`
- **One bad item in a bulk call no longer fails every item after it.** Each item now runs in its own
  savepoint, so `massCreate([ok, duplicate, ok, ok])` reports the duplicate alone instead of two more
  `25P02` "current transaction is aborted" errors. The whole call still rolls back. The items still
  run one query (or two) at a time; set-based bulk writes are planned separately.
- **Bulk errors reach the HTTP response.** `BulkOperationException` now answers with
  `{ statusCode, error, message, errors: [{ index | id, status, message }] }`, one entry per failed
  item with the status that item alone would have produced. An error that is not an HTTP exception
  shows as `status: 500` with a generic message, so SQL never leaks.
- **`{ isNull: false }` means `IS NOT NULL`.** The value used to be ignored. `isNull` and `isNotNull`
  also accept the strings `"true"` and `"false"`; anything else is a 400.
- **Filters the package does not understand are rejected instead of dropped.** A new `eq` operator
  is supported, a `Date` value is an equality match instead of an empty operator object, and an
  unknown column, relation column or operator is a 400. Each of these used to return every row.
- **Bad input is a 400 on reads too.** Postgres `22P02` (wrong type, unknown enum label), `22007` and
  `22008` (bad dates) now map to `ValidationFailedException` on every path, including `find`,
  `findAll`, `count` and `fullTextSearch`. `fullTextSearch` checks its column names (an unknown one
  used to be a SQL syntax error), and `update` with nothing to set is a 400 instead of a raw
  "No values to set".
- **`fullTextSearch` always paginates.** Without a pagination argument it returned every match while
  the envelope said `limit: 20`. The resolved page and limit now always apply, and the data and count
  queries run together.
- **A partial pagination override keeps the other half.** `pagination: { defaultLimit: 5 }` used to
  replace the whole object, leaving `maxLimit` undefined and the query with no limit at all.
  `softDelete`, `timestamps`, `pagination` and `sql` now merge one level deep at every config layer:
  `forRoot` defaults, `@CrudService`, `forFeature` and the service constructor.
- **Search and the `ilike` operator emit `LIKE` on MySQL**, which has no `ILIKE`. MySQL's default
  collations already compare case-insensitively.
- **Pages are stable.** The primary key is now always the last `ORDER BY` column, so rows that tie on
  the sort columns, or a list with no sort at all, can no longer repeat or skip between pages.
- **A row lock works with an eager belongs-to.** Locks are now `FOR UPDATE OF <base table>` (and the
  same for `share` and `no key update`). Postgres used to refuse with `FOR UPDATE cannot be applied
  to the nullable side of an outer join`.
- **Nested collections key on their own table.** A nested has-many or many-to-many used the root
  service's `primaryKey` as its default `parentKey`, so a root keyed on `uid` loaded
  `author.posts` as `[]`. A nested level now defaults to its host table's own primary key column.
- **Types in public signatures are exported.** `PaginationOptions`, `OperationOptions`,
  `SqlSearchOptions`, `SqlSearchMode` and `BulkOperationResult` come from the package root, along
  with the new `CrudFeatureConfig` and `BulkOperationItemError`.
- `CrudFeature.config` is typed as `CrudFeatureConfig` instead of `Record<string, any>`, so a typo in
  a key no longer compiles.

### Changed
These fixes change behaviour that existing code may rely on. Check each one before upgrading.
- **An unknown filter key is a 400.** `findAll` and `count` used to drop keys that were not columns,
  so passing a whole query DTO through worked even with `page` or `sortBy` in it. Strip non-filter
  fields first. The same goes for an unknown column inside a relation or collection filter, and for
  an unknown operator. `null` and `undefined` values are still skipped.
- **`findOne` with no usable condition, or an unknown key, is a 400.** It used to return the first
  row in the table.
- **`findOne({ col: null })` matches `IS NULL`.** It used to skip the key.
- **A configured soft-delete or timestamp key the table lacks stops the app at startup.** This
  includes the project defaults: with `defaults.timestamps` on (the default), every table needs
  `created_at` and `updated_at` keys, or the entity must set its own keys or turn timestamps off
  with `timestamps: undefined`. Before, a missing timestamp key was silently ignored.
- **Every `findAll` and `fullTextSearch` ends with `ORDER BY <primary key> ASC`.** A list with no
  sort configured used to come back in whatever order Postgres chose; it now comes back by primary
  key.
- **`update(id, {})` is a 400**, also when timestamps are on. It used to bump `updated_at` alone.
- **`{ isNull: false }` returns the non-null rows** instead of the null ones.
- **`BulkOperationException` has a different response body.** `message` is unchanged; `errors` is
  new. The `errors` property on the exception still holds the original errors.
- **Read errors from bad input are 400s.** `find('abc')` on an integer key used to be a 500.
- Row locks now carry `OF <table>`. A subclass that relied on locking joined rows must take that
  lock itself.

### Deprecated
- `sql.jsonSupport`, `sql.enableFullTextSearch`, `hooks.enableGlobalHooks` and `primaryKeyType`.
  Nothing reads them, so they have no effect. They are still accepted and will be removed in the
  next major version. `primaryKeyType` is now optional. The docs no longer claim that `jsonSupport`
  enables JSON handling or that `enableFullTextSearch` gates `fullTextSearch()`.
- `DatabaseConnectionException` and `TransactionException`. Nothing in the package throws them.

## [3.3.0] - 2026-08-10

### Added
- **Has-many, many-to-many and nested relations, all eager loaded without N+1.** Declare
  `relations: { states: { table: states, type: 'hasMany', foreignKey: 'country_id' } }` and pass
  `options.relations: ['states']` to `find`, `findOne` or `findAll`. Each has-many relation costs
  exactly one extra query for the whole result set (`WHERE country_id IN (...)`), no matter how many
  parent rows come back, and the relations run concurrently. A page of 50 countries with their
  states is 3 queries: data, count, children. A parent with no children gets `[]`, never `undefined`.
- **Many-to-many through a join table.** Declare
  `{ table: tags, type: 'manyToMany', through: countryTags, throughLocalKey: 'country_id', throughForeignKey: 'tag_id' }`
  and the collection loads in one batched query per relation
  (`SELECT ... FROM country_tags JOIN tags ... WHERE country_id IN (...)`). The join-table key is
  used to group the rows and stripped before they are returned.
- **Nested relations, any depth, with a dotted path.** Put a `relations` map on a relation and
  address it with `options.relations: ['states', 'states.cities']` or `['state.country']`. Each
  nesting level costs one more batched query for the whole level, so a page of 50 countries with
  their states and every state's cities is 4 queries. Asking only for `state.country` pulls in
  `state` automatically.
- **`orderBy` on a collection relation.** `{ type: 'hasMany', foreignKey: 'country_id', orderBy: [{ column: 'name', order: 'asc' }] }`
  orders the children in SQL. An unknown column is warned about and skipped, as with `defaultSort`.
- **Collections are never joined.** Filtering by a child column
  (`findAll({ states: { name: 'Kerala' } })`, `findAll({ tags: { name: 'himalayan' } })`) compiles to
  `countries.id IN (SELECT ... WHERE ...)`, so parent rows are never duplicated and `total` and
  pagination stay correct. Belongs-to relations keep using a `LEFT JOIN`.
- **`options.select` now narrows relation columns with a dotted path, at any depth.**
  `select: ['id', 'name', 'region.code', 'states.cities.name']` projects only those columns, for the
  base table, a joined belongs-to relation and a batched collection alike. Listing only relation
  columns leaves the parent row complete. The parent key, the child foreign key and any key a nested
  level needs are added back automatically, because the grouping needs them.
- **An MCP server ships with the package.** `npx nestjs-drizzle-crud-mcp` serves the package docs
  (`AGENT.md`, `README.md`, `CHANGELOG.md`) to any MCP client through three tools: `list_docs`,
  `get_doc` and `search_docs`. It speaks JSON-RPC over stdio, still has zero dependencies, and works
  with Claude Code, Codex, Cursor, Copilot, Gemini CLI, Windsurf, Zed and Cline.
- **`AGENTS.template.md`** for every agent that is not Claude Code. It carries the same pointer to
  `AGENT.md` and lists the filename each tool reads. `CLAUDE.template.md` is unchanged.
- Exported the `RelationType` (`'belongsTo' | 'hasMany' | 'manyToMany'`), `RelationNode` and
  `SelectTree` types.

### Changed
- A relation with a missing key column now throws at startup: belongs-to requires `localKey`,
  has-many requires `foreignKey`, many-to-many requires `through`, `throughLocalKey` and
  `throughForeignKey`. Nested relations are validated too, and the message carries the full path
  (`Relation "states.cities" is belongsTo and requires a localKey`). It used to load nothing quietly,
  which read as bad data rather than bad config.
- `RelationConfig.localKey` is optional, since has-many relations use `foreignKey` instead. Existing
  belongs-to configs are unaffected.

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
