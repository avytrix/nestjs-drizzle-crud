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
> Or let the agent read these docs on demand: `npx nestjs-drizzle-crud-mcp` is an
> MCP server shipped with the package. See
> [crud.avytrix.dev/docs/ai-agents](https://crud.avytrix.dev/docs/ai-agents).
>
> To *contribute to* the package itself, see
> [CONTRIBUTING.md](https://github.com/myviliha/viliha-drizzle-crud/blob/main/CONTRIBUTING.md)
> and [AGENTS.md](https://github.com/myviliha/viliha-drizzle-crud/blob/main/AGENTS.md).
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
filters, comparison operators, pagination, default sort, eager loading,
relation filters, soft delete, timestamps, bulk writes, transactions, row locks
and full text search all ship. If you are writing `db.select()` inside a
service, stop and check the API reference first.

---

# Installation

```bash
pnpm add nestjs-drizzle-crud
pnpm add @nestjs/common @nestjs/core drizzle-orm reflect-metadata   # peers, always
pnpm add postgres                                                   # PostgreSQL
pnpm add mysql2                                                     # MySQL
```

`postgres` is an optional peer. You only need it when you let the module build
the connection from a `connectionString` on PostgreSQL. If you pass your own
`db`, no driver peer is required.

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
`ConfigService` or the environment. Provide exactly one of `connectionString`
or `db`. The module is global, so feature modules do not import it again for
the connection.

**2. Bind each entity in its feature module:**

```typescript
DrizzleCrudModule.forFeature([
  { service: TagsService, table: tags, config: { primaryKeyType: 'uuid' } },
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
| Read | `find(id)`, `findOne(where)`, `findAll(filters, pagination, options)`, `exists(id)`, `count(filters)` |
| Write | `create(dto)`, `update(id, dto)`, `softDelete(id)`, `restore(id)`, `delete(id)` |
| Bulk | `massCreate`, `massUpdate`, `massSoftDelete`, `massRestore`, `massDelete` |
| Search | `fullTextSearch(term, columns, pagination)`, PostgreSQL only |
| Transaction | `executeSqlTransaction(cb)` |

`findAll` returns `{ data, total, page, limit }`, not a bare array. `delete` and
`softDelete` return a boolean. `update` and `restore` return the entity and
throw `EntityNotFoundException` when the row is missing.

Every method takes `options`: `{ transaction, relations, select, search, hooks, lock, forNoKeyUpdate }`.

---

# Filtering

`findAll(filters)` and `count(filters)` take an object keyed by column name.
Unknown keys and `null` or `undefined` values are ignored, so you can pass a
query DTO straight through.

```typescript
await service.findAll({
  status: 'active',           // exact match, case-insensitive by default
  role: ['admin', 'editor'],  // IN (...)
  age: { gte: 18, lt: 65 },
  name: { ilike: 'jo%' },     // you supply the wildcards
  deleted_at: { isNull: true },
});
```

Operators inside an object value: `gt`, `gte`, `lt`, `lte`, `neq`, `like`,
`ilike`, `in`, `isNull`, `isNotNull`. A bare string is an exact match, not a
pattern, and `%` in it is a literal character.

**Never build a filter form or a where clause by hand in a controller.** Map the
query DTO to the filter object and let the service compile the SQL.

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
pagination stay correct. Filters are one level deep: go through the intermediate
table's own columns (`state: { country_id: 3 }`) instead of nesting filter
objects.

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

- **Primary keys:** `primaryKey` (default `id`) and `primaryKeyType`
  (`serial`, `bigserial`, `int`, `bigint`, `uuid`) per entity. With uuid keys
  route params are strings, so do not apply `ParseIntPipe`.
- **Soft delete:** enable per project (`defaults.softDelete`) or per entity.
  Reads then exclude deleted rows automatically. If your table has no
  `deleted_at` column, turn it off, or inserts and reads will reference a
  column that does not exist.
- **Timestamps:** prefer schema managed (`defaultNow()` plus `$onUpdate()`) so
  every write path is stamped by the database. The package managed option uses
  the application clock and only covers writes that go through the package.

---

# Hooks and validation

Override the `protected` hooks on your service rather than wrapping the service
in another layer: `validateCreate`, `validateUpdate`, `mapCreateDtoToEntity`,
`mapUpdateDtoToEntity`, and the `before*` / `after*` pairs for create, update,
delete, soft delete and restore. Defaults are no ops and pass throughs, so
override only what you need.

Validation of request shape stays in DTOs with `class-validator`. Use
`validateCreate` for rules that need the database.

---

# Errors

The package throws NestJS exceptions, so the default filter maps them without
extra wiring: `EntityNotFoundException` gives 404, `DuplicateEntityException`
and `EntityInUseException` give 409, and `ValidationFailedException`,
`ForeignKeyViolationException` and `BulkOperationException` give 400. Do not
catch these to re-throw a generic 500, and do not add a custom filter to
translate them again.

Driver error codes are translated at the service boundary, so bad client input
never reaches the caller as a 500: a unique violation is a 409, a value that is
too long or fails a check is a 400, a foreign key pointing at a row that does
not exist is a 400, and a delete blocked by dependent rows is a 409.

---

# Transactions and bulk writes

```typescript
await service.executeSqlTransaction(async (tx) => {
  const user = await service.create(dto, { transaction: tx });
  await profiles.create({ userId: user.id }, { transaction: tx });
});
```

Pass `{ transaction: tx }` to enlist any method. All bulk methods already run in
a single transaction and roll back as a unit, reporting per row failures through
`BulkOperationException`.

Take a row lock with `options.lock: 'update' | 'share'` only inside a
transaction, and prefer `forNoKeyUpdate` when the key is not changing.

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

✓ Runs multi row writes in a transaction.

✓ Has unit tests, plus an e2e test for anything database specific.

✓ Passes lint, type checking and build.

✓ Is production ready.
