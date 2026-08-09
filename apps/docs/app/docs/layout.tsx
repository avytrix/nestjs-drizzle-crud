import { source } from "@/lib/source";
import { DocsLayout } from "fumadocs-ui/layouts/docs";
import { baseOptions } from "@/lib/layout.shared";
import { SponsorCard } from "@/components/sponsor-card";
import type { ReactNode } from "react";

export default function Layout({ children }: { children: ReactNode }) {
	return (
		<DocsLayout
			tree={source.getPageTree()}
			sidebar={{ footer: <SponsorCard /> }}
			{...baseOptions()}
		>
			{children}
		</DocsLayout>
	);
}
