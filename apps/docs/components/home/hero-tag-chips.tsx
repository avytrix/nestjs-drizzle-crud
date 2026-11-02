import { Box, Database, Droplets, Server } from "lucide-react";
import type { ComponentType } from "react";

const CHIPS: { icon: ComponentType<{ className?: string }>; label: string }[] =
	[
		{ icon: Box, label: "NestJS 10+" },
		{ icon: Droplets, label: "Drizzle 0.28+" },
		{ icon: Database, label: "PostgreSQL" },
		{ icon: Server, label: "MySQL" },
	];

export function HeroTagChips() {
	return (
		<div className="flex flex-wrap items-center gap-1.5">
			{CHIPS.map((chip) => (
				<span
					key={chip.label}
					className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--fd-border-muted)] bg-[var(--fd-surface-muted)] px-2 py-0.5 text-sm font-medium text-fd-foreground"
				>
					<chip.icon className="size-4 text-fd-muted-foreground" />
					{chip.label}
				</span>
			))}
		</div>
	);
}
