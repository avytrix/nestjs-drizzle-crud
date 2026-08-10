#!/usr/bin/env node
/**
 * MCP server for nestjs-drizzle-crud.
 *
 * Serves the docs that ship inside the package (AGENT.md, README.md,
 * CHANGELOG.md) to any MCP client: Claude Code, Codex, Cursor, Copilot,
 * Gemini CLI, Windsurf, Zed, Cline and anything else that speaks the protocol.
 *
 * Run it with `npx nestjs-drizzle-crud-mcp` (stdio transport, JSON-RPC 2.0 over
 * newline-delimited messages). It has no dependencies: the protocol surface used
 * here is small enough that an SDK would cost every consumer a package for no
 * gain, and the package ships zero runtime dependencies on purpose.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const PROTOCOL_VERSION = "2025-06-18";
const PACKAGE_ROOT = resolve(__dirname, "..", "..");

// The docs shipped in the npm tarball, keyed by the `doc` tool argument.
const DOCS: Record<string, { file: string; title: string }> = {
	"agent-guide": {
		file: "AGENT.md",
		title: "Agent guide: how to use the package correctly",
	},
	readme: { file: "README.md", title: "README: full API and options" },
	changelog: { file: "CHANGELOG.md", title: "Release history" },
};

interface Section {
	doc: string;
	heading: string;
	level: number;
	body: string;
}

function readDoc(name: string): string {
	try {
		return readFileSync(resolve(PACKAGE_ROOT, DOCS[name]!.file), "utf8");
	} catch {
		// A consumer may have pruned markdown from node_modules; say so instead of
		// crashing the server and taking every other tool call down with it.
		return `(${DOCS[name]!.file} is not available in this installation)`;
	}
}

// Split a markdown file into sections at every ATX heading. Text before the
// first heading becomes an "(intro)" section so nothing is lost.
function sections(doc: string): Section[] {
	const out: Section[] = [];
	let current: Section = { doc, heading: "(intro)", level: 0, body: "" };
	for (const line of readDoc(doc).split("\n")) {
		const match = /^(#{1,6})\s+(.*)$/.exec(line);
		if (match) {
			if (current.body.trim() || current.level > 0) out.push(current);
			current = {
				doc,
				heading: match[2]!.trim(),
				level: match[1]!.length,
				body: "",
			};
		} else {
			current.body += `${line}\n`;
		}
	}
	out.push(current);
	return out;
}

function allSections(): Section[] {
	return Object.keys(DOCS).flatMap(sections);
}

function packageVersion(): string {
	try {
		return JSON.parse(
			readFileSync(resolve(PACKAGE_ROOT, "package.json"), "utf8"),
		).version;
	} catch {
		return "0.0.0";
	}
}

function listDocs(): string {
	return Object.entries(DOCS)
		.map(([name, { title }]) => {
			const headings = sections(name)
				.filter((s) => s.level > 0 && s.level <= 2)
				.map((s) => `  - ${s.heading}`)
				.join("\n");
			return `## ${name}\n${title}\n${headings}`;
		})
		.join("\n\n");
}

function getDoc(name: string, section?: string): string {
	if (!DOCS[name]) {
		return `Unknown doc "${name}". Available: ${Object.keys(DOCS).join(", ")}.`;
	}
	if (!section) return readDoc(name);

	const wanted = section.toLowerCase();
	const found = sections(name).filter((s) =>
		s.heading.toLowerCase().includes(wanted),
	);
	if (found.length === 0) {
		return `No section matching "${section}" in ${name}. Call list_docs for the headings.`;
	}
	return found
		.map((s) => `${"#".repeat(Math.max(1, s.level))} ${s.heading}\n${s.body}`)
		.join("\n");
}

function searchDocs(query: string, limit = 5): string {
	const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
	if (terms.length === 0) return "Empty query.";

	const scored = allSections()
		.map((s) => {
			const heading = s.heading.toLowerCase();
			const body = s.body.toLowerCase();
			let score = 0;
			for (const term of terms) {
				if (heading.includes(term)) score += 5;
				score += body.split(term).length - 1;
			}
			return { section: s, score };
		})
		.filter((hit) => hit.score > 0)
		.sort((a, b) => b.score - a.score)
		.slice(0, Math.max(1, Math.min(limit, 20)));

	if (scored.length === 0) return `No match for "${query}".`;

	return scored
		.map(
			({ section }) =>
				`## ${section.doc} > ${section.heading}\n${section.body.slice(0, 1500).trim()}`,
		)
		.join("\n\n---\n\n");
}

const TOOLS = [
	{
		name: "list_docs",
		description:
			"List the nestjs-drizzle-crud documents available through this server and their top-level headings. Start here.",
		inputSchema: { type: "object", properties: {} },
	},
	{
		name: "get_doc",
		description:
			"Read a nestjs-drizzle-crud document, or one section of it. Use this before writing code that touches the package.",
		inputSchema: {
			type: "object",
			properties: {
				doc: {
					type: "string",
					enum: Object.keys(DOCS),
					description: "Which document to read.",
				},
				section: {
					type: "string",
					description:
						"Optional heading to return instead of the whole document (substring match).",
				},
			},
			required: ["doc"],
		},
	},
	{
		name: "search_docs",
		description:
			"Full-text search across the nestjs-drizzle-crud docs. Returns the most relevant sections, best match first.",
		inputSchema: {
			type: "object",
			properties: {
				query: { type: "string", description: "What to look for." },
				limit: {
					type: "number",
					description: "How many sections to return (default 5, max 20).",
				},
			},
			required: ["query"],
		},
	},
];

function callTool(name: string, args: Record<string, any>): string {
	switch (name) {
		case "list_docs":
			return listDocs();
		case "get_doc":
			return getDoc(String(args.doc ?? ""), args.section as string | undefined);
		case "search_docs":
			return searchDocs(String(args.query ?? ""), Number(args.limit) || 5);
		default:
			throw new Error(`Unknown tool: ${name}`);
	}
}

export interface JsonRpcRequest {
	jsonrpc?: string;
	id?: number | string | null;
	method: string;
	params?: any;
}

// Handle one JSON-RPC message. Returns null for notifications (no id), which
// must not get a response.
export function handleRequest(request: JsonRpcRequest): any | null {
	const { id, method, params } = request;
	const isNotification = id === undefined || id === null;

	const reply = (result: any) => ({ jsonrpc: "2.0", id, result });
	const fail = (code: number, message: string) => ({
		jsonrpc: "2.0",
		id,
		error: { code, message },
	});

	if (isNotification) return null;

	switch (method) {
		case "initialize":
			return reply({
				protocolVersion: params?.protocolVersion ?? PROTOCOL_VERSION,
				capabilities: { tools: {} },
				serverInfo: { name: "nestjs-drizzle-crud", version: packageVersion() },
			});
		case "ping":
			return reply({});
		case "tools/list":
			return reply({ tools: TOOLS });
		case "tools/call":
			try {
				return reply({
					content: [
						{
							type: "text",
							text: callTool(params?.name, params?.arguments ?? {}),
						},
					],
				});
			} catch (error) {
				// Tool failures travel as a result with isError, not a protocol error:
				// the client shows them to the model instead of dropping the turn.
				return reply({
					content: [{ type: "text", text: (error as Error).message }],
					isError: true,
				});
			}
		default:
			return fail(-32601, `Method not found: ${method}`);
	}
}

// stdio transport: one JSON message per line, in and out.
function main(): void {
	let buffer = "";
	process.stdin.setEncoding("utf8");
	process.stdin.on("data", (chunk: string) => {
		buffer += chunk;
		let newline = buffer.indexOf("\n");
		while (newline >= 0) {
			const line = buffer.slice(0, newline).trim();
			buffer = buffer.slice(newline + 1);
			newline = buffer.indexOf("\n");
			if (!line) continue;
			let response: any = null;
			try {
				response = handleRequest(JSON.parse(line));
			} catch {
				response = {
					jsonrpc: "2.0",
					id: null,
					error: { code: -32700, message: "Parse error" },
				};
			}
			if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
		}
	});
	process.stdin.on("end", () => process.exit(0));
}

if (require.main === module) main();
