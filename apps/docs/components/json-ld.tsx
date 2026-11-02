// Renders schema.org JSON-LD. dangerouslySetInnerHTML is the standard way to
// emit structured data and is safe here: the input is our own static objects.
export function JsonLd({ data }: { data: object }) {
	return (
		<script
			type="application/ld+json"
			// biome-ignore lint/security/noDangerouslySetInnerHtml: static, self-authored JSON-LD
			dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
		/>
	);
}
