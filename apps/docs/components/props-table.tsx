import type { ReactNode } from "react";

/**
 * Configuration options, laid out flat.
 *
 * Fumadocs' `TypeTable` puts every option behind its own disclosure triangle, so a reader who
 * wants to know "is this required?" has to open each row. Here everything is visible at once,
 * required is a word rather than a missing `?`, and the default sits with its option.
 */

export interface PropSpec {
	type: string;
	description: ReactNode;
	required?: boolean;
	default?: string;
}

export function PropsTable({ props }: { props: Record<string, PropSpec> }) {
	return (
		<div className="not-prose border-fd-border divide-fd-border my-6 divide-y overflow-hidden rounded-xl border">
			{Object.entries(props).map(([name, spec]) => (
				<div
					key={name}
					className="grid gap-x-8 gap-y-2 p-4 sm:grid-cols-[14rem_1fr]"
				>
					<div className="flex flex-wrap items-center gap-2 sm:flex-col sm:items-start">
						<code className="text-fd-primary font-mono text-sm font-semibold">
							{name}
						</code>
						<span
							className={
								spec.required
									? "bg-fd-primary/5 text-fd-primary rounded-full px-2 py-0.5 text-[0.6875rem] font-medium"
									: "text-fd-muted-foreground border-fd-border rounded-full border px-2 py-0.5 text-[0.6875rem] font-medium"
							}
						>
							{spec.required ? "Required" : "Optional"}
						</span>
					</div>

					<div className="min-w-0">
						<p className="text-fd-muted-foreground mb-1.5 font-mono text-xs">
							{spec.type}
						</p>
						<div className="text-fd-foreground text-sm">{spec.description}</div>
						{spec.default !== undefined && (
							<p className="text-fd-muted-foreground mt-1.5 text-xs">
								Defaults to{" "}
								<code className="bg-fd-muted text-fd-foreground rounded px-1.5 py-0.5 font-mono">
									{spec.default}
								</code>
							</p>
						)}
					</div>
				</div>
			))}
		</div>
	);
}
