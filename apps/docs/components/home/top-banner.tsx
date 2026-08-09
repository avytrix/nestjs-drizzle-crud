"use client";

import Link from "next/link";
import { X } from "lucide-react";
import { useEffect, useState } from "react";

const STORAGE_KEY = "docs-banner-dismissed-v322";

export function TopBanner() {
	const [visible, setVisible] = useState(false);

	useEffect(() => {
		if (localStorage.getItem(STORAGE_KEY) !== "1") {
			setVisible(true);
		}
	}, []);

	if (!visible) return null;

	return (
		<div className="w-full border-b border-[var(--fd-border-muted)] bg-[var(--fd-surface-muted)]">
			<div className="container mx-auto flex h-10 max-w-6xl items-center justify-center gap-2 px-6 text-sm">
				<Link
					href="/docs/changelog"
					className="flex-1 truncate text-center text-fd-muted-foreground transition-colors hover:text-fd-foreground"
				>
					<span className="font-semibold text-fd-foreground">v3.2.2 released</span>
					<span className="mx-2 hidden sm:inline">·</span>
					<span className="hidden sm:inline">
						Foreign-key violations map to 400 and 409 again →
					</span>
					<span className="sm:hidden">· Changelog →</span>
				</Link>
				<button
					type="button"
					onClick={() => {
						localStorage.setItem(STORAGE_KEY, "1");
						setVisible(false);
					}}
					aria-label="Dismiss banner"
					className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-[2px] text-fd-muted-foreground transition-colors hover:bg-fd-accent/40 hover:text-fd-foreground"
				>
					<X className="size-3.5" />
				</button>
			</div>
		</div>
	);
}
