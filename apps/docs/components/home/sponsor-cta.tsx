import { ArrowRight, Heart } from "lucide-react";
import { siteConfig } from "@/lib/seo";

export function SponsorCta() {
	return (
		<div className="flex flex-col gap-4 rounded-[2px] border border-[var(--fd-border-muted)] bg-[var(--fd-surface-muted)] p-6 sm:flex-row sm:items-center sm:justify-between">
			<div className="max-w-2xl">
				<div className="flex items-center gap-2 text-base font-semibold text-fd-foreground">
					<Heart className="size-4 text-[var(--color-fd-primary)]" />
					Free under MIT, kept that way by sponsors
				</div>
				<p className="mt-2 text-sm leading-relaxed text-fd-muted-foreground">
					Dialect quirks, error mapping, and query correctness are ongoing work,
					given away for free. If this package saves you time, sponsoring is what
					keeps it maintained.
				</p>
			</div>
			<a
				href={siteConfig.sponsor}
				target="_blank"
				rel="noreferrer noopener"
				className="inline-flex h-9 flex-shrink-0 items-center gap-2 rounded-[2px] bg-[var(--color-fd-primary)] px-4 text-sm font-semibold text-fd-background transition-opacity hover:opacity-90"
			>
				Sponsor on GitHub
				<ArrowRight className="size-4" />
			</a>
		</div>
	);
}
