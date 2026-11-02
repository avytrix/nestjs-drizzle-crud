import { DocsLayout } from "fumadocs-ui/layouts/notebook";
import type { ReactNode } from "react";
import { AssistantPanel } from "@/components/assistant/assistant-panel";
import { sidebarSlots } from "@/components/docs-sidebar";
import { SponsorCard } from "@/components/sponsor-card";
import { baseOptions } from "@/lib/layout.shared";
import { source } from "@/lib/source";

/**
 * The notebook layout, not the default `docs` one.
 *
 * Both render three columns (sidebar, content, table of contents). The difference is the header:
 * `docs` puts the title and search inside the sidebar, `notebook` with `nav.mode: 'top'` gives a
 * full-width bar across all three, and keeps the logo visible when the sidebar is collapsed.
 *
 * `{...options}` has to spread FIRST. It carries its own `nav`, so spreading it last would
 * overwrite `mode: 'top'` and drop the layout back to `auto` without any error.
 */
export function DocsShell({ children }: { children: ReactNode }) {
	const options = baseOptions();

	return (
		<DocsLayout
			{...options}
			tree={source.getPageTree()}
			nav={{ ...options.nav, mode: "top" }}
			sidebar={{ collapsible: true, footer: <SponsorCard /> }}
			slots={{ sidebar: sidebarSlots }}
		>
			{children}
			<AssistantPanel />
		</DocsLayout>
	);
}
