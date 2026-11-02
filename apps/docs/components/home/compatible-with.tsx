import { Box, Cpu, Database, Hexagon, Server } from "lucide-react";
import type { ComponentType } from "react";

const COMPATIBLE: {
	icon: ComponentType<{ className?: string }>;
	label: string;
}[] = [
	{ icon: Database, label: "PostgreSQL" },
	{ icon: Server, label: "MySQL" },
	{ icon: Hexagon, label: "Node.js" },
	{ icon: Box, label: "Bun" },
	{ icon: Cpu, label: "Deno" },
];

export function CompatibleWith() {
	return (
		<div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
			{COMPATIBLE.map((item) => (
				<div
					key={item.label}
					className="flex h-14 items-center justify-center gap-2 rounded-lg border border-[var(--fd-border-muted)] bg-[var(--fd-surface-muted)] text-sm font-medium text-fd-foreground"
				>
					<item.icon className="size-4 text-fd-muted-foreground" />
					{item.label}
				</div>
			))}
		</div>
	);
}
