/**
 * @jest-environment node
 *
 * MCP server contract: the handshake, the tool list, and the three doc tools.
 * Runs against the real AGENT.md / README.md / CHANGELOG.md in the package.
 */

import { describe, expect, it } from "@jest/globals";
import { handleRequest } from "../src/mcp/server";

const call = (name: string, args: Record<string, any> = {}) =>
	handleRequest({
		jsonrpc: "2.0",
		id: 1,
		method: "tools/call",
		params: { name, arguments: args },
	});

const textOf = (response: any): string => response.result.content[0].text;

describe("MCP handshake", () => {
	it("answers initialize with the client's protocol version and tool capability", () => {
		const response: any = handleRequest({
			jsonrpc: "2.0",
			id: 0,
			method: "initialize",
			params: { protocolVersion: "2025-06-18" },
		});
		expect(response.result.protocolVersion).toBe("2025-06-18");
		expect(response.result.capabilities.tools).toBeDefined();
		expect(response.result.serverInfo.name).toBe("nestjs-drizzle-crud");
		expect(response.result.serverInfo.version).toMatch(/^\d+\.\d+\.\d+/);
	});

	it("stays silent for notifications", () => {
		expect(
			handleRequest({ jsonrpc: "2.0", method: "notifications/initialized" }),
		).toBeNull();
	});

	it("answers ping", () => {
		const response: any = handleRequest({
			jsonrpc: "2.0",
			id: 2,
			method: "ping",
		});
		expect(response.result).toEqual({});
	});

	it("returns -32601 for an unknown method", () => {
		const response: any = handleRequest({
			jsonrpc: "2.0",
			id: 3,
			method: "resources/list",
		});
		expect(response.error.code).toBe(-32601);
	});
});

describe("MCP tools", () => {
	it("advertises the three doc tools with input schemas", () => {
		const response: any = handleRequest({
			jsonrpc: "2.0",
			id: 4,
			method: "tools/list",
		});
		const names = response.result.tools.map((t: any) => t.name);
		expect(names).toEqual(["list_docs", "get_doc", "search_docs"]);
		for (const tool of response.result.tools) {
			expect(tool.inputSchema.type).toBe("object");
			expect(tool.description.length).toBeGreaterThan(20);
		}
	});

	it("list_docs names every document and its headings", () => {
		const text = textOf(call("list_docs"));
		expect(text).toContain("agent-guide");
		expect(text).toContain("readme");
		expect(text).toContain("changelog");
		expect(text).toContain("Core Principles");
	});

	it("get_doc returns a whole document", () => {
		const text = textOf(call("get_doc", { doc: "agent-guide" }));
		expect(text).toContain("nestjs-drizzle-crud");
		expect(text.length).toBeGreaterThan(1000);
	});

	it("get_doc returns a single section when asked", () => {
		const text = textOf(
			call("get_doc", { doc: "agent-guide", section: "Core Principles" }),
		);
		expect(text).toContain("Core Principles");
		expect(text.length).toBeLessThan(3000);
	});

	it("get_doc explains an unknown doc instead of throwing", () => {
		const text = textOf(call("get_doc", { doc: "nope" }));
		expect(text).toContain("Unknown doc");
	});

	it("search_docs finds the relations guidance", () => {
		const text = textOf(
			call("search_docs", { query: "relations eager loading" }),
		);
		expect(text.toLowerCase()).toContain("relation");
	});

	it("search_docs reports a miss plainly", () => {
		const text = textOf(call("search_docs", { query: "zzzznotinthedocs" }));
		expect(text).toContain("No match");
	});

	it("reports an unknown tool as an error result, not a protocol error", () => {
		const response: any = call("does_not_exist");
		expect(response.result.isError).toBe(true);
		expect(response.result.content[0].text).toContain("Unknown tool");
	});
});
