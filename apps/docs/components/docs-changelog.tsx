import { recentDocCommits } from "@/lib/doc-history";
import { siteConfig } from "@/lib/seo";

/**
 * Recent changes to the docs themselves, read from git at build time.
 *
 * The release history above it on the changelog page is the package's; this list is the record
 * of the pages. Empty in a shallow checkout, which renders a short note instead of an empty
 * table. deploy-docs.yml checks out with `fetch-depth: 0` so the published site has the list.
 */
export function DocsChangelog({ limit = 40 }: { limit?: number }) {
	const commits = recentDocCommits(limit);

	if (commits.length === 0) {
		return (
			<p className="text-fd-muted-foreground text-sm">
				No git history was available to this build.
			</p>
		);
	}

	const fmt = new Intl.DateTimeFormat("en-GB", {
		day: "numeric",
		month: "short",
		year: "numeric",
		timeZone: "UTC",
	});

	return (
		<div className="not-prose divide-fd-border divide-y border-y">
			{commits.map((c) => (
				<div
					key={c.sha}
					className="flex flex-col gap-1 py-4 sm:flex-row sm:items-baseline sm:gap-4"
				>
					<time
						dateTime={c.date}
						className="text-fd-muted-foreground w-32 shrink-0 font-mono text-xs tabular-nums"
					>
						{fmt.format(new Date(c.date))}
					</time>
					<span className="flex-1 text-sm">{c.subject}</span>
					<a
						href={`https://github.com/${siteConfig.git.repo}/commit/${c.sha}`}
						rel="noreferrer noopener"
						target="_blank"
						className="text-fd-muted-foreground hover:text-fd-accent-foreground shrink-0 font-mono text-xs underline underline-offset-4"
					>
						{c.shortSha}
					</a>
				</div>
			))}
		</div>
	);
}
