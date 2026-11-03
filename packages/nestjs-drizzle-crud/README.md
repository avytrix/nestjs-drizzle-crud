# nestjs-drizzle-crud

[![docs](https://img.shields.io/badge/docs-crud.avytrix.dev-E0234E)](https://crud.avytrix.dev)
[![npm](https://img.shields.io/npm/v/@avytrix/nestjs-drizzle-crud?color=E0234E)](https://www.npmjs.com/package/@avytrix/nestjs-drizzle-crud)
[![license](https://img.shields.io/npm/l/@avytrix/nestjs-drizzle-crud)](./LICENSE)
[![Sponsor @avytrix](https://img.shields.io/badge/Sponsor-%40avytrix-db61a2?style=for-the-badge&logo=githubsponsors&logoColor=white)](https://github.com/sponsors/avytrix)

**nestjs-drizzle-crud is a NestJS + Drizzle ORM CRUD library: extend one base class and every table gets type-safe find, create, update, delete, filtering, pagination, relations and soft delete, on PostgreSQL, MySQL or SQLite.**

```bash
pnpm add @avytrix/nestjs-drizzle-crud drizzle-orm
```

> **Renamed.** From 3.5.1 the package is `@avytrix/nestjs-drizzle-crud`; the unscoped `nestjs-drizzle-crud` is deprecated. Change the dependency and the imports, nothing else changes.

```typescript
// app.module.ts: configure the connection once
DrizzleCrudModule.forRoot({
  dialect: 'postgresql',
  connectionString: process.env.DATABASE_URL,
  schema,
});

// users.service.ts: a full CRUD service is an empty subclass
export class UsersService extends SqlBaseCrudService<
  User, CreateUserDto, UpdateUserDto, CrudFilter
> {}

// users.module.ts: bind it to a table
DrizzleCrudModule.forFeature([{ service: UsersService, table: users }]);
```

**[Read the docs at crud.avytrix.dev](https://crud.avytrix.dev)**, starting with the [quick start](https://crud.avytrix.dev/docs/quick-start/). Also on [npm](https://www.npmjs.com/package/@avytrix/nestjs-drizzle-crud) and [GitHub](https://github.com/avytrix/nestjs-drizzle-crud).

Built and maintained by **[Avytrix Technologies](https://avytrix.dev/?utm_source=nestjs-drizzle-crud&utm_medium=docs&utm_campaign=readme)**. Need help shipping? [Hire the team behind the library](https://crud.avytrix.dev/docs/commercial-support/).

## ❤️ Sponsoring is what keeps this package free

A CRUD layer sounds simple until you own it in production: dialect differences,
driver result shapes, error codes that have to become the right HTTP status,
counts that stay correct once filters and joins are in play. This package
absorbs that work and gives it away under MIT.

Keeping it current with NestJS, Drizzle and TypeScript releases is ongoing, and
sponsors are what make keeping it free sustainable.

**Even $1 a month helps.** It funds bug fixes, new guides, and the next release.

> Sponsors get a spot on the [sponsor page](https://crud.avytrix.dev/docs/sponsor/)
> and our thanks.

### 👉 [Sponsor on GitHub →](https://github.com/sponsors/avytrix) &nbsp;·&nbsp; thank you 🙏

---

## Table of contents

- [Features](#features)
- [Installation](#installation)
- [Quick start](#quick-start)
- [Configuration](#configuration)
- [Defining services](#defining-services)
- [API reference](#api-reference)
- [Filtering](#filtering)
- [Query strings: parseQuery](#query-strings-parsequery)
- [Allowlists](#allowlists)
- [Pagination & sorting](#pagination--sorting)
- [Cursor pagination](#cursor-pagination)
- [Relations](#relations)
- [Column selection](#column-selection)
- [Primary keys (serial / uuid)](#primary-keys-serial--uuid)
- [Soft delete](#soft-delete)
- [Timestamps](#timestamps)
- [Bulk operations](#bulk-operations)
- [Upsert](#upsert)
- [Relations on writes](#relations-on-writes)
- [Controller factory](#controller-factory)
- [OpenAPI (Swagger)](#openapi-swagger)
- [Multi-tenancy: scope](#multi-tenancy-scope)
- [Events and global hooks](#events-and-global-hooks)
- [Optimistic locking](#optimistic-locking)
- [Counts and grouped counts](#counts-and-grouped-counts)
- [Transactions](#transactions)
- [Full-text search (PostgreSQL)](#full-text-search-postgresql)
- [Lifecycle hooks & validation](#lifecycle-hooks--validation)
- [Testing](#testing)
- [For AI agents / LLM tools](#for-ai-agents--llm-tools)
- [Support](#support)

---

## Features

- 🚀 **CRUD**: `find`, `findOne`, `findAll`, `create`, `update`, `delete`, and more
- 🧩 **Configure once**: `forRoot()` owns the connection; services only declare a table
- ⚡ **Type-safe**: generics over your entity, create/update DTOs and filter types
- 🗃️ **PostgreSQL, MySQL & SQLite**: dialect-aware (`RETURNING` vs `insertId`), libSQL and Cloudflare D1 included
- 🔄 **Soft delete**: opt-in, with `restore`, a trash view (`onlyDeleted`) and `forceDelete`
- 📦 **Bulk operations**: one statement per mass create/update/delete, inside a transaction, plus `upsert`
- 🔍 **Filtering**: comparison, `in`/`notIn`, `between`, escaped `contains`/`startsWith`, array and JSON operators, `or`/`not` groups
- 🧾 **Query string parsing**: `parseQuery` turns `?age[gte]=18&sortBy=-name` into typed filters
- 🛡️ **Allowlists**: limit what a client may filter, sort, select and write
- 📜 **Cursor pagination**: `findByCursor` with an opaque `nextCursor`
- 🔎 **Full-text search**: PostgreSQL `tsvector`/`tsquery`
- 🔗 **Relations**: belongs-to, has-many, many-to-many and nested eager loading with no N+1, filtering through relation paths with `some` / `none` / `every`, and relations on writes (nested create, `attach` / `detach` / `sync`)
- 🧭 **Controller factory**: `createCrudController(Service)` wires list, get, create, update, delete, trash, restore and bulk routes, with the id pipe picked from the key
- 📘 **OpenAPI**: `@ApiCrudList()` documents every list parameter and filterable column (optional `@nestjs/swagger` peer)
- 🏢 **Multi-tenancy**: a `scope` keeps every read and write inside the caller's tenant; another tenant's id is a 404
- 📣 **Events**: module-level before/after events for every write, bulk included, for audit trails and cache busting
- 🔒 **Optimistic locking**: a version column, and a stale write is a 409
- 🔢 **Counts**: `_count` for collections and `countBy(column)`, batched; `withCount: false` skips `COUNT(*)`
- 🎯 **Column selection**: ask for the columns you need, relation columns included
- 🤖 **AI agents**: rules templates for each agent tool, and a bundled MCP server
- 🔑 **Primary keys**: `serial` / `int` / `bigint` / `bigserial` / `uuid`
- 🪝 **Hooks & validation**: `before*`/`after*` hooks, `validateCreate`/`validateUpdate`
- 🧪 **Test utilities**: mock db/table/entity factories

---

## Installation

```bash
pnpm add @avytrix/nestjs-drizzle-crud
# or
npm install @avytrix/nestjs-drizzle-crud
# or
yarn add @avytrix/nestjs-drizzle-crud
```

Peer dependencies (install the ones you use):

```bash
# always
pnpm add @nestjs/common @nestjs/core drizzle-orm reflect-metadata

# PostgreSQL (also required if you use `connectionString` with dialect 'postgresql')
pnpm add postgres

# MySQL (also required if you use `connectionString` with dialect 'mysql')
pnpm add mysql2

# SQLite / libSQL (you build the Drizzle instance and pass it as `db`)
pnpm add @libsql/client

# Only for ApiCrudQuery / ApiCrudList (OpenAPI docs)
pnpm add @nestjs/swagger
```

> Using npm or yarn? Swap `pnpm add` for `npm install` / `yarn add`.

> **pnpm note:** `postgres` and `mysql2` are optional peer dependencies. pnpm
> enforces peer deps strictly, so if you build the connection from a
> `connectionString` make sure the driver for your dialect is installed in your app.
> If you pass a pre-built `db` instead, you don't need either. SQLite always takes a
> `db` you build.

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
import { DrizzleCrudModule } from '@avytrix/nestjs-drizzle-crud';
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
import { SqlBaseCrudService } from '@avytrix/nestjs-drizzle-crud';
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
import { DrizzleCrudModule } from '@avytrix/nestjs-drizzle-crud';
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

  // ?status=active&age[gte]=18&sortBy=-created_at&page=2&limit=20
  @Get()
  findAll(@Query() query: Record<string, unknown>) {
    const q = this.users.parseQuery(query);
    return this.users.findAll(q.filters, q.pagination, q.options);
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
| `dialect` | `'postgresql' \| 'mysql' \| 'sqlite'` | **Required.** Database dialect. `'sqlite'` covers SQLite, libSQL and Cloudflare D1. |
| `connectionString` | `string` | Connection string. The module builds the connection (PostgreSQL with `postgres`, MySQL with `mysql2`). |
| `connection` | `{ poolSize?, idleTimeout?, ssl? }` | Pool size, idle timeout (seconds) and TLS for the connection built from `connectionString`. On MySQL an idle timeout also sets mysql2's `maxIdle` one below the pool size, so idle connections really close. |
| `db` | `Drizzle instance` | Alternatively, pass a Drizzle instance you built yourself (any dialect). |
| `schema` | `Record<string, unknown>` | Drizzle schema, used when building from `connectionString`. |
| `defaults.softDelete` | `boolean` | Enable soft delete for all entities (default `true`). |
| `defaults.timestamps` | `boolean` | Auto-manage `created_at`/`updated_at` for all entities (default `true`). |
| `defaults.pagination` | `{ defaultLimit?, maxLimit? }` | Pagination defaults (default `{ 20, 100 }`). Either key alone keeps the other's default. |
| `defaults.sortOrder` | `'asc' \| 'desc'` | Opt-in default sort: entities **without** an explicit `defaultSort` fall back to ordering by their `created_at` column in this direction. Omit it and `findAll` orders by the primary key only. |
| `sql` | `{ caseSensitive?, useReturning? }` | Dialect tuning. `useReturning` defaults to `true` for PostgreSQL and SQLite, `false` for MySQL. `jsonSupport` and `enableFullTextSearch` are deprecated and do nothing. |
| `hooks` | `{ enableGlobalHooks?, subscribers? }` | Module-level write events on the `CrudEventBus`. See [Events](#events-and-global-hooks). |

> **Provide exactly one of `connectionString` or `db`.** If your tables have no
> `created_at`/`updated_at`/`deleted_at` columns, set
> `defaults: { softDelete: false, timestamps: false }`. The soft-delete and
> timestamp settings name the **key** in your Drizzle table object; with
> camelCase keys (`deletedAt: timestamp('deleted_at')`) set them per entity:
> `softDelete: { column: 'deletedAt' }`,
> `timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' }`. A key the
> table does not have stops the app at startup, and the message names the key
> to use.

**Build the connection yourself (any dialect, required for SQLite):**

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

`forRootAsync` also takes `useClass` or `useExisting` with a class that
implements `DrizzleCrudOptionsFactory`. Give exactly one of the three; more than
one is a startup error:

```typescript
@Injectable()
class CrudConfig implements DrizzleCrudOptionsFactory {
  constructor(private readonly cfg: ConfigService) {}
  createDrizzleCrudOptions(): DrizzleCrudConfig {
    return { dialect: 'mysql', connectionString: this.cfg.get('DATABASE_URL') };
  }
}

DrizzleCrudModule.forRootAsync({ useClass: CrudConfig });
```

On SQLite (`dialect: 'sqlite'`), mass writes, nested creates and attach / detach
/ sync need an async transaction: they work on libSQL and throw a
`TransactionException` on Cloudflare D1 and synchronous drivers such as
better-sqlite3. Full-text search, row locks and the array and JSON operators
are a 400 there.

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
export class UsersService extends SqlBaseCrudService<
  User, CreateUserDto, UpdateUserDto, CrudFilter
> {}
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
| `findOne(where, options?)` | `Promise<T \| null>` | Exact values, `null` for `IS NULL`, or operator objects. |
| `findAll(filters?, pagination?, options?)` | `Promise<{ data: T[]; total: number; page: number; limit: number }>` | See [Filtering](#filtering) / [Pagination](#pagination--sorting). With `withCount: false`, `total` is `null` and `hasMore` is set. |
| `findByCursor(filters?, pagination?, options?)` | `Promise<{ data: T[]; limit: number; nextCursor: string \| null; total?: number }>` | Keyset pages. See [Cursor pagination](#cursor-pagination). |
| `exists(id, options?)` | `Promise<boolean>` | |
| `count(filters?, options?)` | `Promise<number>` | |
| `countBy(column, filters?, options?)` | `Promise<{ value; count }[]>` | Grouped counts, largest first. See [Counts](#counts-and-grouped-counts). |
| `parseQuery(query, options?)` | `ParsedCrudQuery` | See [Query strings](#query-strings-parsequery). |
| `parseId(raw)` | `Promise<unknown>` | Parses a route id by the key's type (ParseIntPipe, ParseUUIDPipe, bigint, string). |

### Write

| Method | Returns | Notes |
|---|---|---|
| `create(data, options?)` | `Promise<T>` | Runs `validateCreate` → `beforeCreate` → insert → `afterCreate`. |
| `update(id, data, options?)` | `Promise<T>` | Throws `EntityNotFoundException` if missing. |
| `delete(id, options?)` | `Promise<boolean>` | Hard delete. |
| `softDelete(id, options?)` | `Promise<boolean>` | Requires soft delete enabled. |
| `restore(id, options?)` | `Promise<T>` | Clears the soft-delete column. |
| `forceDelete(id, options?)` | `Promise<boolean>` | Hard delete, soft-deleted or not. |
| `upsert(data, upsert?, options?)` | `Promise<T>` | Insert or update by a unique key. See [Upsert](#upsert). |
| `attach(id, relation, ids, options?)` | `Promise<T>` | Link many-to-many rows. See [Relations on writes](#relations-on-writes). |
| `detach(id, relation, ids?, options?)` | `Promise<T>` | Unlink some, or all when `ids` is left out. |
| `sync(id, relation, ids, options?)` | `Promise<T>` | Make the links exactly `ids`. |

### Bulk (run inside a transaction)

| Method | Returns |
|---|---|
| `massCreate(data[], options?)` | `Promise<T[]>` |
| `massUpdate(ids[], data, options?)` | `Promise<T[]>` |
| `massSoftDelete(ids[], options?)` | `Promise<boolean>` |
| `massRestore(ids[], options?)` | `Promise<T[]>` |
| `massDelete(ids[], options?)` | `Promise<boolean>` |
| `massForceDelete(ids[], options?)` | `Promise<boolean>` |
| `massUpsert(data[], upsert?, options?)` | `Promise<T[]>` |

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
  select?: string[];            // return only these columns; 'region.code' narrows a relation
  relations?: string[];         // eager-load these configured relations (see Relations)
  search?: {
    term: string;                // user search term
    columns: string[];           // table column keys to search
    mode?: 'ilike' | 'fullText'; // default: 'ilike'
  };
  hooks?: { skipBefore?: boolean; skipAfter?: boolean };
  lock?: 'update' | 'share' | 'none';
  forNoKeyUpdate?: boolean;
  withDeleted?: boolean;        // also return soft-deleted rows
  onlyDeleted?: boolean;        // only soft-deleted rows: the trash view
  skipAllowlists?: boolean;     // trusted, server-side call
  bulkMode?: 'set' | 'perItem'; // mass writes: one statement, or one call per item
  counts?: string[] | Record<string, true | CrudFilter>; // _count per collection
  context?: Record<string, unknown>; // what a function `scope` reads
  skipScope?: boolean;          // trusted call, without the tenant scope
  skipEvents?: boolean;         // no module-level events for this call
  expectedVersion?: number;     // optimistic locking: 409 when stale
  expectedVersions?: Record<string, number>; // the same per id, for mass writes
}
```

> `relations` eager-loads relations declared in the entity's config. See
> [Relations](#relations) and [Column selection](#column-selection).

---

## Filtering

`findAll(filters)` / `count(filters)` accept an object keyed by column name.
`null`/`undefined` values are skipped. A key that is not a column or a
configured relation, or an unknown operator, is a 400 rather than being
dropped, so a typo can never return every row.

```typescript
await service.findAll({
  status: 'active',                // string: exact match (case-insensitive on text columns)
  author_id: '1',                  // strings are fine on integer, uuid and enum columns
  role: ['admin', 'editor'],       // array: IN (...)
  age: { gte: 18, lt: 65 },        // comparison operators
  created_at: { gte: '2025-01-01' }, // date strings are parsed; an invalid date is a 400
  name: { startsWith: 'jo' },      // escaped pattern: % and _ are literal
  archived_at: { isNull: false },  // IS NOT NULL
  or: [{ team: { name: 'Core' } }, { role: 'admin' }], // OR group, relations included
  not: { tags: { name: 'internal' } },                  // NOT, here over a collection
});
```

**Operators** (inside an object value):

| Operator | SQL |
|---|---|
| `eq` | `=` (exact, case-sensitive) |
| `gt` / `gte` / `lt` / `lte` | `>` `>=` `<` `<=` |
| `neq` | `<>` |
| `like` / `ilike` | `LIKE` / `ILIKE` (`LIKE` on MySQL), **pass your own `%` wildcards** |
| `in` / `notIn` | `IN (...)` / `NOT IN (...)` |
| `between` | `BETWEEN a AND b`, `[from, to]` |
| `isNull` / `isNotNull` | `true` / `"true"` gives `IS NULL` / `IS NOT NULL`, `false` / `"false"` the opposite |
| `startsWith` / `endsWith` / `contains` | escaped `LIKE`, case-insensitive unless `sql.caseSensitive` (then `GLOB` on SQLite, whose `LIKE` ignores case) |
| `iStartsWith` / `iEndsWith` / `iContains` | escaped `ILIKE` (`LIKE` on MySQL), always case-insensitive |
| `arrayContains` / `arrayOverlaps` | PostgreSQL arrays, `@>` / `&&` |
| `jsonContains` | PostgreSQL `jsonb`, `@>` |

`and`, `or` and `not` group filter objects and nest. Each member is a full
filter, so it can hold column, relation and collection filters.

`findOne(where)` takes exact values, `null` for `IS NULL`, or an operator
object. If every value is `undefined`, or a key is not a column, it throws a 400
instead of returning an arbitrary row.

> A bare string value is an **exact** match. On a text column with
> `sql.caseSensitive` set to `false` (the default) it compares
> `lower(column) = lower(value)`, so the match is
> case-insensitive and `%` / `_` / `\` in the value are treated as literal
> characters, not wildcards. For partial or pattern matching, use the explicit
> `like` / `ilike` operators and supply your own wildcards, or `startsWith` /
> `endsWith` / `contains`, which escape the value for you.

`findOne` is the exception: it compiles a string to a plain `=`, so it is
case-sensitive whatever `sql.caseSensitive` says. A plain index on the column
cannot serve `lower(column) = lower($1)`; create one on `lower(column)`. The
[indexes page](https://crud.avytrix.dev/docs/indexes/) lists the index each
filter, sort, search and relation needs.

---

## Query strings: parseQuery

`service.parseQuery(query)` (or `parseCrudQuery(query, table, options)`) turns
an HTTP query object into the arguments `findAll` takes, coercing every value by
its Drizzle column type. An unknown column, operator, relation or sort column is
a 400 before any SQL runs.

```typescript
// GET /users?status=active&age[gte]=18&team[name]=Core&or[0][role]=admin&or[1][role]=owner
//          &sortBy=team.name,-created_at&page=2&limit=20&fields=id,name&with=team&search=jo
const q = this.users.parseQuery(query);
return q.isCursor
  ? this.users.findByCursor(q.filters, q.pagination, q.options)
  : this.users.findAll(q.filters, q.pagination, q.options);
```

Numbers, bigints, booleans and dates are coerced (a bad one is a 400), `numeric`
is checked and kept as an exact string, and text, uuid and enum stay strings.
`withDeleted` / `onlyDeleted` are only read with `allowTrash: true`. Type the
service's filter generic as `CrudFilter`.

---

## Allowlists

Per entity, in `forFeature` config. Unset lists allow everything; anything
outside a set list is a 400, in the service and in `parseQuery`:

```typescript
config: {
  filterableColumns: ['status', 'role', 'team.name'],
  sortableColumns: ['name', 'created_at', 'team.name'],
  selectableColumns: ['id', 'name', 'email', 'team.name'], // never password_hash
  searchableColumns: ['name', 'email'],
  loadableRelations: ['team'],
  writableColumns: ['name', 'email', 'role'],
}
```

Set them on every entity a client can reach. Without `writableColumns`, create
and update ignore the soft delete column, and update ignores the primary key and
`createdAt`. `skipAllowlists: true` skips the lists for a trusted call.

---

## Pagination & sorting

```typescript
await service.findAll(
  {},
  { page: 2, limit: 25, sortBy: 'created_at', sortOrder: 'desc' },
);
// → { data: [...], total: 240, page: 2, limit: 25 }
```

`limit` is capped at `pagination.maxLimit`. `sortOrder` defaults to `'asc'`.
The primary key is always the last `ORDER BY` column, so rows that tie on the
sort column never repeat or go missing between pages.

`sortBy` also takes a list, ascending unless prefixed with `-`, and a dotted
entry sorts by a belongs-to column:

```typescript
await service.findAll({}, { sortBy: ['team.name', '-created_at'] });
// LEFT JOIN teams ... ORDER BY teams.name ASC, created_at DESC, id ASC
```

### Default sort

When the caller passes no `sortBy`, `findAll` falls back to the entity's
`defaultSort`: an ordered list of columns used as the `ORDER BY` (primary
sort first, then tiebreakers). An explicit `sortBy` **replaces** the default
entirely. Per-column `order` defaults to `'asc'`; unknown columns are skipped.

```typescript
// config.defaultSort: [{ column: 'position', order: 'asc' }, { column: 'created_at', order: 'desc' }]
await service.findAll();                       // ORDER BY position ASC, created_at DESC, id ASC
await service.findAll({}, { sortBy: 'name' }); // ORDER BY name DESC, id ASC  (default ignored)
```

Set it per entity in [`forFeature`](#drizzlecrudmoduleforfeatureentities) config (or via
`@CrudService`). Alternatively, set [`defaults.sortOrder`](#drizzlecrudmoduleforrootconfig)
in `forRoot` to apply a `created_at` fallback to every entity that doesn't define its own.

---

## Cursor pagination

`findByCursor` pages with `WHERE (sort columns) > (last row)` instead of
`OFFSET`, starting with a bound on the first sort column, so with an index on
the sort columns plus the primary key (`(created_at DESC, id)` below) deep
pages stay as fast as the first, and rows inserted earlier do not shift the
next page:

```typescript
let cursor: string | null = null;
do {
  const page = await service.findByCursor({ status: 'active' }, { sortBy: ['-created_at'], limit: 50, cursor });
  handle(page.data);
  cursor = page.nextCursor; // null on the last page
} while (cursor);
```

The cursor is opaque (base64url of the sort values plus the primary key). Pass
`count: true` for a `total`. A cursor for a different sort is a 400.

---

## Relations

Three kinds of relation are supported, declared in the entity's `forFeature`
config under `relations` and keyed by relation name. Any of them can nest.

| Type | SQL | Extra queries | Result |
| --- | --- | --- | --- |
| `belongsTo` (default) | `LEFT JOIN` in the main query | 0 | object, or `null` |
| `hasMany` | `SELECT ... WHERE fk IN (parent keys)` | 1 per relation, for the whole page | array, `[]` when empty |
| `manyToMany` | `SELECT ... FROM join JOIN target ... WHERE fk IN (parent keys)` | 1 per relation, for the whole page | array, `[]` when empty |
| nested (any shape) | as above, one level down | 1 per relation per level | as above |

None of them runs a query per row, so eager loading a page of 50 rows costs the
same number of queries as a page of 5. That is the N+1 fix: ask for the relation
instead of looping.

```typescript
import { cities, countries, countryTags, regions, states, tags } from './db/schema';

DrizzleCrudModule.forFeature([
  {
    service: CountriesService,
    table: countries,
    config: {
      relations: {
        // belongs-to: countries.region_id -> regions.id (`references` defaults to 'id')
        region: { table: regions, localKey: 'region_id', references: 'id' },
        // has-many: states.country_id -> countries.id (`parentKey` defaults to the primary key)
        states: {
          table: states,
          type: 'hasMany',
          foreignKey: 'country_id',
          orderBy: [{ column: 'name', order: 'asc' }],
          // nested: eager-load with relations: ['states', 'states.cities']
          relations: {
            cities: { table: cities, type: 'hasMany', foreignKey: 'state_id' },
          },
        },
        // many-to-many: countries.id <- country_tags -> tags.id
        tags: {
          table: tags,
          type: 'manyToMany',
          through: countryTags,
          throughLocalKey: 'country_id',
          throughForeignKey: 'tag_id',
        },
      },
    },
  },
]);
```

A relation missing its required keys throws when the service is constructed,
nested relations included, with the full path in the message. A typo shows up at
startup instead of as an empty array later.

### 1. Eager loading

Pass `relations` in the operation options:

```typescript
await countries.find(1, { relations: ['region', 'states', 'states.cities', 'tags'] });
// → {
//     id: 1, name: 'India', region_id: 3,
//     region: { id: 3, name: 'Asia', code: 'AS' },
//     states: [{ id: 10, name: 'Karnataka', country_id: 1, cities: [...] }, ...],
//     tags: [{ id: '...', name: 'himalayan' }],
//   }

// 5 queries for the whole page: data, count, states, cities, tags
await countries.findAll({}, { page: 1, limit: 50 }, {
  relations: ['region', 'states', 'states.cities', 'tags'],
});
```

A dotted path loads a relation of a relation, and asking for `states.cities`
alone pulls in `states` too. An unmatched belongs-to relation is `null`, never an
object full of nulls. A parent with no children is `[]`, so callers can iterate
without a guard. Relations load concurrently, soft-deleted rows are excluded when
the related table has the configured column, and the join table of a
many-to-many never appears in the result.

### 2. Filtering by related columns

Use the relation name as a filter key with a nested object of the **related
table's** columns. Supports the same [operators](#filtering) as normal filters:

```typescript
// belongs-to: filtered through the join
await cities.findAll({ state: { name: 'Karnataka' } });
await cities.findAll({ name: { ilike: 'B%' }, state: { country_id: 3 } });

// has-many: countries.id IN (SELECT country_id FROM states WHERE ...)
await countries.findAll({ states: { name: 'Kerala' } });

// many-to-many: through the join table, still a subquery
await countries.findAll({ tags: { name: 'himalayan' } });
```

A collection is never joined, on a filter or on an eager load. One country with
four states would become four rows, `count(*)` would return 4 instead of 1, and
`limit` would cut a country in half. The subquery and the batched load keep one
row per parent, so `total` and pagination stay correct.

A filter can go on through the related table's own relations, at any depth.
Below the first joined belongs-to, each level is an `EXISTS` subquery:

```typescript
await cities.findAll({ state: { country: { code: 'IN' } } }); // ?state[country][code]=IN
```

A collection takes `some` (the default), `none` or `every`, which compile to
`IN` / `NOT EXISTS` subqueries and work inside `or` / `not` groups and `count`:

```typescript
await authors.findAll({ posts: { none: { status: 'draft' } } });
await authors.findAll({ posts: { every: { status: 'published' } } }); // also authors with no posts
await authors.findAll({ posts: { some: {} } });                         // has at least one
```

> `orderBy` sorts a collection but does not limit it per parent, and a join
> table's own columns are not returned. Model a join table that carries data as
> an entity with two belongs-to relations.

---

## Column selection

Pass `options.select` and the query stops being `SELECT *`. A dotted entry
narrows an eager-loaded relation:

```typescript
await countries.findAll({}, { page: 1, limit: 20 }, { select: ['id', 'name'] });
// SELECT "id", "name" FROM "countries" ...

await countries.findAll({}, { page: 1, limit: 20 }, {
  relations: ['region', 'states', 'states.cities'],
  select: ['id', 'name', 'region.code', 'states.name', 'states.cities.name'],
});
// → { id, name, region: { code }, states: [{ name, country_id, id, cities: [{ name, state_id }] }] }
```

Rules:

- A dotted entry only applies when the relation is also in `options.relations`.
  Paths can be any depth: `'states.cities.name'`.
- Names that don't match a real column are ignored, not rejected.
- If every entry is dotted, the base row is returned in full, so
  `select: ['region.name']` reads as "narrow the region".
- The parent key, each child's foreign key and any key a nested level needs are
  added back automatically, because the grouping needs them.

`select` applies to `find`, `findOne` and `findAll`. Write methods return the
full row through `RETURNING`.

---

## Primary keys (serial / uuid)

Each entity names its primary key via `primaryKey` (the column key, default
`id`). Both auto-increment and UUID keys are supported, and the type comes from
the Drizzle column. `primaryKeyType` is deprecated and has no effect.

```typescript
// serial / auto-increment (default)
{ service: UsersService, table: users }   // primaryKey 'id'

// UUID
{
  service: TagsService,
  table: tags,                  // e.g. uuid('id').primaryKey().defaultRandom()
}
```

On PostgreSQL the created row (including a DB-generated UUID) is returned via
`RETURNING`. On MySQL (no `RETURNING`), provide the UUID in your create payload
so the row can be re-read. Auto-increment keys use the driver's `insertId`.

> With UUID keys, route params are strings, so don't apply
> `ParseIntPipe` in your controller.

---

## Soft delete

Enable per-project via `defaults.softDelete` or per-entity via `forFeature` config:

```typescript
{ service: UsersService, table: users, config: { softDelete: { enabled: true, column: 'deleted_at' } } }
```

- `softDelete(id)` sets the column to the current timestamp.
- `restore(id)` sets it back to `null`.
- `find`/`findOne`/`findAll`/`count` automatically exclude soft-deleted rows,
  and a soft-deleted belongs-to parent comes back as `null`.
- `column` is the key in your Drizzle table object (`deletedAt` for
  `deletedAt: timestamp('deleted_at')`). A key the table lacks fails at startup.
- The trash view: pass `onlyDeleted: true` (or `withDeleted: true` for both)
  to any read, e.g. `findAll({}, {}, { onlyDeleted: true })`.
- `forceDelete(id)` / `massForceDelete(ids)` hard-delete rows whether they are
  in the trash or not. `delete(id)` answers 404 for a row in the trash.

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

Each bulk method is one statement for the whole set (plus one `SELECT` that
checks the ids exist), inside a single transaction: `massUpdate` over 100 ids is
two queries. If any item fails, a `BulkOperationException` (400) is thrown and
the transaction rolls back. The failing items are found by replaying the batch
in a transaction (or, inside your own transaction, a savepoint) that is rolled
back, and the response body lists only them. The happy path sends no savepoint
unless it runs inside your transaction:

```json
{ "statusCode": 400, "error": "Bad Request",
  "message": "Mass create errors. 1 error(s) occurred.",
  "errors": [{ "index": 1, "status": 409, "message": "users with email 'a@x.io' already exists" }] }
```

`bulkMode: 'perItem'` runs the single-row method per item instead, as in 3.3.

One statement may bind at most 65,535 values on PostgreSQL and MySQL, 32,766 on
SQLite and 100 on Cloudflare D1. The service counts the real statement (every
column, version check and OR'd list included) and answers one past the limit
with a 400 that names both numbers, before it runs. Split larger batches.

---

## Upsert

```typescript
await users.upsert(
  { email: 'ada@example.com', name: 'Ada' },
  { conflictTarget: 'email' },          // update: [...] limits the overwritten columns
);
await users.massUpsert(rows, { conflictTarget: 'email' });
```

`ON CONFLICT DO UPDATE` on PostgreSQL, `ON DUPLICATE KEY UPDATE` on MySQL. A
clash on another unique key is a 409, bad input a 400.

---

## Relations on writes

Writes take `relations` and `counts` like reads, and load them with the same
batched loaders, one query per relation for the whole batch:

```typescript
const post = await posts.create(dto, { relations: ['author', 'tags'] });
await posts.massCreate(rows, { relations: ['author'] }); // 1 INSERT + 1 SELECT
```

A create body can also write relations listed in `writableRelations`, inside one
transaction: an array for a has-many, an object for a belongs-to, ids or objects
for a many-to-many.

```typescript
// forFeature config: writableRelations: ['posts', 'tags']
await authors.create({ name: 'Ada', posts: [{ title: 'One' }, { title: 'Two' }] });
await posts.create({ title: 'Tagged', tags: [1, { name: 'new' }] });
```

Many-to-many links change with set-based `attach`, `detach` and `sync`, which
return the row with the relation loaded:

```typescript
await posts.attach(1, 'tags', [2, 3]);
await posts.detach(1, 'tags', [3]);   // or detach(1, 'tags') for all
await posts.sync(1, 'tags', [2]);     // exactly these
```

---

## Controller factory

`createCrudController(Service, options)` builds a controller with list (offset,
or keyset with `?cursor=`), `GET /trash`, get, create, update, delete,
`POST /:id/soft-delete`, `POST /:id/restore` and, when you turn them on, the bulk
routes. `:id` is parsed from the primary key column: `ParseIntPipe` for an
integer, `ParseUUIDPipe` for a uuid.

```typescript
@Controller('projects')
export class ProjectsController extends createCrudController(ProjectsService, {
  dto: { create: CreateProjectDto, update: UpdateProjectDto },
  routes: { bulkCreate: true, delete: { decorators: [UseGuards(AdminGuard)] } },
  decorators: [UseGuards(AuthGuard)],
  deleteMode: 'soft',
}) {}
```

---

## OpenAPI (Swagger)

`@ApiCrudList(source)` documents a list route: `page`, `limit`, `sortBy`,
`cursor`, `withCount`, `fields`, `with`, `counts`, `search` and one parameter per
filterable column, plus the page envelope. `@ApiCrudQuery(source)` adds only the
parameters. `@nestjs/swagger` is an optional peer, loaded only when a decorator
runs.

```typescript
@Get()
@ApiCrudList({ table: countries, ...countriesConfig })
findAll(@Query() query: Record<string, unknown>) { ... }
```

---

## Multi-tenancy: scope

A `scope` is ANDed into every read, count and write, bulk and upsert included,
and written onto every row a create inserts. Another tenant's id is a 404.

```typescript
// forFeature config
scope: (ctx) => ({ tenant_id: ctx.tenantId }),

// per request, in a NestModule
consumer
  .apply(CrudContext.middleware((req) => ({ tenantId: req.user?.tenantId })))
  .forRoutes('*');

// or per call
await docs.findAll({}, {}, { context: { tenantId: 7 } });
```

A missing context value is a 403 (`MissingScopeException`), never an unscoped
query. A resolver that returns `null`, or `skipScope: true`, runs unscoped on
purpose. A belongs-to key that a write sets must point at a row of the same
tenant when the related table has the scope columns: another tenant's row is the
same 400 `ForeignKeyViolationException` as a missing one.

---

## Events and global hooks

With `hooks.enableGlobalHooks: true`, every service raises a before and an after
event on the injectable `CrudEventBus` for each write. A bulk call raises one
event with `bulk: true` and every id.

```typescript
DrizzleCrudModule.forRoot({
  dialect: 'postgresql', connectionString,
  hooks: { enableGlobalHooks: true },
});

@Injectable()
export class Audit implements OnModuleInit {
  constructor(private readonly bus: CrudEventBus) {}
  onModuleInit() {
    this.bus.subscribe({
      afterWrite: (e) => this.log(e.entity, e.operation, e.ids),
    });
  }
}
```

A before listener that throws stops the write; an after listener that throws
inside a transaction rolls it back. The per-service hooks run as before.

---

## Optimistic locking

```typescript
// forFeature config
versionColumn: 'version',

await docs.update(1, { title: 'New', version: 3 }); // 409 if the row is past 3
await docs.delete(1, { expectedVersion: 4 });
await docs.massUpdate([1, 2], data, { expectedVersions: { '1': 4, '2': 7 } });
```

The version starts at 1 and goes up on every update, soft delete, restore,
upsert conflict and bulk write. A stale one is a 409 `StaleVersionException`.

---

## Counts and grouped counts

```typescript
await authors.findAll({}, {}, { counts: ['posts'] });
// [{ id: 1, name: 'Ann', _count: { posts: 10 } }, ...]
await authors.findAll({}, {}, { counts: { posts: { status: 'published' } } });

await posts.countBy('status');            // [{ value: 'draft', count: 15 }, ...]
await posts.countBy('author.name', { status: 'published' });
```

Each count is one `GROUP BY` query for the whole result, never one per row, and
skips soft-deleted related rows. `findAll(filters, { withCount: false })` skips
the `COUNT(*)`: `total` is `null` and `hasMore` tells you if another page follows.

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
orders by `ts_rank`. Throws a 400 if the dialect is not `postgresql`. The options
take `filters`, `relations`, `select` and `counts` as on `findAll`, plus
`language` (default `'english'`) and `queryMode: 'websearch'` for
`websearch_to_tsquery`:

```typescript
await service.fullTextSearch('"zero downtime" -kubernetes', ['title', 'body'], {}, {
  filters: { status: 'published' },
  relations: ['author'],
  language: 'english',
  queryMode: 'websearch',
});
```

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
import { TestCrudFactory } from '@avytrix/nestjs-drizzle-crud';

const mockDb = TestCrudFactory.createMockDb();
const mockTable = TestCrudFactory.createMockTable();
const service = TestCrudFactory.createTestService(UsersService, mockDb, mockTable);
```

`TestCrudFactory` provides `createMockDb()`, `createMockTable()`,
`createMockEntity()` and `createTestService()` for unit tests without a database.

---

## For AI agents / LLM tools

### Point your agent at the rules

`AGENT.md` ships inside the package and holds the rules agents should follow
when they use it. Copy the pointer template to the filename your tool reads:

```bash
cp node_modules/@avytrix/nestjs-drizzle-crud/AGENTS.template.md ./AGENTS.md   # Codex, Cursor, Copilot, Zed, Cline, Windsurf
cp node_modules/@avytrix/nestjs-drizzle-crud/CLAUDE.template.md ./CLAUDE.md   # Claude Code
# Gemini CLI reads ./GEMINI.md, Aider reads ./CONVENTIONS.md
```

Each template is one `@node_modules/@avytrix/nestjs-drizzle-crud/AGENT.md` line, so an
upgrade updates the rules with it and you never hold a stale copy.

### Or run the MCP server

```bash
npx -p @avytrix/nestjs-drizzle-crud nestjs-drizzle-crud-mcp
```

A stdio MCP server, zero dependencies, that serves this package's docs to any MCP
client through three tools: `list_docs`, `get_doc` (`agent-guide` / `readme` /
`changelog`, optionally one section) and `search_docs`. Register it the usual way:

```json
{
  "mcpServers": {
    "nestjs-drizzle-crud": {
      "command": "npx",
      "args": ["-y", "-p", "@avytrix/nestjs-drizzle-crud", "nestjs-drizzle-crud-mcp"]
    }
  }
}
```

That shape works for Claude Code (`.mcp.json`), Cursor (`.cursor/mcp.json`),
Windsurf, Gemini CLI and Cline. VS Code and Copilot use `.vscode/mcp.json` with
the entries under `servers`; Codex uses `[mcp_servers.*]` in
`~/.codex/config.toml`; Zed uses a `context_servers` entry. The server is
read-only and never touches your database. Full setup:
[crud.avytrix.dev/docs/ai-agents](https://crud.avytrix.dev/docs/ai-agents).

### Facts for code generation

Use these facts instead of guessing.

**Package:** `nestjs-drizzle-crud` · **Peers:** `@nestjs/common`, `@nestjs/core`, `drizzle-orm`, `reflect-metadata`; optional `postgres` (PG `connectionString`) / `mysql2` (MySQL `connectionString`) / `@nestjs/swagger` (for `ApiCrudList`). SQLite drivers are yours, passed as `db`.

**Setup is two steps and no per-service connection wiring:**
1. `DrizzleCrudModule.forRoot({ dialect, connectionString | db, schema, defaults })` once in `AppModule`.
2. `DrizzleCrudModule.forFeature([{ service, table, config? }])` in each feature module.

**A service is an empty subclass. Do NOT inject the db or pass `dialect`/`db`:**
```typescript
export class XService extends SqlBaseCrudService<X, CreateXDto, UpdateXDto, XFilterDto> {}
```

**Rules / gotchas:**
- Generics order: `SqlBaseCrudService<Entity, CreateDto, UpdateDto, FilterDto>`. All but `Entity` default to `Partial<Entity>`.
- Do **not** add an `@Inject('DRIZZLE_DB')` constructor: `forFeature` constructs the service for you. A constructor that calls `super({...})` is the old manual pattern and is not needed.
- The table is passed in `forFeature`, **not** in the service.
- If tables lack timestamp/soft-delete columns, set `defaults: { softDelete: false, timestamps: false }`. The settings name table **keys** (`deletedAt`, not `deleted_at`, for a camelCase schema), and a missing key fails at startup.
- `findAll` returns `{ data, total, page, limit }`, not a bare array.
- Filter operators live inside an object value: `{ age: { gte: 18 } }`. `like`/`ilike` require caller-supplied `%` wildcards; `startsWith`/`endsWith`/`contains` escape the value; a bare string is exact match. Also `notIn`, `between`, the `i` pattern forms and, on PostgreSQL, `arrayContains`/`arrayOverlaps`/`jsonContains`. `or`/`and`/`not` group filters and nest. An unknown filter key or operator is a 400; `{ isNull: false }` is `IS NOT NULL`.
- In a controller, `service.parseQuery(@Query() query)` builds filters, pagination and options from the query string; use `findByCursor` when `isCursor` is true. Set the allowlists (`filterableColumns`, `sortableColumns`, `selectableColumns`, `searchableColumns`, `loadableRelations`, `writableColumns`) on any entity a client can reach.
- Soft-deleted rows: `onlyDeleted: true` / `withDeleted: true` on any read; `forceDelete(id)` purges. Bulk methods are one statement per set; `upsert(dto, { conflictTarget })` exists.
- `delete`/`softDelete` return `boolean`; `update`/`restore` return the entity and throw `EntityNotFoundException` when missing.
- Postgres error codes are translated for you: `23505` unique -> 409, `22001`/`23514`/`22003`/`22P02`/`22007`/`22008` bad value -> 400 (reads included), `23503` on create/update (missing FK target) -> 400 `ForeignKeyViolationException`, `23503` on delete (still referenced) -> 409 `EntityInUseException`.
- Relations on writes: `create`/`update`/`upsert`/mass writes take `relations` and `counts`. Nested create only for relations in `writableRelations`; many-to-many links change with `attach`/`detach`/`sync`.
- Controllers: prefer `createCrudController(Service, { dto, routes, decorators })` over hand-written CRUD routes. The id pipe follows the primary key.
- Multi-tenant data: set `scope: (ctx) => ({ tenant_id: ctx.tenantId })` and fill the context with `CrudContext.middleware`. Do not add `tenant_id` filters by hand.
- `hooks.enableGlobalHooks: true` + `CrudEventBus.subscribe` for audit and cache busting; one event per bulk call.
- `versionColumn` for optimistic locking: a stale `version` in the body or `expectedVersion` is a 409.
- `options.counts: ['posts']` gives `_count`; `countBy(column)` gives grouped counts; `withCount: false` skips `COUNT(*)`.
- Relations: declare in forFeature `config.relations` and eager-load via `options.relations: ['relName']`, where a dotted path nests (`['states', 'states.cities']`, `['state.country']`; the parent path is pulled in automatically). Belongs-to is `{ table, localKey, references? }`, LEFT JOINed into the main query, resolving to an object or `null`. Has-many is `{ table, type: 'hasMany', foreignKey, parentKey?, orderBy? }`. Many-to-many is `{ table, type: 'manyToMany', through, throughLocalKey, throughForeignKey, references?, parentKey?, orderBy? }`. Nested relations live in a `relations` map on the relation. Every collection and every nested level costs exactly one extra query for the whole result set, never one per row. Filter via `findAll({ relName: { col: value } })` with the same operators; collection filters compile to `parentKey IN (SELECT ... WHERE ...)`, so `total` stays correct. Filters go through relation paths at any depth (`{ state: { country: { code: 'IN' } } }`), and collections take `some` / `none` / `every` (`{ posts: { none: { status: 'draft' } } }`), compiled to subqueries.
- `options.select` narrows the projection and takes dotted relation paths at any depth: `['id', 'name', 'region.code', 'states.cities.name']`. Unknown names are ignored; an all-dotted list leaves the base row complete; the parent key, the child foreign key and any nested key are re-added automatically.
- Primary keys: `primaryKey` (default `'id'`) per entity in forFeature config (`primaryKeyType` is deprecated and does nothing). UUID works on Postgres via RETURNING; with uuid keys, route params are strings, so don't use `ParseIntPipe`.
- Full-text search is PostgreSQL-only; it takes `filters`, `relations`, `select`, `language` and `queryMode` in its options.
- SQLite (`dialect: 'sqlite'`): pass `db`. Bulk writes need libSQL; D1 and sync drivers throw `TransactionException`. Locks, full-text and array/JSON operators are a 400.
- Exports (3.7): `DrizzleConnectionOptions`, `DrizzleCrudAsyncOptions`, `DrizzleCrudOptionsFactory`, `FullTextOptions`, `FullTextQueryMode`, `FullTextSearchOptions`.
- Exports (3.5): `createCrudController`, `CrudContext`, `CrudEventBus`, `ApiCrudQuery`, `ApiCrudList`, `MissingScopeException`, `StaleVersionException`, and the types `CrudControllerOptions`, `CrudEvent`, `CrudSubscriber`, `CrudScope`, `CollectionFilter`, `CountByRow`, `CrudPage`, `UncountedCrudPage`, `RelationCounts`.
- Exports: `SqlBaseCrudService`, `DrizzleCrudModule`, `DRIZZLE_DB`, `DRIZZLE_CRUD_CONFIG`, `TestCrudFactory`, exceptions (`EntityNotFoundException`, `DuplicateEntityException`, `ForeignKeyViolationException`, `EntityInUseException`, `ValidationFailedException`, `BulkOperationException`, `TransactionException`, plus the deprecated `DatabaseConnectionException`), and types (`SqlCrudConfig`, `SqlOperationOptions`, `DrizzleCrudConfig`, `CrudFeature`, `CrudFeatureConfig`, `PaginationOptions`, `OperationOptions`, `SqlSearchOptions`, `SqlSearchMode`, `BulkOperationResult`, `BulkOperationItemError`, `SqlDialect`, `PrimaryKeyType`, `CrudFilter`, `FilterOperators`, `SortInput`, `CursorPaginationOptions`, `CursorPage`, `CrudAllowlists`, `UpsertOptions`, `BulkMode`, `ParsedCrudQuery`), and `parseCrudQuery`.

### `SqlCrudConfig`

```typescript
interface SqlCrudConfig {
  dialect: 'postgresql' | 'mysql' | 'sqlite';
  db: any;                         // Drizzle instance (injected by forFeature)
  table: any;                      // Drizzle table (set by forFeature)
  primaryKey: string;              // default 'id'
  primaryKeyType?: 'serial' | 'bigserial' | 'int' | 'bigint' | 'uuid'; // deprecated, no effect
  softDelete?: { enabled: boolean; column: string };   // column: the table key
  timestamps?: { createdAt: string; updatedAt: string }; // table keys
  pagination?: { defaultLimit: number; maxLimit: number };
  sql?: { caseSensitive: boolean; useReturning: boolean; jsonSupport: boolean; enableFullTextSearch: boolean }; // last two deprecated
  relations?: Record<string, {
    table: any;
    type?: 'belongsTo' | 'hasMany' | 'manyToMany';
    localKey?: string;             // belongs-to: FK column on this table
    references?: string;           // target column, default 'id'
    foreignKey?: string;           // has-many: column on the target table
    parentKey?: string;            // collections: column here it matches, default primaryKey
    through?: any;                 // many-to-many: the join table
    throughLocalKey?: string;      // many-to-many: join column matching parentKey
    throughForeignKey?: string;    // many-to-many: join column matching references
    orderBy?: SortColumn[];        // collections: order the children in SQL
    relations?: RelationsConfig;   // nested relations, addressed as 'rel.child'
  }>;
  // Allowlists: unset allows everything, anything outside a set list is a 400
  filterableColumns?: string[];
  sortableColumns?: string[];
  selectableColumns?: string[];
  searchableColumns?: string[];
  loadableRelations?: string[];
  writableColumns?: string[];
  writableRelations?: string[];   // nested create; attach/detach/sync when set
  scope?: Record<string, unknown> | ((ctx) => Record<string, unknown> | null);
  versionColumn?: string;         // optimistic locking
  events?: CrudEventBus;          // set by the module with enableGlobalHooks
}
```

---

## Support

- **Docs:** [crud.avytrix.dev](https://crud.avytrix.dev), including a
  [FAQ and where-to-ask guide](https://crud.avytrix.dev/docs/getting-help).
- **Questions:** [GitHub Discussions](https://github.com/avytrix/nestjs-drizzle-crud/discussions).
- **Bugs:** [open an issue](https://github.com/avytrix/nestjs-drizzle-crud/issues/new/choose)
  with the version, dialect, table definition and the call you made.
- **Security:** follow [SECURITY.md](https://github.com/avytrix/nestjs-drizzle-crud/blob/main/SECURITY.md),
  never a public issue.
- **AI agents:** this package ships `AGENT.md` plus an MCP server. See
  [For AI agents / LLM tools](#for-ai-agents--llm-tools).
- **Sponsor:** [github.com/sponsors/avytrix](https://github.com/sponsors/avytrix).

---

## License

MIT 
