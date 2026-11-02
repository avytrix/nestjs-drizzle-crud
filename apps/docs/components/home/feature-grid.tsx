import Link from "next/link";
import {
	Box,
	Settings2,
	ShieldCheck,
	Database,
	RotateCcw,
	PackageOpen,
	Filter,
	Search,
	Link2,
	KeyRound,
	Webhook,
	FlaskConical,
	ArrowRight,
} from "lucide-react";
import type { ComponentType } from "react";

const FEATURES: {
	icon: ComponentType<{ className?: string }>;
	title: string;
	href: string;
}[] = [
	{ icon: Box, title: "Complete CRUD", href: "/docs/defining-services" },
	{ icon: Settings2, title: "Configure once", href: "/docs/for-root" },
	{ icon: ShieldCheck, title: "Type-safe generics", href: "/docs/api" },
	{
		icon: Database,
		title: "PostgreSQL, MySQL & SQLite",
		href: "/docs/for-root",
	},
	{
		icon: RotateCcw,
		title: "Soft delete & restore",
		href: "/docs/soft-delete",
	},
	{
		icon: PackageOpen,
		title: "Bulk ops (transactional)",
		href: "/docs/bulk-operations",
	},
	{ icon: Filter, title: "Rich filtering", href: "/docs/filtering" },
	{ icon: Search, title: "Full-text search", href: "/docs/full-text-search" },
	{ icon: Link2, title: "Many-to-one relations", href: "/docs/relations" },
	{
		icon: KeyRound,
		title: "Flexible primary keys",
		href: "/docs/primary-keys",
	},
	{
		icon: Webhook,
		title: "Hooks & validation",
		href: "/docs/hooks-validation",
	},
	{ icon: FlaskConical, title: "Test utilities", href: "/docs/testing" },
];

export function FeatureGrid() {
	return (
		<div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
			{FEATURES.map((f) => (
				<Link
					key={f.title}
					href={f.href}
					className="group flex h-12 items-center gap-3 overflow-hidden rounded-lg border border-[var(--fd-border-muted)] bg-transparent px-4 text-fd-foreground transition-all duration-200 hover:border-[var(--fd-border-hover)] hover:bg-fd-accent/40 md:h-14"
				>
					<f.icon className="size-5 flex-shrink-0 text-fd-muted-foreground" />
					<span className="text-base font-normal">{f.title}</span>
					<ArrowRight className="ml-auto size-4 flex-shrink-0 text-fd-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
				</Link>
			))}
		</div>
	);
}
