/**
 * nestjs-drizzle-crud - Complete CRUD abstraction for Drizzle ORM in NestJS
 * @package nestjs-drizzle-crud
 */

// Re-export common Drizzle types for convenience
export {
	and,
	asc,
	between,
	desc,
	eq,
	gt,
	gte,
	ilike,
	inArray,
	isNotNull,
	isNull,
	like,
	lt,
	lte,
	ne,
	not,
	notInArray,
	or,
	sql,
} from "drizzle-orm";
// Controller factory
export type {
	CrudControllerInstance,
	CrudControllerOptions,
	CrudRouteName,
	CrudRouteOptions,
} from "./controller/crud-controller.factory";
export { createCrudController } from "./controller/crud-controller.factory";
// Core abstractions
export { SqlBaseCrudService } from "./core/abstract/sql-base-crud.service";
// Request context for scoped entities
export { CrudContext } from "./core/context/crud-context";
// Module-level events
export { CrudEventBus } from "./core/events/crud-event-bus";
export type {
	BulkOperationResult,
	ICrudService,
	OperationOptions,
	PaginationOptions,
} from "./core/interfaces/crud-service.interface";
export type {
	CrudFeature,
	CrudFeatureConfig,
	DrizzleCrudConfig,
} from "./core/interfaces/drizzle-crud-config.interface";
export type {
	CrudEvent,
	CrudEventPhase,
	CrudSubscriber,
	CrudWriteOperation,
} from "./core/interfaces/events.interface";
// Query, filter, cursor, allowlist and upsert types
export type {
	BulkMode,
	CollectionFilter,
	CollectionQuantifier,
	ColumnFilter,
	CountByRow,
	CrudAllowlists,
	CrudFilter,
	CrudPage,
	CursorPage,
	CursorPaginationOptions,
	FilterGroup,
	FilterOperator,
	FilterOperators,
	FilterScalar,
	ParseCrudQueryOptions,
	ParsedCrudQuery,
	RelationCounts,
	SortInput,
	UncountedCrudPage,
	UpsertOptions,
} from "./core/interfaces/query.interface";
export type {
	CrudContextValue,
	CrudScope,
	CrudScopeValues,
} from "./core/interfaces/scope.interface";
// Configuration interfaces
export type {
	RelationConfig,
	RelationNode,
	RelationsConfig,
	RelationType,
	SelectTree,
	SqlCrudConfig,
	SqlOperationOptions,
	SqlSearchMode,
	SqlSearchOptions,
} from "./core/interfaces/sql-crud-config.interface";
// Query string parser
export { parseCrudQuery } from "./core/utils/query-parser";
// Types
export type {
	PrimaryKeyType,
	SortColumn,
	SortOrder,
	SqlDialect,
} from "./core/types/sql.types";
// Decorators
export { CrudService } from "./decorators/crud-service.decorator";
// Exceptions
export type { BulkOperationItemError } from "./exceptions/crud.exceptions";
export {
	BulkOperationException,
	DatabaseConnectionException,
	DuplicateEntityException,
	EntityInUseException,
	EntityNotFoundException,
	ForeignKeyViolationException,
	MissingScopeException,
	StaleVersionException,
	TransactionException,
	ValidationFailedException,
} from "./exceptions/crud.exceptions";
// Module
export { DrizzleCrudModule } from "./modules/drizzle-crud.module";
export {
	DRIZZLE_CONNECTION,
	DRIZZLE_CRUD_CONFIG,
	DRIZZLE_DB,
	DrizzleConnection,
} from "./modules/drizzle-connection";
// OpenAPI decorators (need the optional peer @nestjs/swagger when used)
export type {
	ApiCrudQueryOptions,
	ApiCrudSource,
} from "./openapi/api-crud.decorators";
export { ApiCrudList, ApiCrudQuery } from "./openapi/api-crud.decorators";
// Test utilities
export { BaseCrudSpecHelper } from "./test-utils/base-crud.spec-helper";
export { TestCrudFactory } from "./test-utils/test-factory";
