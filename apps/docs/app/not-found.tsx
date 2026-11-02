import { ArrowLeft, BookOpen } from "lucide-react";
import Link from "next/link";

export const metadata = {
	title: "Page not found",
	// A 404 that gets indexed competes with the pages that do exist.
	robots: { index: false, follow: true },
};

/**
 * The 404, which GitHub Pages serves from the exported 404.html. Old links land here, so it
 * offers the two ways back in: the home page and the docs index. Cmd+K search works here too.
 */
export default function NotFound() {
	return (
		<main className="flex flex-1 flex-col items-center justify-center px-4 py-24 text-center">
			<p className="text-fd-muted-foreground font-mono text-sm">404</p>
			<h1 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
				That page is not here
			</h1>
			<p className="text-fd-muted-foreground mt-3 max-w-md">
				It may have moved. Press Cmd+K (Ctrl+K on Windows and Linux) to search,
				or start from the docs index.
			</p>

			<div className="mt-8 flex flex-wrap items-center justify-center gap-3">
				<Link
					href="/"
					className="border-fd-border hover:bg-fd-accent inline-flex items-center gap-2 rounded-lg border px-5 py-2.5 text-sm font-medium transition-colors"
				>
					<ArrowLeft className="size-4" /> Home
				</Link>
				<Link
					href="/docs"
					className="bg-fd-primary text-fd-primary-foreground inline-flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-medium transition-opacity hover:opacity-90"
				>
					<BookOpen className="size-4" /> Documentation
				</Link>
			</div>
		</main>
	);
}
