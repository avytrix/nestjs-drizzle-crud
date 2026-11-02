"use client";

import Link from "fumadocs-core/link";
import type * as PageTree from "fumadocs-core/page-tree";
import { useTreeContext } from "fumadocs-ui/contexts/tree";
import type { DocsSlots } from "fumadocs-ui/layouts/notebook";
import {
	Sidebar,
	SidebarCollapseTrigger,
	SidebarProvider,
	type SidebarProps,
	SidebarTrigger,
	useSidebar,
} from "fumadocs-ui/layouts/notebook/slots/sidebar";
import { usePathname } from "next/navigation";
import { type ReactNode, useMemo } from "react";
import { firstUrl, pageUrls } from "@/lib/page-tree";

/**
 * A rail of section icons, shown while the sidebar is collapsed.
 *
 * Collapsing used to leave nothing behind but a hover strip at the edge of the window. The rail
 * keeps every top-level section one click away. It is built from the page tree, so a section
 * added to `content/docs/meta.json` (with an `icon`) shows up here with no second edit.
 */

interface RailItem {
	url: string;
	name: ReactNode;
	icon: ReactNode;
	/** Every page that counts as "inside this section", for the active state. */
	urls: Set<string>;
}

function railItems(root: PageTree.Root | PageTree.Folder): RailItem[] {
	const items: RailItem[] = [];

	for (const node of root.children) {
		if (node.type === "separator") continue;

		const url = firstUrl(node);
		const icon =
			node.type === "folder" ? (node.icon ?? node.index?.icon) : node.icon;
		// An item with no icon has nothing to show in a rail of icons, so it is left out.
		if (!url || !icon) continue;

		items.push({ url, name: node.name, icon, urls: new Set(pageUrls(node)) });
	}

	return items;
}

function SectionRail() {
	const { collapsed } = useSidebar();
	const { root } = useTreeContext();
	const pathname = usePathname();
	const items = useMemo(() => railItems(root), [root]);

	if (!collapsed) return null;

	// The static export serves `/docs/filtering/`; the page tree knows it as `/docs/filtering`.
	const current = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;

	return (
		<div className="sticky top-(--fd-docs-row-2) z-10 flex h-[calc(var(--fd-docs-height)-var(--fd-docs-row-2))] flex-col items-end [grid-area:sidebar] max-md:hidden">
			<nav
				aria-label="Documentation sections"
				className="flex h-full w-14 flex-col items-center gap-1 border-e py-3"
			>
				{items.map((item) => {
					const active = item.urls.has(current);

					return (
						<Link
							key={item.url}
							href={item.url}
							aria-current={active ? "page" : undefined}
							className={`group relative flex size-9 items-center justify-center rounded-lg transition-colors [&_svg]:size-4.5 ${
								active
									? "bg-fd-primary/10 text-fd-primary"
									: "text-fd-muted-foreground hover:bg-fd-accent/50 hover:text-fd-accent-foreground/80"
							}`}
						>
							{item.icon}
							{/* The label on hover is the accessible name, so it is not aria-hidden. */}
							<span className="pointer-events-none absolute start-full z-20 ms-2 hidden whitespace-nowrap rounded-md border bg-fd-popover px-2 py-1 text-xs text-fd-popover-foreground shadow-md group-hover:block group-focus-visible:block">
								{item.name}
							</span>
						</Link>
					);
				})}
			</nav>
		</div>
	);
}

function SidebarRoot(props: SidebarProps) {
	return (
		<>
			<Sidebar {...props} />
			<SectionRail />
		</>
	);
}

export const sidebarSlots: DocsSlots["sidebar"] = {
	provider: SidebarProvider,
	root: SidebarRoot,
	trigger: SidebarTrigger,
	collapseTrigger: SidebarCollapseTrigger,
	useSidebar,
};
