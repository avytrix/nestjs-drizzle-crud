import Link from "next/link";
import { ArrowRight, BookOpen, Github } from "lucide-react";

export function HeroCtaPills() {
	return (
		<div className="flex flex-wrap items-center gap-2 pt-1">
			<Link
				href="/docs/quick-start"
				className="inline-flex h-9 items-center gap-2 rounded-[8px] bg-[var(--color-fd-primary)] px-4 text-sm font-semibold text-fd-background transition-opacity hover:opacity-90"
			>
				<BookOpen className="size-4" />
				Get Started
				<ArrowRight className="size-4" />
			</Link>
			<Link
				href="/docs"
				className="inline-flex h-9 items-center gap-2 rounded-[8px] border border-[var(--fd-border-muted)] bg-[var(--fd-pill-bg)] px-4 text-sm font-semibold text-fd-foreground transition-colors hover:border-[var(--fd-border-hover)] hover:bg-fd-accent/40"
			>
				Documentation
				<ArrowRight className="size-4" />
			</Link>
			<a
				href="https://github.com/avytrix/nestjs-drizzle-crud"
				target="_blank"
				rel="noreferrer noopener"
				className="inline-flex h-9 items-center gap-2 rounded-[8px] border border-[var(--fd-border-muted)] bg-[var(--fd-pill-bg)] px-4 text-sm font-semibold text-fd-foreground transition-colors hover:border-[var(--fd-border-hover)] hover:bg-fd-accent/40"
			>
				<Github className="size-4" />
				Star on GitHub
			</a>
		</div>
	);
}
