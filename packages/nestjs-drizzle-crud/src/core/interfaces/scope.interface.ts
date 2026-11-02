// Tenant and ownership scoping.
//
// A scope is a set of `column: value` pairs that every row of the entity must
// match. It is ANDed into every read, count and write, and written onto every
// row a create or upsert inserts, so a query for another tenant's row finds
// nothing (a 404) instead of the row.

// What a scope resolver reads: anything your app puts there, usually from the
// request (`{ tenantId, userId }`). Pass it per call as `options.context`, or
// for a whole request with `CrudContext.run` / `CrudContext.middleware`.
export type CrudContextValue = Record<string, unknown>;

// The `column: value` pairs of a scope. A value is an exact match; `null`
// means IS NULL. `undefined` is a missing context value and fails closed with
// a 403 (MissingScopeException).
export type CrudScopeValues = Record<string, unknown>;

// A fixed scope, or a function of the context. A function that returns `null`
// leaves that call unscoped on purpose (an admin, a background job).
export type CrudScope =
	| CrudScopeValues
	| ((context: CrudContextValue) => CrudScopeValues | null);
