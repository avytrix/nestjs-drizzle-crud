/**
 * nestjs-drizzle-crud - Complete CRUD abstraction for Drizzle ORM in NestJS
 * @package nestjs-drizzle-crud
 */

// Re-export common Drizzle types for convenience
export {
	and,
	asc,
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
	or,
	sql,
} from "drizzle-orm";
// Core abstractions
export { SqlBaseCrudService } from "./core/abstract/sql-base-crud.service";
export type { ICrudService } from "./core/interfaces/crud-service.interface";
export type {
	CrudFeature,
	DrizzleCrudConfig,
} from "./core/interfaces/drizzle-crud-config.interface";
// Configuration interfaces
export type {
	RelationConfig,
	RelationsConfig,
	RelationType,
	SqlCrudConfig,
	SqlOperationOptions,
} from "./core/interfaces/sql-crud-config.interface";
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
export {
	BulkOperationException,
	DatabaseConnectionException,
	DuplicateEntityException,
	EntityInUseException,
	EntityNotFoundException,
	ForeignKeyViolationException,
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
// Test utilities
export { BaseCrudSpecHelper } from "./test-utils/base-crud.spec-helper";
export { TestCrudFactory } from "./test-utils/test-factory";
