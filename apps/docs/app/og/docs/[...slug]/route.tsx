import { notFound } from "next/navigation";
import { ogImage } from "@/lib/og";
import { imageSegments, source } from "@/lib/source";

// One sharing card per docs page: /og/docs/<slug>/image.png
export const dynamic = "force-static";
export const revalidate = false;

export async function GET(
	_req: Request,
	{ params }: { params: Promise<{ slug: string[] }> },
) {
	const { slug } = await params;
	const page = source.getPage(slug.slice(0, -1));
	if (!page) notFound();

	return ogImage(page.data.title, page.data.description);
}

export function generateStaticParams() {
	return source.getPages().map((page) => ({ slug: imageSegments(page) }));
}
