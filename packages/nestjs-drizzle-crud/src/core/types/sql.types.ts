export type SqlDialect = "postgresql" | "mysql" | "sqlite";
export type PrimaryKeyType = "serial" | "bigserial" | "int" | "bigint" | "uuid";

export type SortOrder = "asc" | "desc";

// One column of a default ORDER BY applied by findAll() when the caller passes no
// sortBy. `column` must exist on the entity's table (unknown columns are skipped);
// `order` defaults to "asc".
export interface SortColumn {
	column: string;
	order?: SortOrder;
}
