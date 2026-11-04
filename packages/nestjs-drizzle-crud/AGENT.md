# Using nestjs-drizzle-crud in your project (AI agent guide)

> **Audience:** developers (and their AI agents) **consuming** `nestjs-drizzle-crud`
> in a downstream NestJS app. This file ships with the npm package. To auto-load
> these rules, copy the ready-made pointer to your project root; it `@`-imports
> this file, so you never duplicate the rules:
>
> ```bash
> cp node_modules/nestjs-drizzle-crud/AGENTS.template.md ./AGENTS.md   # Codex, Cursor, Copilot, Zed, Cline, Windsurf
> cp node_modules/nestjs-drizzle-crud/CLAUDE.template.md ./CLAUDE.md   # Claude Code
> # Gemini CLI reads ./GEMINI.md, Aider reads ./CONVENTIONS.md
> ```
>
> Or let the agent read these docs on demand: `npx -p @avytrix/nestjs-drizzle-crud nestjs-drizzle-crud-mcp` is an
> MCP server shipped with the package. See
> [crud.avytrix.dev/docs/ai-agents](https://crud.avytrix.dev/docs/ai-agents).
>
> To *contribute to* the package itself, see
> [CONTRIBUTING.md](https://github.com/avytrix/nestjs-drizzle-crud/blob/main/CONTRIBUTING.md)
> and [AGENTS.md](https://github.com/avytrix/nestjs-drizzle-crud/blob/main/AGENTS.md).
> Full docs: [crud.avytrix.dev](https://crud.avytrix.dev).

You are a backend engineer building NestJS APIs on Drizzle ORM. Your job is to
ship endpoints that are type safe, consistent and production ready by leaning on
this package instead of hand writing repository code. Do not rebuild what the
base service already does.

---

# Core Principles

Order your decisions by these priorities:

1. Configure over code.
2. Reuse the base service over rebuilding a repository.
3. Push behaviour into config, then into hooks, and only then into an override.
4. Simplicity over abstraction.
5. Correct SQL over convenient SQL.
6. Predictable HTTP status codes.
7. Tests that run without a database, plus one that runs with one.

---

# Think Before You Build

Before writing a query, check whether the base service already covers it:
filters (with or / not groups), comparison and pattern operators, query string
parsing, allowlists, offset and cursor pagination, multi-column and relation
sorts, eager loading, relation filters, soft delete with a trash view and purge,
timestamps, set-based bulk writes, upsert, transactions, row locks and full text
search all ship. If you are writing `db.select()` inside a
service, stop and check the API reference first.

---

# Installation

```bash
pnpm add @avytrix/nestjs-drizzle-crud
pnpm add @nestjs/common @nestjs/core drizzle-orm reflect-metadata   # peers, always
pnpm add postgres                                                   # PostgreSQL
pnpm add mysql2                                                     # MySQL
pnpm add @libsql/client                                             # SQLite / libSQL
```

`postgres` and `mysql2` are optional peers. You only need them when you let the
module build the connection from a `connectionString` (PostgreSQL or MySQL;
`connection: { poolSize, idleTimeout, ssl }` tunes it). If you pass your own
`db`, no driver peer is required. SQLite (`dialect: 'sqlite'`, also libSQL and
Cloudflare D1) always takes your own `db`. On D1 and synchronous SQLite drivers
the mass writes, nested creates and attach / detach / sync throw a
`TransactionException`; use libSQL when you need them.

Requires Node >= 20 and `emitDecoratorMetadata` / `experimentalDecorators` in
`tsconfig.json`, which the Nest CLI already sets.

---

# Setup is two steps

**1. Configure the connection once**, in `AppModule`:

```typescript
DrizzleCrudModule.forRootAsync({
  useFactory: () => ({
    dialect: 'postgresql' as const,
    connectionString: process.env.DATABASE_URL!,
    schema,
    defaults: { softDelete: false, timestamps: true },
  }),
});
```

Use `forRoot` for a static config and `forRootAsync` when the value comes from
`ConfigService` or the environment (`useFactory`, or `useClass` / `useExisting`
with a class that implements `DrizzleCrudOptionsFactory`). Provide exactly one of `connectionString`
or `db`. The module is global, so feature modules do not import it again for
the connection.

**2. Bind each entity in its feature module:**

```typescript
DrizzleCrudModule.forFeature([
  { service: TagsService, table: tags },
]);
```

The table is declared here, not in the service.

---

# A service is an empty subclass

```typescript
export class CountriesService extends SqlBaseCrudService<
  Country,
  CreateCountryDto,
  UpdateCountryDto,
  QueryCountryDto
> {}
```

Generic order is `<Entity, CreateDto, UpdateDto, FilterDto>`. Derive `Entity`
from the schema with `typeof table.$inferSelect`.

**Do not:**

- add `@Injectable()`; `forFeature` constructs the service with a factory,
- inject `DRIZZLE_DB` or write a constructor that calls `super({ ... })`,
- pass `dialect`, `db` or `table` from inside the service.

Those are legacy manual patterns and they break registration.

---

# API surface

| Group | Methods |
| --- | --- |
| Read | `find(id)`, `findOne(where)`, `findAll(filters, pagination, options)`, `findByCursor(filters, cursorPagination, options)`, `exists(id)`, `count(filters)`, `countBy(column, filters)` |
| Write | `create(dto)`, `update(id, dto)`, `upsert(dto, { conflictTarget, update })`, `softDelete(id)`, `restore(id)`, `delete(id)`, `forceDelete(id)` |
| Many-to-many links | `attach(id, relation, ids)`, `detach(id, relation, ids?)`, `sync(id, relation, ids)` |
| Controller | `createCrudController(Service, options)`, `service.parseId(raw)` |
| OpenAPI | `@ApiCrudList(source)`, `@ApiCrudQuery(source)` (needs `@nestjs/swagger`) |
| Bulk | `massCreate`, `massUpdate`, `massUpsert`, `massSoftDelete`, `massRestore`, `massDelete`, `massForceDelete` |
| Query string | `parseQuery(query, options)`, or the standalone `parseCrudQuery(query, table, options)` |
| Search | `fullTextSearch(term, columns, pagination, { filters, relations, select, language, queryMode })`, PostgreSQL only |
| Transaction | `executeSqlTransaction(cb)` |

`findAll` returns `{ data, total, page, limit }`, not a bare array; with
`withCount: false` it skips the count, `total` is `null` and `hasMore` is set.
`delete` and `softDelete` return a boolean. `update` and `restore` return the entity and
throw `EntityNotFoundException` when the row is missing.

Every method takes `options`: `{ transaction, relations, select, search, hooks, lock, forNoKeyUpdate, withDeleted, onlyDeleted, skipAllowlists, bulkMode, counts, context, skipScope, skipEvents, expectedVersion, expectedVersions }`.

**Do not hand write CRUD controllers.** Extend `createCrudController(Service, {
dto, routes, decorators })`. It registers list (offset and `?cursor=`), trash,
get, create, update, delete, soft delete, restore and, when enabled, the bulk
routes, all through `parseQuery`, and parses `:id` by the primary key type
(ParseIntPipe, ParseUUIDPipe). Add guards with `decorators` or per route, turn
routes off with `routes: { delete: false }`, and add your own routes to the
subclass.

---

# Filtering

`findAll(filters)` and `count(filters)` take an object keyed by column name.
`null` and `undefined` values are skipped. A key that is not a column or a
configured relation is a 400, so pull `page`, `limit`, `sortBy` and other
non-filter fields out of the query DTO before passing the rest through.

```typescript
await service.findAll({
  status: 'active',           // exact match, case-insensitive on text columns
  author_id: '1',             // a query string value is fine on an integer column
  role: ['admin', 'editor'],  // IN (...)
  age: { gte: 18, lt: 65 },
  created_at: { gte: '2025-01-01' }, // parsed to a Date; an invalid date is a 400
  name: { ilike: 'jo%' },     // you supply the wildcards
  archived_at: { isNull: false },    // IS NOT NULL
});
```

Operators inside an object value: `eq`, `gt`, `gte`, `lt`, `lte`, `neq`, `like`,
`ilike`, `in`, `notIn`, `between` (`[from, to]`), `isNull`, `isNotNull`,
`startsWith`, `endsWith`, `contains` (escaped, case-insensitive unless
`sql.caseSensitive`), `iStartsWith`, `iEndsWith`, `iContains` (always
case-insensitive), and on PostgreSQL only `arrayContains`, `arrayOverlaps` and
`jsonContains`. Any other operator is a 400. A bare string is an exact match,
not a pattern, and `%` in it is a literal character. On a text column it is
`lower(col) = lower($1)` in `findAll` and `count` (index `lower(col)`), but a
plain, case-sensitive `=` in `findOne`. https://crud.avytrix.dev/docs/indexes/
lists the index each query shape needs; the package creates none. `isNull` and `isNotNull`
take `true` / `false` or the strings `"true"` / `"false"`.

OR and NOT need no raw Drizzle. `and`, `or` and `not` group filter objects, nest,
and can hold relation and collection filters:

```typescript
await posts.findAll({
  status: 'published',
  or: [{ author: { name: 'Ann' } }, { views: { gte: 1000 } }],
  not: { tags: { name: 'internal' } },
});
```

`findOne(where)` throws a 400 when no condition is left (every value
`undefined`) or a key is not a column, and `null` means `IS NULL`. Never feed it
an optional field without checking it first.

**Never build a filter form or a where clause by hand in a controller.** Hand
the query string to `parseQuery`, which coerces values by column type and
rejects unknown keys with a 400, and let the service compile the SQL:

```typescript
@Get()
findAll(@Query() query: Record<string, unknown>) {
  const q = this.users.parseQuery(query);
  return q.isCursor
    ? this.users.findByCursor(q.filters, q.pagination, q.options)
    : this.users.findAll(q.filters, q.pagination, q.options);
}
```

Type the service's `FilterDto` generic as `CrudFilter` so the parsed filters fit.
The query string grammar: `col=v`, `col[op]=v`, `col[in]=a,b`,
`relation[col]=v`, `or[0][col]=v`, `not[col]=v`, `sortBy=-a,relation.b`,
`page`, `limit`, `fields=a,relation.b`, `with=relation`, `search`, `cursor`.
`withDeleted` / `onlyDeleted` only with `parseQuery(query, { allowTrash: true })`.

---

# Allowlists: set them on every entity a client can reach

```typescript
config: {
  filterableColumns: ['status', 'team.name'],
  sortableColumns: ['name', 'created_at'],
  selectableColumns: ['id', 'name', 'email', 'team.name'],
  searchableColumns: ['name', 'email'],
  loadableRelations: ['team'],
  writableColumns: ['name', 'email', 'role'],
}
```

Unset lists allow everything. Anything outside a set list is a 400, in the
service and in `parseQuery`. `findOne(where)` keys are not checked (server-side
lookups); pass `skipAllowlists: true` for any other trusted call. Without
`writableColumns`, create and update ignore the soft delete column, and update
ignores the primary key and `createdAt`.

---

# Sorting and cursor pagination

`sortBy` takes one column (with `sortOrder`, default `'asc'`) or a list:
`['team.name', '-created_at']` or `[{ column, order }]`. A dotted entry sorts by a
top-level belongs-to column. The primary key is always the last sort column.

For infinite scroll, exports and deep pages use `findByCursor(filters,
{ cursor, limit, sortBy, count })`. It returns `{ data, limit, nextCursor,
total? }`; pass `nextCursor` back as `cursor`. Do not hand-roll `id > lastId`
pagination.

---

# Relations

Four shapes, all declared per entity in `forFeature`:

```typescript
config: {
  relations: {
    // belongs to: countries.region_id -> regions.id
    region: { table: regions, localKey: 'region_id' },
    // has many: states.country_id -> countries.id
    states: {
      table: states,
      type: 'hasMany',
      foreignKey: 'country_id',
      orderBy: [{ column: 'name', order: 'asc' }],
      // nested: load with relations: ['states', 'states.cities']
      relations: {
        cities: { table: cities, type: 'hasMany', foreignKey: 'state_id' },
      },
    },
    // many to many: countries.id <- country_tags -> tags.id
    tags: {
      table: tags,
      type: 'manyToMany',
      through: countryTags,
      throughLocalKey: 'country_id',
      throughForeignKey: 'tag_id',
    },
  },
}
```

Eager load with `options.relations: ['region', 'states', 'states.cities', 'tags']`.
A belongs to relation is joined into the main query and nests an object (`null`
when unmatched). Every collection, and every nested level whatever its shape,
runs **one extra batched query for the whole result set** and nests an array
(`[]` when empty). A dotted path pulls in its parent path automatically.

**Never load a collection in a loop.** A page of 50 countries with their states
and every state's cities is 4 queries: data, count, states, cities. Fetching them
per row is hundreds. If you catch yourself writing
`for (const row of rows) await ...`, the relation you want is already in this
config; declare it and pass it in `options.relations`.

Filter with `findAll({ region: { name: 'Asia' } })`,
`findAll({ states: { name: 'Kerala' } })` or
`findAll({ tags: { name: 'himalayan' } })` using the same operators. A collection
filter compiles to `id IN (SELECT ... WHERE ...)`, never a join, so `total` and
pagination stay correct. A filter can go through relations at any depth:
`{ state: { country: { code: 'IN' } } }` (`?state[country][code]=IN`). A
collection takes `some` (the default), `none` or `every`:
`{ posts: { none: { status: 'draft' } } }`. They compile to `EXISTS` /
`NOT EXISTS` subqueries; never post-filter rows in JavaScript instead.

**Counts.** Ask for `options.counts: ['posts']` to get `_count: { posts: n }`
on each row, one grouped query per relation, and `countBy('status', filters)`
for facet counts. Never call `count()` once per row.

**Relations on writes.** Pass `options.relations` to `create`, `update`,
`upsert` and the mass writes to get the related rows back. Nested create
(`authors.create({ name, posts: [...] })`) only writes relations listed in
`writableRelations`, inside one transaction. Change many-to-many links with
`attach` / `detach` / `sync`, never with raw inserts into the join table.

A relation missing its keys throws at startup, with the full path in the message.
For a join table that carries its own columns, model it as an entity with two
belongs to relations.

---

# Only select the columns you need

`options.select` narrows the projection, and a dotted entry narrows a relation:

```typescript
await countries.findAll({}, { page: 1, limit: 20 }, {
  relations: ['region', 'states', 'states.cities'],
  select: ['id', 'name', 'region.code', 'states.name', 'states.cities.name'],
});
// { id, name, region: { code }, states: [{ name, country_id, id, cities: [{ name, state_id }] }] }
```

Use it on list endpoints and hot paths rather than hydrating every column. A
dotted entry only applies when the relation is also eager loaded, paths can be
any depth, unknown names are ignored, and a list of only dotted entries leaves
the base row complete. The keys needed to group a collection come back whether
you asked for them or not.

---

# Keys, soft delete and timestamps

- **Primary keys:** `primaryKey` (default `id`) per entity. The type comes from
  the column; `primaryKeyType` is deprecated and does nothing. With uuid keys
  route params are strings, so do not apply `ParseIntPipe`. The primary key is
  always the last `ORDER BY` column, so pages are stable.
- **Soft delete:** enable per project (`defaults.softDelete`) or per entity.
  Reads then exclude deleted rows automatically, including a soft-deleted
  belongs-to parent. `softDelete.column` and the `timestamps` keys name the key
  in the Drizzle table object (`deletedAt` for a camelCase schema). A key the
  table does not have stops the app at startup. For a trash view pass
  `onlyDeleted: true` (or `withDeleted: true`) in the options of any read; to
  purge, call `forceDelete(id)` or `massForceDelete(ids)`. `delete(id)` answers
  404 for a row that is already in the trash. Never query `deleted_at` by hand.
- **Timestamps:** prefer schema managed (`defaultNow()` plus `$onUpdate()`) so
  every write path is stamped by the database. The package managed option uses
  the application clock and only covers writes that go through the package.

---

# Multi-tenancy: use `scope`, never hand written tenant filters

For data owned by a tenant or a user, set `scope` in the entity config and put
the tenant in the context once per request:

```typescript
config: { scope: (ctx) => ({ tenant_id: ctx.tenantId }) }

// in a NestModule
consumer
  .apply(CrudContext.middleware((req) => ({ tenantId: req.user?.tenantId })))
  .forRoutes('*');
```

The scope is ANDed into every read, count and write (bulk, upsert, soft delete,
restore, force delete, attach included) and written onto every created row, so
another tenant's id is a 404. A missing context value is a 403, never an
unscoped query. A belongs-to key a write sets must point at a row of the
caller's tenant when the related table has the scope columns; another tenant's
row is the same 400 as a missing one. Nested create children get the same check
for the keys their nested relation declares in its own `relations`; declare
every belongs-to a child can set. Do not add `tenant_id` to filters or DTOs
by hand, and use `skipScope: true` only in trusted server code.

# Optimistic locking

Set `versionColumn: 'version'` when two people can edit the same row. Clients
send back the `version` they read; a stale one is a 409
(`StaleVersionException`). Pass `expectedVersion` in code, or
`expectedVersions: { [id]: version }` for mass writes.

# Hooks, events and validation

Override the `protected` hooks on your service rather than wrapping the service
in another layer: `validateCreate`, `validateUpdate`, `mapCreateDtoToEntity`,
`mapUpdateDtoToEntity`, and the `before*` / `after*` pairs for create, update,
delete, soft delete and restore. Defaults are no ops and pass throughs, so
override only what you need.

For cross-cutting work (audit trails, cache busting, outbox rows) turn on
`hooks.enableGlobalHooks` in `forRoot` and subscribe on the injected
`CrudEventBus` instead of copying hooks into every service. A bulk call raises
one event with every id; write audit rows with `event.transaction` so they
commit or roll back with the write.

Validation of request shape stays in DTOs with `class-validator`. Use
`validateCreate` for rules that need the database.

---

# Errors

The package throws NestJS exceptions, so the default filter maps them without
extra wiring: `EntityNotFoundException` gives 404, `DuplicateEntityException`
and `EntityInUseException` give 409, and `ValidationFailedException`,
`ForeignKeyViolationException` and `BulkOperationException` give 400,
`StaleVersionException` gives 409 and `MissingScopeException` gives 403. Do not
catch these to re-throw a generic 500, and do not add a custom filter to
translate them again.

Driver error codes are translated at the service boundary, so bad client input
never reaches the caller as a 500: a unique violation is a 409, a value that is
too long, fails a check, has the wrong type or is not a valid date is a 400 (on
reads too), a foreign key pointing at a row that does not exist is a 400, and a
delete blocked by dependent rows is a 409. The same holds on MySQL (strict mode
errors included) and SQLite (constraint errors, and the `STRICT` and
`SQLITE_MISMATCH` type errors).

---

# Transactions and bulk writes

```typescript
await service.executeSqlTransaction(async (tx) => {
  const user = await service.create(dto, { transaction: tx });
  await profiles.create({ userId: user.id }, { transaction: tx });
});
```

Pass `{ transaction: tx }` to enlist any method. All bulk methods already run in
a single transaction and roll back as a unit. Each is one statement for the
whole set (plus one `SELECT` that checks the ids), so never loop `create` or
`update` over an array yourself. The 400 from `BulkOperationException` lists
only the failed items: `errors: [{ index | id, status, message }]`.
`bulkMode: 'perItem'` runs one single-row call per item when a hook needs it.
One statement may bind at most 65,535 values on PostgreSQL and MySQL, 32,766 on
SQLite and 100 on Cloudflare D1; past that the call is a 400 before it runs, so
split very large batches into chunks.

To insert or update by a unique key, use
`upsert(dto, { conflictTarget: 'email' })` or `massUpsert(rows, ...)` rather
than a find followed by a create.

Take a row lock with `options.lock: 'update' | 'share'` only inside a
transaction, and prefer `forNoKeyUpdate` when the key is not changing. On
PostgreSQL the lock covers the service's own table only (`FOR UPDATE OF
<table>`), so it works with an eager belongs-to. MySQL gets `FOR UPDATE` or
`FOR SHARE`; on SQLite a lock is a 400.

---

# Testing

```typescript
const mockDb = TestCrudFactory.createMockDb();
const mockTable = TestCrudFactory.createMockTable();
const service = TestCrudFactory.createTestService(UsersService, mockDb, mockTable);
```

`TestCrudFactory` covers unit tests without a database. Back anything that has
to be true over the wire with one e2e test that boots the app and hits the route
against a real database.

---

# AI Development Rules

Before writing code, check the API reference for a method or option that already
does it. Extend behaviour through config, then hooks, then an override, in that
order. Never duplicate query logic across services, and never reach into
`config.db` from a controller.

**Do not fetch a whole table to filter it in JavaScript.** Filtering, sorting,
pagination and counting are the service's job, and doing them in the controller
loads every row into memory. The same rule applies to "export all": ask the
database with the query, not the client with the page.

---

# Definition of Done

A feature is complete only when:

✓ Uses the base service rather than hand written queries.

✓ Declares the table in `forFeature`, not in the service.

✓ Types the entity from the Drizzle schema (`$inferSelect`).

✓ Validates input with DTOs, and with hooks when the rule needs the database.

✓ Returns the right HTTP status through the package's exceptions.

✓ Handles pagination and filtering through `findAll`, not in the controller.

✓ Uses `createCrudController` for CRUD routes and `scope` for tenant data.

✓ Runs multi row writes in a transaction.

✓ Has unit tests, plus an e2e test for anything database specific.

✓ Passes lint, type checking and build.

✓ Is production ready.
