import type { CrudFeatureConfig } from "nestjs-drizzle-crud";

// One config for both forFeature and the OpenAPI docs of the controller.
export const projectsCrud = {
	primaryKey: "id",
	// Soft delete is off project wide (app.module.ts) and on here.
	softDelete: { enabled: true },
	// Every read and write is limited to the tenant of the request, which
	// CrudContext.middleware puts in the context (projects.module.ts).
	scope: (ctx) => ({ tenant_id: ctx.tenantId }),
	// A PATCH that sends a stale `version` is a 409.
	versionColumn: "version",
	defaultSort: [{ column: "name", order: "asc" }],
	filterableColumns: ["name", "created_at"],
	sortableColumns: ["name", "created_at"],
	searchableColumns: ["name"],
	writableColumns: ["name"],
} satisfies CrudFeatureConfig;
