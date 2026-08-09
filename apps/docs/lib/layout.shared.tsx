import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";

const githubUrl = "https://github.com/myviliha/viliha-drizzle-crud";
const npmUrl = "https://www.npmjs.com/package/nestjs-drizzle-crud";

export function baseOptions(): BaseLayoutProps {
	return {
		githubUrl,
		nav: {
			title: (
				<span className="inline-flex items-center gap-2 font-semibold">
					<span className="flex size-6 items-center justify-center rounded-md bg-[var(--color-fd-primary)] text-fd-background text-xs">
						n
					</span>
					nestjs-drizzle-crud
				</span>
			),
			children: (
				<a
					href={npmUrl}
					target="_blank"
					rel="noreferrer noopener"
					className="ml-3 text-sm text-fd-muted-foreground transition-colors hover:text-fd-foreground"
				>
					npm
				</a>
			),
		},
		links: [
			{ text: "Documentation", url: "/docs", active: "nested-url" },
			{ text: "Changelog", url: "/docs/changelog" },
			{ text: "Sponsor", url: "/docs/sponsor" },
			{ text: "GitHub", url: githubUrl, external: true },
		],
	};
}
