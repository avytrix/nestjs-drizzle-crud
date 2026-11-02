import { FileClock } from "lucide-react";
import { historyUrl, lastModified } from "@/lib/doc-history";

/**
 * When this page last changed, and a link to everything that changed before that.
 *
 * Renders nothing when git has no date for the file (an untracked page, or a shallow clone).
 * Showing nothing is correct there; a made-up date would read as fact.
 */
export function PageHistory({ contentPath }: { contentPath: string }) {
	const iso = lastModified(contentPath);
	if (!iso) return null;

	const formatted = new Intl.DateTimeFormat("en-GB", {
		day: "numeric",
		month: "long",
		year: "numeric",
		timeZone: "UTC",
	}).format(new Date(iso));

	return (
		<div className="not-prose text-fd-muted-foreground mt-12 flex flex-wrap items-center gap-x-3 gap-y-2 border-t pt-6 text-sm">
			<span>
				Last updated <time dateTime={iso}>{formatted}</time>
			</span>
			<a
				href={historyUrl(contentPath)}
				rel="noreferrer noopener"
				target="_blank"
				className="hover:text-fd-accent-foreground inline-flex items-center gap-1.5 underline underline-offset-4"
			>
				<FileClock className="size-3.5" />
				View change history
			</a>
		</div>
	);
}
