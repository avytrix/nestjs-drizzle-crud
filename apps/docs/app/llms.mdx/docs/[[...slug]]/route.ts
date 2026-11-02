import { notFound } from "next/navigation";
import { docsLlms, markdownSegments, source } from "@/lib/source";

/**
 * One page as Markdown, behind "Copy Markdown" and "View as Markdown":
 * /llms.mdx/docs/<slug>/content.md
 */
export const dynamic = "force-static";
export const revalidate = false;

export async function GET(
	_req: Request,
	{ params }: { params: Promise<{ slug?: string[] }> },
) {
	const { slug } = await params;
	// The last segment is the "content.md" the URL builder appends, not part of the page's slug.
	const page = source.getPage(slug?.slice(0, -1));
	if (!page) notFound();

	return new Response(await docsLlms.page(page), {
		headers: { "Content-Type": "text/markdown; charset=utf-8" },
	});
}

export function generateStaticParams() {
	return source.getPages().map((page) => ({ slug: markdownSegments(page) }));
}
