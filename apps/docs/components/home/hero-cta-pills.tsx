import Link from "next/link";
import { GithubMark } from "@/components/github-mark";
import { ArrowRight, BookOpen } from "lucide-react";

export function HeroCtaPills() {
	return (
		<div className="flex flex-wrap items-center gap-2 pt-1">
			<Link
				href="/docs/quick-start"
				className="inline-flex h-9 items-center gap-2 rounded-lg bg-fd-primary px-4 text-sm font-semibold text-fd-primary-foreground transition-opacity hover:opacity-90"
			>
				<BookOpen className="size-4" />
				Get Started
				<ArrowRight className="size-4" />
			</Link>
			<Link
				href="/docs"
				className="inline-flex h-9 items-center gap-2 rounded-lg border border-[var(--fd-border-muted)] bg-[var(--fd-pill-bg)] px-4 text-sm font-semibold text-fd-foreground transition-colors hover:border-[var(--fd-border-hover)] hover:bg-fd-accent/40"
			>
				Documentation
				<ArrowRight className="size-4" />
			</Link>
			<a
				href="https://github.com/avytrix/nestjs-drizzle-crud"
				target="_blank"
				rel="noreferrer noopener"
				className="inline-flex h-9 items-center gap-2 rounded-lg border border-[var(--fd-border-muted)] bg-[var(--fd-pill-bg)] px-4 text-sm font-semibold text-fd-foreground transition-colors hover:border-[var(--fd-border-hover)] hover:bg-fd-accent/40"
			>
				<GithubMark className="size-4" />
				Star on GitHub
			</a>
		</div>
	);
}
