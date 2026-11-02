import type { Folder, Node, Root } from "fumadocs-core/page-tree";

/**
 * Two things the page tree does not answer directly.
 *
 * A folder only carries a url when Fumadocs hoists an index page onto it, so "where does this
 * section start?" has to be walked for. The icon rail and the breadcrumb markup both need it,
 * and a breadcrumb entry pointing at a folder path that was never built is worse than none.
 */

/** The first page this node can link to, depth first. */
export function firstUrl(node: Node): string | undefined {
	if (node.type === "page") return node.url;
	if (node.type !== "folder") return undefined;
	if (node.index) return node.index.url;

	for (const child of node.children) {
		const url = firstUrl(child);
		if (url) return url;
	}
	return undefined;
}

/** Every page url under a node, for "is the reader inside this section?". */
export function pageUrls(node: Node): string[] {
	if (node.type === "page") return [node.url];
	if (node.type !== "folder") return [];
	return [
		...(node.index ? [node.index.url] : []),
		...node.children.flatMap(pageUrls),
	];
}

/**
 * The folders between the root and the page at `url`, outermost first, or undefined when the
 * page is not in this tree. A folder's own index page returns the folders above it and not the
 * folder itself, so the breadcrumb does not name the page twice.
 */
export function folderPath(
	tree: Root | Folder,
	url: string,
): Folder[] | undefined {
	for (const node of tree.children) {
		if (node.type === "page") {
			if (node.url === url) return [];
			continue;
		}
		if (node.type !== "folder") continue;
		if (node.index?.url === url) return [];

		const below = folderPath(node, url);
		if (below) return [node, ...below];
	}
	return undefined;
}
