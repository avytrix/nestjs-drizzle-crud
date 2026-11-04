import { siteConfig } from "@/lib/seo";

const repo = siteConfig.github.replace("https://github.com/", "");

// Live counts from shields.io. The width attributes are only a size hint for the layout;
// `w-auto` keeps each badge at its real width once it loads.
const BADGES = [
	{
		href: siteConfig.npm,
		src: `https://img.shields.io/npm/dw/${siteConfig.name}?label=npm%20downloads&color=E0234E`,
		alt: "npm weekly downloads",
		width: 150,
	},
	{
		href: siteConfig.github,
		src: `https://img.shields.io/github/stars/${repo}?style=social`,
		alt: "GitHub stars",
		width: 80,
	},
];

export function HeroBadges() {
	return (
		<div className="flex flex-col items-start gap-2">
			<div className="flex flex-wrap items-center gap-2">
				{BADGES.map((b) => (
					<a
						key={b.src}
						href={b.href}
						target="_blank"
						rel="noreferrer noopener"
					>
						{/* biome-ignore lint/performance/noImgElement: static export, a remote SVG badge */}
						<img
							src={b.src}
							alt={b.alt}
							width={b.width}
							height={20}
							className="h-5 w-auto"
						/>
					</a>
				))}
			</div>
			<p className="text-sm text-fd-muted-foreground">
				Find it useful?{" "}
				<a
					href={siteConfig.github}
					target="_blank"
					rel="noreferrer noopener"
					className="font-medium text-fd-foreground underline underline-offset-2 hover:text-fd-primary"
				>
					Give it a star on GitHub
				</a>
				. It helps other NestJS developers find it.
			</p>
		</div>
	);
}
