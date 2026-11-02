import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";
import { siteConfig } from "@/lib/seo";

const githubUrl = "https://github.com/avytrix/nestjs-drizzle-crud";
const npmUrl = "https://www.npmjs.com/package/nestjs-drizzle-crud";

export function baseOptions(): BaseLayoutProps {
	return {
		githubUrl,
		nav: {
			title: (
				<span className="inline-flex items-center gap-2 font-semibold">
					{/* biome-ignore lint/performance/noImgElement: static export, a 24px mark needs no optimizer */}
					<img src={siteConfig.logo} alt="" width={24} height={24} className="size-6" />
					{siteConfig.displayName}
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
