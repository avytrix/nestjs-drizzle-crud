import "./global.css";
import { RootProvider } from "fumadocs-ui/provider/next";
import { Inter } from "next/font/google";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { JsonLd } from "@/components/json-ld";
import { siteConfig, softwareJsonLd, websiteJsonLd } from "@/lib/seo";

const inter = Inter({
	subsets: ["latin"],
	display: "swap",
	variable: "--font-inter",
});

const ogTitle = `${siteConfig.name}: ${siteConfig.tagline}`;

export const metadata: Metadata = {
	metadataBase: new URL(siteConfig.url),
	title: {
		default: ogTitle,
		template: `%s · ${siteConfig.name}`,
	},
	description: siteConfig.description,
	keywords: siteConfig.keywords,
	applicationName: siteConfig.name,
	authors: [{ name: siteConfig.author }],
	creator: siteConfig.author,
	publisher: siteConfig.author,
	category: "technology",
	alternates: { canonical: "/" },
	robots: {
		index: true,
		follow: true,
		googleBot: {
			index: true,
			follow: true,
			"max-image-preview": "large",
			"max-snippet": -1,
			"max-video-preview": -1,
		},
	},
	openGraph: {
		type: "website",
		url: siteConfig.url,
		siteName: siteConfig.name,
		title: ogTitle,
		description: siteConfig.description,
		locale: "en_US",
	},
	twitter: {
		card: "summary_large_image",
		title: ogTitle,
		description: siteConfig.description,
	},
};

export default function Layout({ children }: { children: ReactNode }) {
	return (
		<html lang="en" suppressHydrationWarning className={inter.variable}>
			<body className="flex flex-col min-h-screen font-sans">
				<JsonLd data={[websiteJsonLd, softwareJsonLd]} />
				<RootProvider search={{ options: { type: "static" } }}>
					{children}
				</RootProvider>
			</body>
		</html>
	);
}
