import { Accordion, Accordions } from "fumadocs-ui/components/accordion";
import { Banner } from "fumadocs-ui/components/banner";
import { Callout } from "fumadocs-ui/components/callout";
import { Card, Cards } from "fumadocs-ui/components/card";
import { Step, Steps } from "fumadocs-ui/components/steps";
import { Tab, Tabs } from "fumadocs-ui/components/tabs";
import * as Twoslash from "fumadocs-twoslash/ui";
import defaultComponents from "fumadocs-ui/mdx";
import {
	Activity,
	Atom,
	BellRing,
	Blocks,
	BookOpen,
	Bot,
	Boxes,
	Braces,
	Brain,
	ClipboardCheck,
	Code,
	Database,
	Feather,
	Filter,
	GitCompare,
	Hash,
	KeyRound,
	Layers,
	Leaf,
	LifeBuoy,
	ListOrdered,
	Lock,
	Package,
	Rocket,
	Scale,
	SearchX,
	Server,
	Settings2,
	Shield,
	ShieldCheck,
	Sparkles,
	Table,
	Terminal,
	Timer,
	Trash2,
	Users,
	Workflow,
	Zap,
} from "lucide-react";
import type { MDXComponents } from "mdx/types";
import { DocsChangelog } from "./docs-changelog";
import { InstallTabs, RunTabs } from "./install-tabs";
import { Ext, Url, Version } from "./links";
import { PropsTable } from "./props-table";

/**
 * `Tab`/`Tabs` are required, not decorative: remark-npm compiles every ```npm fence into them,
 * so without these registered the npm/pnpm/yarn/bun widget renders nothing.
 */
export function getMDXComponents(components?: MDXComponents) {
	return {
		...defaultComponents,
		...Twoslash,
		Tab,
		Tabs,
		Callout,
		Card,
		Cards,
		Step,
		Steps,
		Accordion,
		Accordions,
		Banner,
		PropsTable,
		InstallTabs,
		RunTabs,
		DocsChangelog,
		Ext,
		Url,
		Version,
		// Icons for MDX, e.g. `<Card icon={<Rocket />} />`. Registered by name so a typo fails the build.
		Activity,
		Atom,
		BellRing,
		Blocks,
		BookOpen,
		Bot,
		Boxes,
		Braces,
		Brain,
		ClipboardCheck,
		Code,
		Database,
		Feather,
		Filter,
		GitCompare,
		Hash,
		KeyRound,
		Layers,
		Leaf,
		LifeBuoy,
		ListOrdered,
		Lock,
		Package,
		Rocket,
		Scale,
		SearchX,
		Server,
		Settings2,
		Shield,
		ShieldCheck,
		Sparkles,
		Table,
		Terminal,
		Timer,
		Trash2,
		Users,
		Workflow,
		Zap,
		...components,
	} satisfies MDXComponents;
}

export const useMDXComponents = getMDXComponents;

declare global {
	type MDXProvidedComponents = ReturnType<typeof getMDXComponents>;
}
