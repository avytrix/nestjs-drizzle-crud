import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";
import { BookOpen, Globe, Heart, History, Package } from "lucide-react";
import { siteConfig } from "@/lib/seo";

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
						alt=""
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
		githubUrl: siteConfig.github,
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
			{
				icon: <Package />,
				text: "npm",
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
				url: siteConfig.organization.url,
				external: true,
			},
		],
	};
}
