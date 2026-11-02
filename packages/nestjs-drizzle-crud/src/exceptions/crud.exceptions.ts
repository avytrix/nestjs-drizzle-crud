import {
	BadRequestException,
	ConflictException,
	ForbiddenException,
	HttpException,
	InternalServerErrorException,
	NotFoundException,
} from "@nestjs/common";

// These extend NestJS HttpException subclasses so the framework's default
// exception filter maps them to the right HTTP status automatically:
//   not found -> 404, duplicate -> 409, validation/bulk -> 400.
// (@nestjs/common is a peer dependency.)

export class EntityNotFoundException extends NotFoundException {
	constructor(entityName: string, id: any) {
		super(`${entityName} with id ${id} not found`);
		this.name = "EntityNotFoundException";
	}
}

export class DuplicateEntityException extends ConflictException {
	constructor(entityName: string, field: string, value: any) {
		super(`${entityName} with ${field} '${value}' already exists`);
		this.name = "DuplicateEntityException";
	}
}

export class ValidationFailedException extends BadRequestException {
	constructor(message: string) {
		super(`Validation failed: ${message}`);
		this.name = "ValidationFailedException";
	}
}

// A client-supplied foreign key that points at no existing row is bad input,
// so this is a 400 rather than a 500. Raised by create/update on Postgres 23503.
export class ForeignKeyViolationException extends BadRequestException {
	constructor(entityName: string, field: string) {
		super(
			`Invalid reference for ${entityName}: '${field}' does not refer to an existing record`,
		);
		this.name = "ForeignKeyViolationException";
	}
}

// The other direction of 23503: the row cannot be deleted because other rows
// still reference it (ON DELETE RESTRICT / NO ACTION). That is a conflict, 409.
export class EntityInUseException extends ConflictException {
	constructor(entityName: string) {
		super(
			`${entityName} is still referenced by other records and cannot be deleted`,
		);
		this.name = "EntityInUseException";
	}
}

// Optimistic locking: the row is no longer at the version the caller read,
// because someone else wrote it in between. Read it again and retry. 409.
export class StaleVersionException extends ConflictException {
	constructor(entityName: string, id: any) {
		super(
			`${entityName} with id ${id} was changed by someone else; read it again and retry`,
		);
		this.name = "StaleVersionException";
	}
}

// A scoped entity was used without the context its scope needs (no tenant on
// the request, say). The call fails closed instead of running unscoped. 403.
export class MissingScopeException extends ForbiddenException {
	constructor(entityName: string, key: string) {
		super(
			`${entityName} is scoped by "${key}", but the context has no value for it`,
		);
		this.name = "MissingScopeException";
	}
}

// One failed item of a bulk operation, as it appears in the HTTP response:
// `index` for massCreate (the position in the input array), `id` for the
// others, plus the status and message that item alone would have produced.
export interface BulkOperationItemError {
	index?: number;
	id?: any;
	status: number;
	message: string;
}

// Turn a caught error into its response entry. An HttpException keeps its own
// status and message. Anything else is reported as a 500 with a generic
// message: a raw driver error can carry SQL and parameters, which do not
// belong in a response body. The original error stays on `errors`.
function toItemError(item: {
	id?: any;
	index?: number;
	error: Error;
}): BulkOperationItemError {
	const where =
		item.index !== undefined ? { index: item.index } : { id: item.id };
	if (item.error instanceof HttpException) {
		return {
			...where,
			status: item.error.getStatus(),
			message: item.error.message,
		};
	}
	return { ...where, status: 500, message: "Internal server error" };
}

// A 400 whose body lists every failed item:
// { statusCode, error, message, errors: [{ index | id, status, message }] }.
export class BulkOperationException extends BadRequestException {
	constructor(
		message: string,
		public readonly errors: Array<{ id?: any; index?: number; error: Error }>,
	) {
		super({
			statusCode: 400,
			error: "Bad Request",
			message: `${message}. ${errors.length} error(s) occurred.`,
			errors: errors.map(toItemError),
		});
		this.name = "BulkOperationException";
	}
}

/**
 * @deprecated Nothing in the package throws this. It stays exported so existing
 * imports keep compiling, and will be removed in the next major version.
 */
export class DatabaseConnectionException extends InternalServerErrorException {
	constructor(message: string = "Database connection failed") {
		super(message);
		this.name = "DatabaseConnectionException";
	}
}

/**
 * The database driver cannot run the transaction a call needs: Cloudflare D1
 * (no interactive transactions) or a synchronous SQLite driver. A transaction
 * that fails while it runs still rejects with the error that caused it.
 */
export class TransactionException extends InternalServerErrorException {
	constructor(message: string = "Transaction failed") {
		super(message);
		this.name = "TransactionException";
	}
}
