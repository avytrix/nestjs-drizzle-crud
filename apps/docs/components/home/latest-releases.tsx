import Link from "next/link";
import { ArrowRight } from "lucide-react";

// Newest first; the top banner announces RELEASES[0].
export const RELEASES = [
	{
		version: "3.6.0",
		date: "Nov 2, 2026",
		title: "Relations follow the tenant scope",
		body: "Loaded relations, joins, relation filters and counts only see rows of the caller's tenant. Bulk routes validate their bodies against the DTOs, route decorators that wrap the handler run, and deep filters, huge batches, missing values and MySQL duplicates are 400s and 409s instead of 500s.",
	},
	{
		version: "3.5.2",
		date: "Nov 2, 2026",
		title: "Sort default, 400s and scoped counts",
		body: "A bare sortBy now sorts ascending in findAll, the same as ?sortBy= over HTTP. Soft delete calls on an entity without soft delete, and full-text search on MySQL, are 400s instead of 500s. Relation counts only count rows in the caller's tenant.",
	},
	{
		version: "3.5.1",
		date: "Nov 2, 2026",
		title: "Published as @avytrix/nestjs-drizzle-crud",
		body: "The package moves to the @avytrix scope with the same code as 3.5.0. Swap the dependency and the imports for @avytrix/nestjs-drizzle-crud; the MCP server runs with npx -p @avytrix/nestjs-drizzle-crud nestjs-drizzle-crud-mcp. The unscoped name is deprecated.",
	},
	{
		version: "3.5.0",
		date: "Nov 2, 2026",
		title: "Controller factory, tenancy, events, locking",
		body: "createCrudController wires every CRUD route with the right id pipe, and ApiCrudList documents list queries in Swagger. A scope keeps every read and write inside one tenant, global events cover bulk writes, a version column turns stale writes into 409s, and filters reach through relation paths with some, none and every. Writes return their relations, lists can count relations or skip COUNT(*).",
	},
	{
		version: "3.4.0",
		date: "Nov 2, 2026",
		title: "Query parsing, allowlists, cursors, upsert",
		body: "parseQuery turns a query string into typed filters, allowlists keep clients to the columns you choose, and findByCursor pages without OFFSET. Filters gain or / not groups and new operators, sortBy takes several columns or a relation column, soft-deleted rows can be listed and purged, and bulk writes are one statement for the whole set.",
	},
	{
		version: "3.3.1",
		date: "Nov 2, 2026",
		title: "Audit fixes: filters, soft delete, bulk errors",
		body: "String and date filters work on every column type, a soft-deleted parent no longer comes back through a join, and bulk calls report only the items that failed in the 400 body. Unknown filter keys, an empty findOne and bad input on reads are now 400s, and every list ends with a primary key sort.",
	},
	{
		version: "3.3.0",
		date: "Aug 10, 2026",
		title: "Has-many eager loading without N+1",
		body: "Declare a hasMany relation and findAll loads the whole page's children in one extra query, never one per row. options.select now takes dotted paths like region.code, and the package ships an MCP server so any AI agent can read its docs.",
	},
	{
		version: "3.2.2",
		date: "Aug 9, 2026",
		title: "Foreign-key mapping restored",
		body: "ForeignKeyViolationException and EntityInUseException are exported again. A create or update pointing at a missing parent row returns 400, and a delete blocked by dependent rows returns 409, instead of a raw 500.",
	},
	{
		version: "3.2.1",
		date: "Jul 17, 2026",
		title: "Docs site and packaging",
		body: "The package homepage now points at this docs site, and the READMEs link the docs, npm, and GitHub. No runtime change, and the foreign-key regression it carried is fixed in 3.2.2.",
	},
];

export function LatestReleases() {
	return (
		<div className="space-y-3">
			{RELEASES.map((r) => (
				<Link
					key={r.version}
					href="/docs/changelog"
					className="block rounded-lg border border-[var(--fd-border-muted)] bg-[var(--fd-surface-muted)] p-5 text-fd-foreground transition-colors hover:border-[var(--fd-border-hover)] hover:bg-fd-accent/40"
				>
					<div className="mb-1.5 flex items-baseline gap-2">
						<span className="text-base font-semibold tracking-[-0.198px] text-fd-foreground">
							{r.title}
						</span>
						<span className="ml-auto rounded-lg border border-[var(--fd-border-muted)] bg-fd-background px-1.5 py-0.5 text-xs font-medium text-[var(--color-fd-primary)]">
							v{r.version}
						</span>
					</div>
					<div className="text-xs text-fd-muted-foreground">{r.date}</div>
					<p className="mt-2.5 text-sm leading-relaxed text-fd-muted-foreground">
						{r.body}
					</p>
				</Link>
			))}
			<div className="pt-1 text-center">
				<Link
					href="/docs/changelog"
					className="inline-flex items-center gap-1 text-sm text-fd-muted-foreground transition-colors hover:text-fd-foreground"
				>
					Full changelog <ArrowRight className="size-3.5" />
				</Link>
			</div>
		</div>
	);
}
