import { Heart } from "lucide-react";
import { GithubMark } from "@/components/github-mark";
import { NpmMark } from "@/components/npm-mark";
import Link from "next/link";
import { avytrixUrl, siteConfig } from "@/lib/seo";

export function Footer() {
	return (
		<footer className="mt-20 border-t border-[var(--fd-border-muted)]">
			<div className="container mx-auto max-w-6xl px-6 py-8">
				<div className="flex flex-col items-start justify-between gap-6 sm:flex-row sm:items-center">
					<div>
						<div className="text-sm font-semibold text-fd-foreground">
							{siteConfig.displayName}
						</div>
						<div className="mt-1 text-xs text-fd-muted-foreground">
							MIT · v{siteConfig.version}
						</div>
						<p className="mt-2 text-xs text-fd-muted-foreground">
							Built and maintained by{" "}
							<a
								href={avytrixUrl("/", "home")}
								target="_blank"
								rel="noreferrer noopener"
								className="font-medium text-fd-foreground underline-offset-2 hover:underline"
							>
								{siteConfig.organization.name}
							</a>
							.{" "}
							<Link
								href="/docs/commercial-support"
								className="underline underline-offset-2 hover:text-fd-foreground"
							>
								Hire the team behind the library
							</Link>
						</p>
						<ul className="mt-2 flex gap-3 text-xs">
							{siteConfig.organization.profiles.map((p) => (
								<li key={p.url}>
									<a
										href={p.url}
										target="_blank"
										rel="noreferrer noopener me"
										className="text-fd-muted-foreground underline-offset-2 hover:text-fd-foreground hover:underline"
									>
										{siteConfig.organization.name} on {p.name}
									</a>
								</li>
							))}
						</ul>
					</div>
					<div className="flex flex-wrap items-center gap-1 text-sm">
						<Link
							href="/docs"
							className="inline-flex items-center -mx-2 rounded-lg px-2 py-1.5 text-fd-muted-foreground transition-colors hover:bg-fd-accent/40 hover:text-fd-foreground"
						>
							Documentation
						</Link>
						<Link
							href="/docs/changelog"
							className="inline-flex items-center -mx-2 rounded-lg px-2 py-1.5 text-fd-muted-foreground transition-colors hover:bg-fd-accent/40 hover:text-fd-foreground"
						>
							Changelog
						</Link>
						<a
							href={siteConfig.github}
							target="_blank"
							rel="noreferrer noopener"
							className="inline-flex items-center gap-1.5 -mx-2 rounded-lg px-2 py-1.5 text-fd-muted-foreground transition-colors hover:bg-fd-accent/40 hover:text-fd-foreground"
						>
							<GithubMark className="size-4" />
							GitHub
						</a>
						<a
							href="https://github.com/sponsors/avytrix"
							target="_blank"
							rel="noreferrer noopener"
							className="inline-flex items-center gap-1.5 -mx-2 rounded-lg px-2 py-1.5 text-fd-muted-foreground transition-colors hover:bg-fd-accent/40 hover:text-fd-foreground"
						>
							<Heart className="size-4" />
							Sponsor
						</a>
						<Link
							href="/docs/built-by-avytrix"
							className="inline-flex items-center -mx-2 rounded-lg px-2 py-1.5 text-fd-muted-foreground transition-colors hover:bg-fd-accent/40 hover:text-fd-foreground"
						>
							About the maintainers
						</Link>
						<a
							href={siteConfig.npm}
							target="_blank"
							rel="noreferrer noopener"
							className="inline-flex items-center gap-1.5 -mx-2 rounded-lg px-2 py-1.5 text-fd-muted-foreground transition-colors hover:bg-fd-accent/40 hover:text-fd-foreground"
						>
							<NpmMark />
							<span className="sr-only">npm</span>
						</a>
					</div>
				</div>
			</div>
		</footer>
	);
}
