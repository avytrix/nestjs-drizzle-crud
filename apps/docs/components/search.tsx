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

/**
 * Cmd+K search over the prebuilt Orama index at /api/search, fetched once and searched in the
 * browser, which is all a static GitHub Pages site can offer. Questions in plain words go to the
 * "Ask the docs" assistant instead, which ranks pages by meaning.
 */
export default function DefaultSearchDialog(props: SharedProps) {
	const search = useStaticSearch();

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
