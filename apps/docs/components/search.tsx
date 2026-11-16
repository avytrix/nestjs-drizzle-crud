"use client";
import { useStaticSearch } from "fumadocs-core/search/client";
import {
	SearchDialog,
	SearchDialogClose,
	SearchDialogContent,
	SearchDialogHeader,
	SearchDialogIcon,
	SearchDialogInput,
	SearchDialogList,
	SearchDialogOverlay,
	type SharedProps,
} from "fumadocs-ui/components/dialog/search";
import { withBasePath } from "@/lib/seo";

/**
 * Cmd+K search over the prebuilt Orama index at <basePath>/api/search, fetched once and searched in the
 * browser, which is all a static GitHub Pages site can offer. Questions in plain words go to the
 * "Ask the docs" assistant instead, which ranks pages by meaning.
 */
export default function DefaultSearchDialog(props: SharedProps) {
	// Fumadocs only prefixes a Vite base path, so the Next basePath is passed in.
	const search = useStaticSearch({ from: withBasePath("/api/search") });

	return (
		<SearchDialog {...search} {...props}>
			<SearchDialogOverlay />
			<SearchDialogContent>
				<SearchDialogHeader>
					<SearchDialogIcon />
					<SearchDialogInput />
					<SearchDialogClose />
				</SearchDialogHeader>
				<SearchDialogList />
			</SearchDialogContent>
		</SearchDialog>
	);
}
