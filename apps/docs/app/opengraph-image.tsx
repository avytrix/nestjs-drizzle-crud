import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { siteConfig } from "@/lib/seo";

const logo = `data:image/png;base64,${readFileSync(join(process.cwd(), "public/avytrix-icon.png")).toString("base64")}`;

export const alt = `${siteConfig.displayName}: type-safe CRUD for Drizzle ORM in NestJS`;
export const dynamic = "force-static";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const revalidate = false;

export default function Image() {
	return new ImageResponse(
		(
			<div
				style={{
					height: "100%",
					width: "100%",
					display: "flex",
					alignItems: "center",
					padding: 80,
					background: "linear-gradient(135deg, #0a0a0a 0%, #111 60%, #0a0a0a 100%)",
					color: "#fafafa",
					fontFamily: "system-ui, sans-serif",
				}}
			>
				{/* Avytrix Technologies mark, inlined at build time (static export) */}
				{/* biome-ignore lint/performance/noImgElement: ImageResponse (satori) renders plain <img> only */}
				<img src={logo} width={280} height={280} alt="" style={{ flexShrink: 0 }} />

				<div
					style={{
						display: "flex",
						flexDirection: "column",
						marginLeft: 64,
						maxWidth: 700,
					}}
				>
					<div
						style={{
							fontSize: 72,
							fontWeight: 700,
							letterSpacing: "-0.04em",
							lineHeight: 1,
							display: "flex",
						}}
					>
						<span style={{ color: "#E0234E", display: "flex" }}>Nestjs</span>
						<span style={{ color: "#fafafa", display: "flex" }}>&nbsp;</span>
						<span style={{ color: "#C5F74F", display: "flex" }}>Drizzle</span>
					</div>

					<div
						style={{
							fontSize: 28,
							color: "#a1a1a1",
							marginTop: 24,
							lineHeight: 1.4,
							display: "flex",
							flexDirection: "column",
						}}
					>
						<span style={{ display: "flex" }}>Configure once.</span>
						<span style={{ display: "flex" }}>Every entity gets full CRUD.</span>
					</div>

					<div
						style={{
							fontSize: 18,
							color: "#E0234E",
							padding: "6px 14px",
							border: "1px solid #E0234E40",
							borderRadius: 2,
							marginTop: 32,
							alignSelf: "flex-start",
							display: "flex",
						}}
					>
						v{siteConfig.version}
					</div>
				</div>
			</div>
		),
		{ ...size },
	);
}