import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";
import { BookOpen, Globe, Heart, History } from "lucide-react";
import { GithubMark } from "@/components/github-mark";
import { NpmMark } from "@/components/npm-mark";
import { avytrixUrl, siteConfig } from "@/lib/seo";

/**
 * The header shared by the home page and the docs.
 *
 * Text links for the places a reader goes often (docs, changelog, npm), and icon buttons for
 * the rest, so the row reads as one set of controls beside the GitHub button. Every icon link
 * carries `label`, which becomes its accessible name.
 */
export function baseOptions(): BaseLayoutProps {
	return {
		nav: {
			title: (
				<span className="inline-flex items-center gap-2 font-semibold">
					{/* biome-ignore lint/performance/noImgElement: static export, a 24px mark needs no optimizer */}
					<img
						src={siteConfig.logo}
						alt={`${siteConfig.organization.name} logo`}
						width={24}
						height={24}
						className="size-6"
					/>
					{siteConfig.displayName}
				</span>
			),
			url: "/",
			transparentMode: "none",
		},
		links: [
			{
				icon: <BookOpen className="text-fd-primary" />,
				text: (
					<span className="font-semibold text-fd-primary">Documentation</span>
				),
				url: "/docs",
				active: "nested-url",
			},
			{
				icon: <History />,
				text: "Changelog",
				url: "/docs/changelog",
			},
			// The wordmark readers know, with the name kept for screen readers
			{
				text: (
					<>
						<NpmMark />
						<span className="sr-only">npm</span>
					</>
				),
				url: siteConfig.npm,
				external: true,
			},
			{
				type: "icon",
				label: "Sponsor",
				icon: <Heart className="text-fd-primary" />,
				text: "Sponsor",
				url: "/docs/sponsor",
			},
			{
				type: "icon",
				label: siteConfig.organization.name,
				icon: <Globe className="text-fd-primary" />,
				text: siteConfig.organization.name,
				url: avytrixUrl("/", "header"),
				external: true,
			},
			// Our own mark rather than `githubUrl`: Fumadocs renders that one as an unlabelled
			// <svg role="img">, which fails the svg-img-alt accessibility audit.
			{
				type: "icon",
				label: "GitHub",
				icon: <GithubMark />,
				text: "GitHub",
				url: siteConfig.github,
				external: true,
			},
		],
	};
}
