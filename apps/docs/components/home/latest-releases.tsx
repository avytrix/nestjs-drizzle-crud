import Link from "next/link";
import { ArrowRight } from "lucide-react";

// Newest first; the top banner announces RELEASES[0].
export const RELEASES = [
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
		body: "The package homepage now points at crud.viliha.com, and the READMEs link the docs, npm, and GitHub. No runtime change, and the foreign-key regression it carried is fixed in 3.2.2.",
	},
];

export function LatestReleases() {
	return (
		<div className="space-y-3">
			{RELEASES.map((r) => (
				<Link
					key={r.version}
					href="/docs/changelog"
					className="block rounded-[8px] border border-[var(--fd-border-muted)] bg-[var(--fd-surface-muted)] p-5 text-fd-foreground transition-colors hover:border-[var(--fd-border-hover)] hover:bg-fd-accent/40"
				>
					<div className="mb-1.5 flex items-baseline gap-2">
						<span className="text-base font-semibold tracking-[-0.198px] text-fd-foreground">
							{r.title}
						</span>
						<span className="ml-auto rounded-[2px] border border-[var(--fd-border-muted)] bg-fd-background px-1.5 py-0.5 text-xs font-medium text-[var(--color-fd-primary)]">
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
