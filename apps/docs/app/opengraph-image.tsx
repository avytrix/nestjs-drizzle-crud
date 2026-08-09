import { ImageResponse } from "next/og";

export const alt = "nestjs-drizzle-crud: type-safe CRUD for Drizzle ORM in NestJS";
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
				<svg
					viewBox="0 0 24 24"
					width="280"
					height="280"
					style={{ flexShrink: 0 }}
				>
					<path
						d="M 3 22 V 7 Q 3 4 6 4 H 9 Q 11 4 11 7 V 22 H 9 V 7 Q 9 6 8 6 H 6 Q 5 6 5 7 V 22 Z"
						fill="#E0234E"
					/>
					<path
						d="M 12 22 V 3 H 17 Q 22 3 22 8 V 15 Q 22 20 17 20 H 14 V 22 Z M 14 6 V 18 H 17 Q 20 18 20 15 V 8 Q 20 6 18 6 Z"
						fill="#C5F74F"
						fillRule="evenodd"
					/>
				</svg>

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
						<span style={{ color: "#E0234E", display: "flex" }}>nestjs</span>
						<span style={{ color: "#fafafa", display: "flex" }}>-</span>
						<span style={{ color: "#C5F74F", display: "flex" }}>drizzle</span>
						<span style={{ color: "#fafafa", display: "flex" }}>-crud</span>
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
						v3.2.2
					</div>
				</div>
			</div>
		),
		{ ...size },
	);
}