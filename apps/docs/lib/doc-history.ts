import { execFileSync } from "node:child_process";
import { siteConfig } from "./seo";

/**
 * When a docs page last changed, read from git at build time.
 *
 * Nothing here is hand maintained, because a hand-kept "last updated" is wrong the first time
 * someone forgets it. It needs real history: deploy-docs.yml checks out with `fetch-depth: 0`
 * for this. In a shallow clone (CI's verify job) the dates are missing or wrong-looking, and a
 * missing date renders nothing rather than a guess.
 *
 * Paths are relative to apps/docs, which is the working directory of `next build`.
 */
const cache = new Map<string, string | null>();

function git(args: string[]): string | null {
	try {
		return execFileSync("git", args, {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
		}).trim();
	} catch {
		// No git, or not a checkout: the caller renders nothing instead of a made-up date.
		return null;
	}
}

export function lastModified(contentPath: string): string | null {
	const file = `content/docs/${contentPath}`;
	const hit = cache.get(file);
	if (hit !== undefined) return hit;

	const out = git(["log", "-1", "--format=%cI", "--", file]);
	const iso = out && out.length > 0 ? out : null;
	cache.set(file, iso);
	return iso;
}

/** The page's own commit history on GitHub, the full record behind that one date. */
export function historyUrl(contentPath: string): string {
	const { repo, branch, contentDir } = siteConfig.git;
	return `https://github.com/${repo}/commits/${branch}/${contentDir}/${contentPath}`;
}

/** The page's source on GitHub. */
export function sourceUrl(contentPath: string): string {
	const { repo, branch, contentDir } = siteConfig.git;
	return `https://github.com/${repo}/blob/${branch}/${contentDir}/${contentPath}`;
}

export interface DocCommit {
	sha: string;
	shortSha: string;
	date: string;
	subject: string;
}

/**
 * Recent commits that touched the docs content, for the changelog page.
 *
 * Only `content/docs` is followed, so a styling change or a dependency bump does not show up as
 * a docs change. Merge commits are left out because the squash-merge flow already puts the real
 * subject on the commit itself.
 */
export function recentDocCommits(limit = 40): DocCommit[] {
	const out = git([
		"log",
		`-${limit}`,
		"--no-merges",
		"--format=%H%x1f%cI%x1f%s",
		"--",
		"content/docs",
	]);
	if (!out) return [];

	return out.split("\n").map((line) => {
		const [sha = "", date = "", subject = ""] = line.split("\u001f");
		return { sha, shortSha: sha.slice(0, 7), date, subject };
	});
}
