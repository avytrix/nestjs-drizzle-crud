import { Heart } from "lucide-react";
import Link from "next/link";
import { siteConfig } from "@/lib/seo";

/**
 * Sidebar sponsor card. Sits in the docs sidebar footer, so the ask is present
 * on every page without interrupting the content.
 */
export function SponsorCard() {
	return (
		<div className="flex flex-col gap-2">
			<a
				href={siteConfig.sponsor}
				target="_blank"
				rel="noreferrer noopener"
				className="group flex flex-col gap-1 rounded-lg border border-[var(--fd-border-muted)] bg-[var(--fd-surface-muted)] p-3 transition-colors hover:border-[var(--fd-border-hover)] hover:bg-fd-accent/40"
			>
				<span className="flex items-center gap-1.5 text-sm font-semibold text-fd-foreground">
					<Heart className="size-3.5 text-[var(--color-fd-primary)]" />
					Sponsor this project
				</span>
				<span className="text-xs leading-relaxed text-fd-muted-foreground">
					MIT and free forever. Sponsors fund the fixes, the docs, and the next
					release.
				</span>
			</a>
			<p className="px-1 text-xs text-fd-muted-foreground">
				Built and maintained by{" "}
				<Link
					href="/docs/built-by-avytrix"
					className="font-medium text-fd-foreground underline-offset-2 hover:underline"
				>
					{siteConfig.organization.name}
				</Link>
			</p>
		</div>
	);
}
