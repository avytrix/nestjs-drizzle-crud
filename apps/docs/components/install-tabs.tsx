import { DynamicCodeBlock } from "fumadocs-ui/components/dynamic-codeblock";
import { Tab, Tabs } from "fumadocs-ui/components/tabs";
import { siteConfig } from "@/lib/seo";

/**
 * One command, four package managers, each with its own copy button.
 *
 * A component rather than four fenced blocks per page: the four commands only differ by a
 * prefix, and typing them out is how three go stale while the fourth is right. `groupId` keeps
 * the chosen tab in sync across every instance and remembers it, so a pnpm user picks pnpm once.
 */
const MANAGERS = [
	{ name: "pnpm", add: "pnpm add", run: "pnpm dlx" },
	{ name: "npm", add: "npm install", run: "npx" },
	{ name: "yarn", add: "yarn add", run: "yarn dlx" },
	{ name: "bun", add: "bun add", run: "bunx" },
] as const;

export function InstallTabs({
	pkg = siteConfig.name,
	dev = false,
}: {
	/** Package name, or several separated by spaces. Defaults to this package. */
	pkg?: string;
	dev?: boolean;
}) {
	return (
		<Tabs groupId="package-manager" persist items={MANAGERS.map((m) => m.name)}>
			{MANAGERS.map((m) => {
				const flag = dev ? (m.name === "npm" ? " --save-dev" : " -D") : "";
				return (
					<Tab key={m.name} value={m.name}>
						<DynamicCodeBlock lang="bash" code={`${m.add} ${pkg}${flag}`} />
					</Tab>
				);
			})}
		</Tabs>
	);
}

/** The same, for one-off commands run without installing. */
export function RunTabs({ command }: { command: string }) {
	return (
		<Tabs groupId="package-manager" persist items={MANAGERS.map((m) => m.name)}>
			{MANAGERS.map((m) => (
				<Tab key={m.name} value={m.name}>
					<DynamicCodeBlock lang="bash" code={`${m.run} ${command}`} />
				</Tab>
			))}
		</Tabs>
	);
}
