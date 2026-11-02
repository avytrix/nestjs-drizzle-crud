import { readFileSync } from "node:fs";
import { join } from "node:path";
import { generateOGImage } from "fumadocs-ui/og";
import { siteConfig } from "./seo";

/** The Avytrix Technologies mark, inlined at build time because the export has no server. */
const logo = `data:image/png;base64,${readFileSync(join(process.cwd(), "public/avytrix-icon.png")).toString("base64")}`;

/** The same blue as the site's primary, in hex because the image renderer has no oklch. */
const primary = "#2552FF";

export const ogSize = { width: 1200, height: 630 };

/** A sharing card: the mark, "Nestjs Drizzle", a title and a line. */
export function ogImage(title: string, description?: string) {
	return generateOGImage({
		title,
		description,
		site: siteConfig.displayName,
		primaryColor: `${primary}66`,
		primaryTextColor: "#7c9bff",
		icon: (
			// biome-ignore lint/performance/noImgElement: ImageResponse (satori) renders plain <img> only
			<img src={logo} width={64} height={64} alt="" />
		),
		...ogSize,
	});
}
