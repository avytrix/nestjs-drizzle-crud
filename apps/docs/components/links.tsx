import type { ReactNode } from "react";
import { avytrixUrl, siteConfig } from "@/lib/seo";

/**
 * Links to the project's other homes, for MDX.
 *
 * Markdown link syntax takes a literal, so every repository or npm URL in a page is a copy that
 * goes stale the day one of them moves. These read `siteConfig` instead. `to` is a key rather
 * than a URL on purpose: a typo fails the type check instead of shipping a dead link.
 */
const TARGETS = {
	/** This docs site. */
	docs: siteConfig.url,
	/** The GitHub repository. */
	github: siteConfig.github,
	/** The issue tracker. */
	issues: `${siteConfig.github}/issues`,
	/** The package on npm. */
	npm: siteConfig.npm,
	/** GitHub Sponsors. */
	sponsor: siteConfig.sponsor,
	/** Avytrix Technologies, who build and maintain the package (UTM-tagged, campaign "docs"). */
	avytrix: avytrixUrl("/", "docs"),
} as const;

export type LinkTarget = keyof typeof TARGETS;

/** A link to one of the project's homes: `<Ext to="npm">npm</Ext>`. */
export function Ext({
	to,
	children,
}: {
	to: LinkTarget;
	children?: ReactNode;
}) {
	const href = TARGETS[to];
	return (
		<a href={href} rel="noreferrer">
			{children ?? href}
		</a>
	);
}

/** The URL itself, as code: `<Url to="github" suffix="/issues" />`. */
export function Url({ to, suffix = "" }: { to: LinkTarget; suffix?: string }) {
	return <code>{`${TARGETS[to]}${suffix}`}</code>;
}

/** The documented package version, from `siteConfig.version`: `<Version />`. */
export function Version() {
	return <>{siteConfig.version}</>;
}
