# nestjs-drizzle-crud

[![docs](https://img.shields.io/badge/docs-crud.viliha.com-E0234E)](https://crud.viliha.com)
[![npm](https://img.shields.io/npm/v/nestjs-drizzle-crud?color=E0234E)](https://www.npmjs.com/package/nestjs-drizzle-crud)
[![license](https://img.shields.io/npm/l/nestjs-drizzle-crud)](./LICENSE)
[![Sponsor @myviliha](https://img.shields.io/badge/Sponsor-%40myviliha-db61a2?style=for-the-badge&logo=githubsponsors&logoColor=white)](https://github.com/sponsors/myviliha)

## ❤️ Sponsoring is what keeps this package free

A CRUD layer sounds simple until you own it in production: dialect differences,
driver result shapes, error codes that have to become the right HTTP status,
counts that stay correct once filters and joins are in play. This package
absorbs that work and gives it away under MIT.

Keeping it current with NestJS, Drizzle and TypeScript releases is ongoing, and
sponsors are what make keeping it free sustainable.

**Even $1 a month helps.** It funds bug fixes, new guides, and the next release.

> Sponsors get a spot on the [sponsor page](https://crud.viliha.com/docs/sponsor)
> and our genuine thanks.

### 👉 [Sponsor on GitHub →](https://github.com/sponsors/myviliha) &nbsp;·&nbsp; thank you 🙏

---

A complete, type-safe CRUD abstraction layer for [Drizzle ORM](https://orm.drizzle.team/) in [NestJS](https://nestjs.com/) applications.

**[Documentation](https://crud.viliha.com)** · **[npm](https://www.npmjs.com/package/nestjs-drizzle-crud)** · **[GitHub](https://github.com/myviliha/viliha-drizzle-crud)** · **[Sponsor](https://github.com/sponsors/myviliha)**

Configure the database connection **once**, then every entity gets full CRUD (find / create / update / delete / soft-delete / bulk / pagination / filtering / full-text search) by extending one base class. No per-service connection wiring.

```typescript
// 1. configure once (app.module.ts)
DrizzleCrudModule.forRoot({
  dialect: 'postgresql',
  connectionString: process.env.DATABASE_URL,
  schema,
});

// 2. a fully-featured CRUD service is just:
export class UsersService extends SqlBaseCrudService<User> {}

// 3. bind it to a table (users.module.ts)
DrizzleCrudModule.forFeature([{ service: UsersService, table: users }]);
```

---

## Table of contents

- [Features](#features)
- [Installation](#installation)
- [Quick start](#quick-start)
- [Configuration](#configuration)
- [Defining services](#defining-services)
- [API reference](#api-reference)
- [Filtering](#filtering)
- [Pagination & sorting](#pagination--sorting)
- [Relations](#relations)
- [Primary keys (serial / uuid)](#primary-keys-serial--uuid)
- [Soft delete](#soft-delete)
- [Timestamps](#timestamps)
- [Bulk operations](#bulk-operations)
- [Transactions](#transactions)
- [Full-text search (PostgreSQL)](#full-text-search-postgresql)
- [Lifecycle hooks & validation](#lifecycle-hooks--validation)
- [Testing](#testing)
- [For AI agents / LLM tools](#for-ai-agents--llm-tools)
- [Support](#support)

---

## Features

- 🚀 **Complete CRUD**, `find`, `findOne`, `findAll`, `create`, `update`, `delete`, and more
- 🧩 **Configure once**, `forRoot()` owns the connection; services only declare a table
- ⚡ **Type-safe**. Generics over your entity, create/update DTOs and filter types
- 🗃️ **PostgreSQL & MySQL**. Dialect-aware (`RETURNING` vs `insertId`)
- 🔄 **Soft delete**. Opt-in soft delete with `restore`
- 📦 **Bulk operations**. Mass create/update/delete inside a transaction
- 🔍 **Rich filtering**. Equality, `in`, comparison operators, `like`/`ilike`, null checks
- 🔎 **Full-text search**. PostgreSQL `tsvector`/`tsquery`
- 🔗 **Relations**. Many-to-one eager loading and filtering by related columns
- 🔑 **Flexible primary keys**, `serial` / `int` / `bigint` / `bigserial` / `uuid`
- 🪝 **Hooks & validation**, `before*`/`after*` hooks, `validateCreate`/`validateUpdate`
- 🧪 **Test utilities**. Mock db/table/entity factories

---

## Installation

```bash
pnpm add nestjs-drizzle-crud
# or
npm install nestjs-drizzle-crud
# or
yarn add nestjs-drizzle-crud
```

Peer dependencies (install the ones you use):

```bash
# always
pnpm add @nestjs/common @nestjs/core drizzle-orm reflect-metadata

# PostgreSQL (also required if you use `connectionString` with dialect 'postgresql')
pnpm add postgres

# MySQL
pnpm add mysql2
```

> Using npm or yarn? Swap `pnpm add` for `npm install` / `yarn add`.

> **pnpm note:** `postgres`/`mysql2` are optional peer dependencies. pnpm enforces
> peer deps strictly, so if you build the connection from a `connectionString`
> make sure the matching driver is installed in your app.

> `postgres` is an **optional** peer dependency. It's only needed when you let the
> module build the connection from a `connectionString` for the `postgresql` dialect.
> If you pass a pre-built `db` instead, you don't need it.

---

## Quick start

### 1. Define your Drizzle schema

```typescript
// db/schema.ts
import { pgTable, serial, varchar } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 100 }).notNull(),
  email: varchar('email', { length: 255 }).notNull().unique(),
});

export const schema = { users };
export type User = typeof users.$inferSelect;
```

### 2. Configure the module once

```typescript
// app.module.ts
import { Module } from '@nestjs/common';
import { DrizzleCrudModule } from 'nestjs-drizzle-crud';
import { schema } from './db/schema';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    DrizzleCrudModule.forRoot({
      dialect: 'postgresql',
      connectionString: process.env.DATABASE_URL,
      schema,
    }),
    UsersModule,
  ],
})
export class AppModule {}
```

The connection is created here, exposed globally, and closed automatically on
application shutdown (when the module built it from a `connectionString`).

### 3. Create a service

```typescript
// users/users.service.ts
import { SqlBaseCrudService } from 'nestjs-drizzle-crud';
import type { User } from '../db/schema';

export interface CreateUserDto { name: string; email: string }
export interface UpdateUserDto { name?: string; email?: string }
export interface UserFilterDto { name?: string; email?: string }

export class UsersService extends SqlBaseCrudService<
  User,
  CreateUserDto,
  UpdateUserDto,
  UserFilterDto
> {}
```

### 4. Bind the service to a table

```typescript
// users/users.module.ts
import { Module } from '@nestjs/common';
import { DrizzleCrudModule } from 'nestjs-drizzle-crud';
import { users } from '../db/schema';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [
    DrizzleCrudModule.forFeature([{ service: UsersService, table: users }]),
  ],
  controllers: [UsersController],
})
export class UsersModule {}
```

### 5. Use it in a controller

```typescript
// users/users.controller.ts
import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common';
import { CreateUserDto, UpdateUserDto, UsersService } from './users.service';

@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  findAll(@Query('page') page = '1', @Query('limit') limit = '20') {
    return this.users.findAll({}, { page: +page, limit: +limit });
  }

  @Get(':id')
  find(@Param('id', ParseIntPipe) id: number) {
    return this.users.find(id);
  }

  @Post()
  create(@Body() dto: CreateUserDto) {
    return this.users.create(dto);
  }

  @Put(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateUserDto) {
    return this.users.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.users.delete(id);
  }
}
```

---

## Configuration

### `DrizzleCrudModule.forRoot(config)`

| Field | Type | Description |
|---|---|---|
| `dialect` | `'postgresql' \| 'mysql'` | **Required.** Database dialect. |
| `connectionString` | `string` | Connection string. The module builds the connection (PostgreSQL only). |
| `db` | `Drizzle instance` | Alternatively, pass a Drizzle instance you built yourself (any dialect). |
| `schema` | `Record<string, unknown>` | Drizzle schema, used when building from `connectionString`. |
| `defaults.softDelete` | `boolean` | Enable soft delete for all entities (default `true`). |
| `defaults.timestamps` | `boolean` | Auto-manage `created_at`/`updated_at` for all entities (default `true`). |
| `defaults.pagination` | `{ defaultLimit, maxLimit }` | Pagination defaults (default `{ 20, 100 }`). |
| `defaults.sortOrder` | `'asc' \| 'desc'` | Opt-in default sort: entities **without** an explicit `defaultSort` fall back to ordering by their `created_at` column in this direction. Omit to leave `findAll` unsorted by default. |
| `sql` | `{ caseSensitive, useReturning, jsonSupport, enableFullTextSearch }` | Dialect tuning. `useReturning` defaults to `true` for PostgreSQL, `false` for MySQL. |

> **Provide exactly one of `connectionString` or `db`.** If your tables have no
> `created_at`/`updated_at`/`deleted_at` columns, set
> `defaults: { softDelete: false, timestamps: false }`.

**Build the connection yourself (any dialect, recommended for MySQL):**

```typescript
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

DrizzleCrudModule.forRoot({
  dialect: 'postgresql',
  db: drizzle(postgres(process.env.DATABASE_URL!), { schema }),
});
```

### `DrizzleCrudModule.forRootAsync(options)`

```typescript
DrizzleCrudModule.forRootAsync({
  imports: [ConfigModule],
  inject: [ConfigService],
  useFactory: (cfg: ConfigService) => ({
    dialect: 'postgresql',
    connectionString: cfg.get('DATABASE_URL'),
    schema,
  }),
});
```

### `DrizzleCrudModule.forFeature(entities)`

Registers one or more services and binds each to its table. Per-entity overrides
go in `config`:

```typescript
DrizzleCrudModule.forFeature([
  { service: UsersService, table: users },
  {
    service: PostsService,
    table: posts,
    config: {
      primaryKey: 'uuid',
      primaryKeyType: 'uuid',
      softDelete: { enabled: true, column: 'deleted_at' },
      // Default ORDER BY for findAll() when the caller passes no sortBy.
      defaultSort: [
        { column: 'position', order: 'asc' },
        { column: 'created_at', order: 'desc' }, // tiebreaker
      ],
    },
  },
]);
```

Anything in `config` overrides the project defaults for that entity. The shape is
[`SqlCrudConfig`](#sqlcrudconfig) minus `db`/`dialect`.

---

## Defining services

The minimal service is an empty class. Connection, dialect and defaults are
injected by the module:

```typescript
export class UsersService extends SqlBaseCrudService<User> {}
```

Add custom behaviour by overriding hooks (see [Lifecycle hooks](#lifecycle-hooks--validation))
or add your own methods:

```typescript
export class UsersService extends SqlBaseCrudService<User, CreateUserDto, UpdateUserDto, UserFilterDto> {
  findByEmail(email: string) {
    return this.findOne({ email } as Partial<User>);
  }

  protected async validateCreate(data: CreateUserDto): Promise<void> {
    if (!data.email.includes('@')) throw new Error('Invalid email');
  }
}
```

---

## API reference

`SqlBaseCrudService<T, CreateDto = Partial<T>, UpdateDto = Partial<T>, FilterDto = Partial<T>>`

### Read

| Method | Returns | Notes |
|---|---|---|
| `find(id, options?)` | `Promise<T \| null>` | By primary key. Skips soft-deleted rows. |
| `findOne(where, options?)` | `Promise<T \| null>` | `where` is a `Partial<T>` (equality only). |
| `findAll(filters?, pagination?, options?)` | `Promise<{ data: T[]; total: number; page: number; limit: number }>` | See [Filtering](#filtering) / [Pagination](#pagination--sorting). |
| `exists(id, options?)` | `Promise<boolean>` | |
| `count(filters?, options?)` | `Promise<number>` | |

### Write

| Method | Returns | Notes |
|---|---|---|
| `create(data, options?)` | `Promise<T>` | Runs `validateCreate` → `beforeCreate` → insert → `afterCreate`. |
| `update(id, data, options?)` | `Promise<T>` | Throws `EntityNotFoundException` if missing. |
| `delete(id, options?)` | `Promise<boolean>` | Hard delete. |
| `softDelete(id, options?)` | `Promise<boolean>` | Requires soft delete enabled. |
| `restore(id, options?)` | `Promise<T>` | Clears the soft-delete column. |

### Bulk (run inside a transaction)

| Method | Returns |
|---|---|
| `massCreate(data[], options?)` | `Promise<T[]>` |
| `massUpdate(ids[], data, options?)` | `Promise<T[]>` |
| `massSoftDelete(ids[], options?)` | `Promise<boolean>` |
| `massRestore(ids[], options?)` | `Promise<T[]>` |
| `massDelete(ids[], options?)` | `Promise<boolean>` |

### Search

| Method | Returns |
|---|---|
| `fullTextSearch(term, columns, pagination?, options?)` | `Promise<{ data: T[]; total: number; page: number; limit: number }>` (PostgreSQL only) |

`findAll` and `count` also accept `options.search` for list-style search where the
normal filters, pagination, sorting, relation filters, and `total` count should
all stay in one query path:

```typescript
await service.findAll(
  {},
  { page: 1, limit: 20, sortBy: 'name', sortOrder: 'asc' },
  { search: { term: 'na', columns: ['name', 'code'] } },
);
```

By default this searches the configured columns with `ILIKE '%term%'` joined by
`OR`. For PostgreSQL full-text matching, pass `mode: 'fullText'`.

### `SqlOperationOptions`

```typescript
interface SqlOperationOptions {
  transaction?: any;            // run within an existing transaction
  select?: string[];            // return only these columns
  relations?: string[];         // eager-load these configured relations (see Relations)
  search?: {
    term: string;                // user search term
    columns: string[];           // table column keys to search
    mode?: 'ilike' | 'fullText'; // default: 'ilike'
  };
  hooks?: { skipBefore?: boolean; skipAfter?: boolean };
  lock?: 'update' | 'share' | 'none';
  forNoKeyUpdate?: boolean;
}
```

> `relations` eager-loads relations declared in the entity's config. See [Relations](#relations).

---

## Filtering

`findAll(filters)` / `count(filters)` accept an object keyed by column name.
Unknown keys and `null`/`undefined` values are ignored.

```typescript
await service.findAll({
  status: 'active',                // string: exact match (case-insensitive when sql.caseSensitive === false)
  role: ['admin', 'editor'],       // array: IN (...)
  age: { gte: 18, lt: 65 },        // comparison operators
  name: { ilike: 'jo%' },          // pattern match: you supply the wildcards
  deleted_at: { isNull: true },    // null checks
});
```

**Operators** (inside an object value):

| Operator | SQL |
|---|---|
| `gt` / `gte` / `lt` / `lte` | `>` `>=` `<` `<=` |
| `neq` | `<>` |
| `like` / `ilike` | `LIKE` / `ILIKE`, **pass your own `%` wildcards** |
| `in` | `IN (...)` |
| `isNull` / `isNotNull` | `IS NULL` / `IS NOT NULL` |

> A bare string value is an **exact** match. When `sql.caseSensitive` is `false`
> (the default) it compares `lower(column) = lower(value)`, so the match is
> case-insensitive and `%` / `_` / `\` in the value are treated as literal
> characters. Not wildcards. For partial/pattern matching, use the explicit
> `like` / `ilike` operators and supply your own wildcards.

---

## Pagination & sorting

```typescript
await service.findAll(
  {},
  { page: 2, limit: 25, sortBy: 'created_at', sortOrder: 'desc' },
);
// → { data: [...], total: 240, page: 2, limit: 25 }
```

`limit` is capped at `pagination.maxLimit`. `sortOrder` defaults to `'desc'`.

### Default sort

When the caller passes no `sortBy`, `findAll` falls back to the entity's
`defaultSort`. An ordered list of columns applied as the `ORDER BY` (primary
sort first, then tiebreakers). An explicit `sortBy` **replaces** the default
entirely. Per-column `order` defaults to `'asc'`; unknown columns are skipped.

```typescript
// config.defaultSort: [{ column: 'position', order: 'asc' }, { column: 'created_at', order: 'desc' }]
await service.findAll();                       // ORDER BY position ASC, created_at DESC
await service.findAll({}, { sortBy: 'name' }); // ORDER BY name DESC  (default ignored)
```

Set it per entity in [`forFeature`](#drizzlecrudmoduleforfeatureentities) config (or via
`@CrudService`). Alternatively, set [`defaults.sortOrder`](#drizzlecrudmoduleforrootconfig)
in `forRoot` to apply a `created_at` fallback to every entity that doesn't define its own.

---

## Relations

The package supports **many-to-one / belongs-to** relations: a foreign key on
this entity's table points at another table's key. Declare them in the entity's
`forFeature` config under `relations`, keyed by relation name:

```typescript
import { cities, states } from './db/schema';

DrizzleCrudModule.forFeature([
  {
    service: CitiesService,
    table: cities,
    config: {
      relations: {
        // cities.state_id -> states.id   (`references` defaults to 'id')
        state: { table: states, localKey: 'state_id', references: 'id' },
      },
    },
  },
]);
```

Once declared, you get two capabilities:

### 1. Eager loading

Pass `relations` in the operation options to LEFT JOIN and nest the related row:

```typescript
await cities.find(1, { relations: ['state'] });
// → { id: 1, name: 'Bengaluru', state_id: 7, state: { id: 7, name: 'Karnataka', country_id: 3 } }

await cities.findAll({}, { page: 1, limit: 20 }, { relations: ['state'] });
```

If there's no match, the relation comes back as `null`.

### 2. Filtering by related columns

Use the relation name as a filter key with a nested object of the **related
table's** columns. Supports the same [operators](#filtering) as normal filters:

```typescript
// all cities whose state is named 'Karnataka' (case-insensitive exact)
await cities.findAll({ state: { name: 'Karnataka' } });

// all cities in a country: filter on the intermediate table's FK column
await cities.findAll({ state: { country_id: 3 } });

// combine with normal column filters and operators
await cities.findAll({ name: { ilike: 'B%' }, state: { country_id: 3 } });
```

> **Scope:** only **many-to-one / one-to-one** (belongs-to) relations are
> supported. Has-many collection loading and many-to-many (join tables) are not
> handled. Model those with a custom service method using `this.config.db`, or
> orchestrate across services in a controller.
>
> **Multi-level filtering** works through the intermediate table's columns
> (e.g. filter cities by `state.country_id`), so you usually don't need a
> direct relation to the far table.

---

## Primary keys (serial / uuid)

Each entity declares its primary key via `primaryKey` (column name, default
`id`) and `primaryKeyType`. Both auto-increment and UUID keys are supported.

```typescript
// serial / auto-increment (default)
{ service: UsersService, table: users }   // primaryKey 'id', primaryKeyType 'serial'

// UUID
{
  service: TagsService,
  table: tags,                  // e.g. uuid('id').primaryKey().defaultRandom()
  config: { primaryKey: 'id', primaryKeyType: 'uuid' },
}
```

`primaryKeyType` accepts `'serial' | 'bigserial' | 'int' | 'bigint' | 'uuid'`.
On PostgreSQL the created row (including a DB-generated UUID) is returned via
`RETURNING`. On MySQL (no `RETURNING`), provide the UUID in your create payload
so the row can be re-read. Auto-increment keys use the driver's `insertId`.

> Remember: with UUID keys, route params are strings. Don't apply
> `ParseIntPipe` in your controller.

---

## Soft delete

Enable per-project via `defaults.softDelete` or per-entity via `forFeature` config:

```typescript
{ service: UsersService, table: users, config: { softDelete: { enabled: true, column: 'deleted_at' } } }
```

- `softDelete(id)` sets the column to the current timestamp.
- `restore(id)` sets it back to `null`.
- `find`/`findOne`/`findAll`/`count` automatically exclude soft-deleted rows.

---

## Timestamps

There are two ways to manage `created_at` / `updated_at`.

### Package-managed (convenient)

Enable `defaults.timestamps` (or per-entity `timestamps`). On `create()` the
service stamps both columns; on `update()`/`softDelete()` it stamps `updated_at`:

```typescript
DrizzleCrudModule.forRoot({
  dialect: 'postgresql',
  connectionString: process.env.DATABASE_URL,
  schema,
  defaults: { timestamps: true }, // uses columns created_at / updated_at
});
```

> Caveat: this uses the **application** clock and only applies to writes that go
> **through the package**. Raw SQL, migrations or other code paths won't set
> the values.

### Schema/DB-managed (recommended)

For authoritative timestamps (database time, every write path), define them in
your Drizzle schema and **leave the package's `timestamps` disabled**:

```typescript
import { timestamp } from 'drizzle-orm/pg-core';

created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
updated_at: timestamp('updated_at', { withTimezone: true })
  .defaultNow()
  .notNull()
  .$onUpdate(() => new Date()),
```

`defaultNow()` lets the database set `created_at` on insert; `$onUpdate()` makes
Drizzle bump `updated_at` on every update (including the package's own
`update()`). For `updated_at` that's authoritative even for raw SQL, add a
Postgres trigger / MySQL `ON UPDATE CURRENT_TIMESTAMP`.

---

## Bulk operations

```typescript
await service.massCreate([dto1, dto2, dto3]);
await service.massUpdate([1, 2, 3], { status: 'archived' });
await service.massSoftDelete([1, 2, 3]);
```

All bulk methods run inside a single transaction; if any row fails, a
`BulkOperationException` (carrying the per-row errors) is thrown and the
transaction rolls back.

---

## Transactions

```typescript
await service.executeSqlTransaction(async (tx) => {
  const user = await service.create(userDto, { transaction: tx });
  await profileService.create({ userId: user.id }, { transaction: tx });
});
```

Pass `{ transaction: tx }` in `options` to any method to enlist it.

---

## Full-text search (PostgreSQL)

```typescript
const { data, total } = await service.fullTextSearch(
  'john doe',
  ['name', 'email', 'bio'],
  { page: 1, limit: 20 },
);
```

Builds `to_tsvector(...) @@ plainto_tsquery(...)` across the given columns and
orders by `ts_rank`. Throws if the dialect is not `postgresql`.

For paginated list endpoints, prefer `findAll(..., ..., { search })` so search is
combined with filters and the count query. Use `fullTextSearch` directly when
you want ranked full-text results as the primary operation.

---

## Lifecycle hooks & validation

Override any of these `protected` methods in your service (all are optional;
defaults are no-op / pass-through):

```typescript
protected validateCreate(data: CreateDto): Promise<void>
protected validateUpdate(id: any, data: UpdateDto): Promise<void>
protected mapCreateDtoToEntity(data: CreateDto): Record<string, any>
protected mapUpdateDtoToEntity(data: UpdateDto): Record<string, any>

protected beforeCreate(data: CreateDto): Promise<CreateDto>
protected afterCreate(entity: T): Promise<void>
protected beforeUpdate(id: any, data: UpdateDto): Promise<UpdateDto>
protected afterUpdate(entity: T): Promise<void>
protected beforeDelete(id: any): Promise<void>
protected afterDelete(id: any): Promise<void>
protected beforeSoftDelete(id: any): Promise<void>
protected afterSoftDelete(id: any): Promise<void>
protected beforeRestore(id: any): Promise<void>
protected afterRestore(entity: T): Promise<void>
```

`mapCreateDtoToEntity` / `mapUpdateDtoToEntity` transform the incoming DTO into the
row to persist (default returns a shallow copy). When `timestamps` is enabled, the
service stamps `created_at`/`updated_at` automatically.

---

## Testing

```typescript
import { TestCrudFactory } from 'nestjs-drizzle-crud';

const mockDb = TestCrudFactory.createMockDb();
const mockTable = TestCrudFactory.createMockTable();
const service = TestCrudFactory.createTestService(UsersService, mockDb, mockTable);
```

`TestCrudFactory` provides `createMockDb()`, `createMockTable()`,
`createMockEntity()` and `createTestService()` for unit tests without a database.

---

## For AI agents / LLM tools

Concise, accurate facts for code generation. Prefer these over guessing.

**Package:** `nestjs-drizzle-crud` · **Peers:** `@nestjs/common`, `@nestjs/core`, `drizzle-orm`, `reflect-metadata`; optional `postgres` (PG) / `mysql2` (MySQL).

**Setup is two steps and no per-service connection wiring:**
1. `DrizzleCrudModule.forRoot({ dialect, connectionString | db, schema, defaults })` once in `AppModule`.
2. `DrizzleCrudModule.forFeature([{ service, table, config? }])` in each feature module.

**A service is an empty subclass. Do NOT inject the db or pass `dialect`/`db`:**
```typescript
export class XService extends SqlBaseCrudService<X, CreateXDto, UpdateXDto, XFilterDto> {}
```

**Rules / gotchas:**
- Generics order: `SqlBaseCrudService<Entity, CreateDto, UpdateDto, FilterDto>`. All but `Entity` default to `Partial<Entity>`.
- Do **not** add an `@Inject('DRIZZLE_DB')` constructor, `forFeature` constructs the service for you. Adding a constructor that calls `super({...})` is the legacy/manual pattern and is unnecessary.
- The table is passed in `forFeature`, **not** in the service.
- If tables lack timestamp/soft-delete columns, set `defaults: { softDelete: false, timestamps: false }`, else inserts will reference non-existent columns.
- `findAll` returns `{ data, total, page, limit }`. Not a bare array.
- Filter operators live inside an object value: `{ age: { gte: 18 } }`. `like`/`ilike` require caller-supplied `%` wildcards; a bare string is exact match.
- `delete`/`softDelete` return `boolean`; `update`/`restore` return the entity and throw `EntityNotFoundException` when missing.
- Postgres error codes are translated for you: `23505` unique -> 409, `22001`/`23514`/`22003` bad value -> 400, `23503` on create/update (missing FK target) -> 400 `ForeignKeyViolationException`, `23503` on delete (still referenced) -> 409 `EntityInUseException`.
- Relations (many-to-one only): declare in forFeature `config.relations = { relName: { table, localKey, references? } }`. Then eager-load via `options.relations: ['relName']` (nested object on the result, `null` if unmatched) and filter via `findAll({ relName: { col: value } })` (same operators; multi-level via the intermediate table's columns, e.g. `state.country_id`). No has-many/many-to-many.
- Primary keys: `primaryKey` (default `'id'`) + `primaryKeyType` (`'serial' | 'bigserial' | 'int' | 'bigint' | 'uuid'`) per entity in forFeature config. UUID works on Postgres via RETURNING; with uuid keys, route params are strings. Don't use `ParseIntPipe`.
- Full-text search is PostgreSQL-only.
- Exports: `SqlBaseCrudService`, `DrizzleCrudModule`, `DRIZZLE_DB`, `DRIZZLE_CRUD_CONFIG`, `TestCrudFactory`, exceptions (`EntityNotFoundException`, `DuplicateEntityException`, `ForeignKeyViolationException`, `EntityInUseException`, `ValidationFailedException`, `BulkOperationException`, `DatabaseConnectionException`, `TransactionException`), and types (`SqlCrudConfig`, `SqlOperationOptions`, `DrizzleCrudConfig`, `CrudFeature`, `SqlDialect`, `PrimaryKeyType`).

### `SqlCrudConfig`

```typescript
interface SqlCrudConfig {
  dialect: 'postgresql' | 'mysql';
  db: any;                         // Drizzle instance (injected by forFeature)
  table: any;                      // Drizzle table (set by forFeature)
  primaryKey: string;              // default 'id'
  primaryKeyType: 'serial' | 'bigserial' | 'int' | 'bigint' | 'uuid';
  softDelete?: { enabled: boolean; column: string };
  timestamps?: { createdAt: string; updatedAt: string };
  pagination?: { defaultLimit: number; maxLimit: number };
  sql?: { caseSensitive: boolean; useReturning: boolean; jsonSupport: boolean; enableFullTextSearch: boolean };
  relations?: Record<string, { table: any; localKey: string; references?: string }>;
}
```

---

## Support

- **Docs:** [crud.viliha.com](https://crud.viliha.com), including a
  [FAQ and where-to-ask guide](https://crud.viliha.com/docs/getting-help).
- **Questions:** [GitHub Discussions](https://github.com/myviliha/viliha-drizzle-crud/discussions).
- **Bugs:** [open an issue](https://github.com/myviliha/viliha-drizzle-crud/issues/new/choose)
  with the version, dialect, table definition and the call you made.
- **Security:** follow [SECURITY.md](https://github.com/myviliha/viliha-drizzle-crud/blob/main/SECURITY.md),
  never a public issue.
- **AI agents:** this package ships `AGENT.md`. Point your coding agent at it with
  `cp node_modules/nestjs-drizzle-crud/CLAUDE.template.md ./CLAUDE.md`.
- **Sponsor:** [github.com/sponsors/myviliha](https://github.com/sponsors/myviliha).

---

## License

MIT 
