import { docsLlms } from "@/lib/source";

// Every docs page as Markdown, in one file, for assistants that read a whole site at once.
export const dynamic = "force-static";
export const revalidate = false;

export async function GET() {
	return new Response(await docsLlms.full(), {
		headers: { "Content-Type": "text/plain; charset=utf-8" },
	});
}
