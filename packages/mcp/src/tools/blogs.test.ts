import { test } from "node:test";
import assert from "node:assert/strict";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { KitClient } from "yandex-kit-core";

import { registerBlogTools } from "./blogs.js";

async function setup(payload: unknown = { ok: true }) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const client = new KitClient({
    token: "t",
    rps: 1000,
    fetchImpl: (async (url: unknown, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch,
  });
  const server = new McpServer({ name: "test-server", version: "0.0.0" });
  registerBlogTools(server, client);
  const mcp = new Client({ name: "test-client", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await mcp.connect(clientTransport);
  return { calls, mcp };
}

test("blog tools expose read and write operations without delete", async () => {
  const { mcp } = await setup();
  const { tools } = await mcp.listTools();
  assert.deepEqual(tools.map((tool) => tool.name).sort(), [
    "create_blog",
    "get_blog",
    "list_blogs",
    "update_blog",
  ]);
  assert.equal(tools.find((tool) => tool.name === "list_blogs")?.annotations?.readOnlyHint, true);
  assert.equal(tools.find((tool) => tool.name === "create_blog")?.annotations?.readOnlyHint, undefined);
});

test("create_blog sends a validated POST", async () => {
  const { calls, mcp } = await setup({ id: "b1" });
  const blog = {
    title: "Новость",
    content: "Текст",
    blog_dates: { start_date: "2026-08-16T00:00:00Z" },
    tags: [],
    status: "ACTIVE",
  };
  const result = await mcp.callTool({ name: "create_blog", arguments: { blog } });
  assert.equal((result as { isError?: boolean }).isError, undefined);
  assert.equal(new URL(calls[0]!.url).pathname, "/v1/blogs");
  assert.equal(calls[0]!.init?.method, "POST");
});

test("update_blog rejects an empty body before the network", async () => {
  const { calls, mcp } = await setup();
  const result = await mcp.callTool({
    name: "update_blog",
    arguments: { id: "b1", blog: {} },
  });
  assert.equal((result as { isError?: boolean }).isError, true);
  assert.equal(calls.length, 0);
});
