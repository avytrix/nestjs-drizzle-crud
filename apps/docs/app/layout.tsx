import "./global.css";
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import type { ReactNode } from "react";
import { Provider } from "@/components/provider";
import { absoluteUrl, indexRobots, siteConfig } from "@/lib/seo";

/*
 * Geist for text and Geist Mono for code. Both are exposed as CSS
 * variables so global.css can point the Fumadocs font tokens at them.
 */
const geist = Geist({
	subsets: ["latin", "latin-ext"],
	variable: "--font-geist",
	display: "swap",
});

const geistMono = Geist_Mono({
	subsets: ["latin", "latin-ext"],
	variable: "--font-geist-mono",
	display: "swap",
});

const ogTitle = siteConfig.homeTitle;

export const metadata: Metadata = {
	metadataBase: new URL(siteConfig.url),
	title: {
		default: ogTitle,
		template: `%s | ${siteConfig.displayName}`,
	},
	description: siteConfig.description,
	keywords: siteConfig.keywords,
	applicationName: siteConfig.displayName,
	authors: [{ name: siteConfig.author }],
	creator: siteConfig.author,
	publisher: siteConfig.organization.name,
	category: "technology",
	alternates: { canonical: absoluteUrl("/") },
	robots: indexRobots,
	openGraph: {
		type: "website",
		url: absoluteUrl("/"),
		siteName: siteConfig.displayName,
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
		<html
			lang="en"
			suppressHydrationWarning
			className={`${geist.variable} ${geistMono.variable}`}
		>
			<body className="flex min-h-screen flex-col">
				<Provider>{children}</Provider>
			</body>
		</html>
	);
}
