import { Github, Heart, Package } from "lucide-react";
import Link from "next/link";

export function Footer() {
	return (
		<footer className="mt-20 border-t border-[var(--fd-border-muted)]">
			<div className="container mx-auto max-w-6xl px-6 py-8">
				<div className="flex flex-col items-start justify-between gap-6 sm:flex-row sm:items-center">
					<div>
						<div className="text-sm font-semibold text-fd-foreground">
							nestjs-drizzle-crud
						</div>
						<div className="mt-1 text-xs text-fd-muted-foreground">
							MIT · v3.2.2
						</div>
					</div>
					<div className="flex flex-wrap items-center gap-1 text-sm">
						<Link
							href="/docs"
							className="inline-flex items-center -mx-2 rounded-[2px] px-2 py-1.5 text-fd-muted-foreground transition-colors hover:bg-fd-accent/40 hover:text-fd-foreground"
						>
							Documentation
						</Link>
						<Link
							href="/docs/changelog"
							className="inline-flex items-center -mx-2 rounded-[2px] px-2 py-1.5 text-fd-muted-foreground transition-colors hover:bg-fd-accent/40 hover:text-fd-foreground"
						>
							Changelog
						</Link>
						<a
							href="https://github.com/myviliha/viliha-drizzle-crud"
							target="_blank"
							rel="noreferrer noopener"
							className="inline-flex items-center gap-1.5 -mx-2 rounded-[2px] px-2 py-1.5 text-fd-muted-foreground transition-colors hover:bg-fd-accent/40 hover:text-fd-foreground"
						>
							<Github className="size-4" />
							GitHub
						</a>
						<a
							href="https://github.com/sponsors/myviliha"
							target="_blank"
							rel="noreferrer noopener"
							className="inline-flex items-center gap-1.5 -mx-2 rounded-[2px] px-2 py-1.5 text-fd-muted-foreground transition-colors hover:bg-fd-accent/40 hover:text-fd-foreground"
						>
							<Heart className="size-4" />
							Sponsor
						</a>
						<a
							href="https://www.npmjs.com/package/nestjs-drizzle-crud"
							target="_blank"
							rel="noreferrer noopener"
							className="inline-flex items-center gap-1.5 -mx-2 rounded-[2px] px-2 py-1.5 text-fd-muted-foreground transition-colors hover:bg-fd-accent/40 hover:text-fd-foreground"
						>
							<Package className="size-4" />
							npm
						</a>
					</div>
				</div>
			</div>
		</footer>
	);
}
