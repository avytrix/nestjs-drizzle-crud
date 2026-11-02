import {
	DocsBody,
	DocsDescription,
	DocsPage,
	DocsTitle,
	MarkdownCopyButton,
	ViewOptionsPopover,
} from "fumadocs-ui/layouts/notebook/page";
import { createRelativeLink } from "fumadocs-ui/mdx";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { JsonLd } from "@/components/json-ld";
import { getMDXComponents } from "@/components/mdx";
import { PageHistory } from "@/components/page-history";
import { lastModified, sourceUrl } from "@/lib/doc-history";
import { extractFaqs, extractSteps } from "@/lib/page-schema";
import { createMetadata } from "@/lib/seo";
import { imageUrl, lucideIcon, markdownUrl, source } from "@/lib/source";
import { docPageLd } from "@/lib/structured-data";

export default async function Page(props: {
	params: Promise<{ slug?: string[] }>;
}) {
	const params = await props.params;
	const page = source.getPage(params.slug);
	if (!page) notFound();

	const MDX = page.data.body;
	const md = markdownUrl(page);
	const icon = lucideIcon(page.data.icon);
	// FAQ and HowTo schema come from the page's own markup, so they cannot say what it does not.
	const raw = await page.data.getText("raw");

	return (
		<DocsPage toc={page.data.toc} full={page.data.full}>
			<JsonLd
				data={docPageLd({
					title: page.data.title,
					description: page.data.description,
					url: page.url,
					faqs: extractFaqs(raw),
					steps: extractSteps(raw),
					about: page.url === "/docs/built-by-avytrix",
					modified: lastModified(page.path) ?? undefined,
				})}
			/>
			<DocsTitle className="flex items-center gap-3">
				{icon ? (
					<span className="text-fd-primary [&_svg]:size-7" aria-hidden="true">
						{icon}
					</span>
				) : null}
				{page.data.title}
			</DocsTitle>
			{/*
				`doc-lede` rather than Fumadocs' own sizing, which renders the lede larger and greyer
				than the prose under it. The class is styled in global.css off the body tokens.
			*/}
			<DocsDescription className="doc-lede mb-0">
				{page.data.description}
			</DocsDescription>
			<div className="flex flex-row items-center gap-2 border-b pb-6">
				<MarkdownCopyButton markdownUrl={md} />
				<ViewOptionsPopover markdownUrl={md} githubUrl={sourceUrl(page.path)} />
			</div>
			<DocsBody>
				<MDX
					components={getMDXComponents({
						a: createRelativeLink(source, page),
					})}
				/>
				<PageHistory contentPath={page.path} />
			</DocsBody>
		</DocsPage>
	);
}

export async function generateStaticParams() {
	return source.generateParams();
}

export async function generateMetadata(props: {
	params: Promise<{ slug?: string[] }>;
}): Promise<Metadata> {
	const params = await props.params;
	const page = source.getPage(params.slug);
	if (!page) notFound();

	return createMetadata({
		title: page.data.title,
		description: page.data.description,
		path: page.url,
		ogType: "article",
		keywords: [page.data.title.toLowerCase()],
		image: imageUrl(page),
	});
}
