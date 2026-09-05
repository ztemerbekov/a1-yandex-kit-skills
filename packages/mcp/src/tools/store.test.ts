import { test } from "node:test";
import assert from "node:assert/strict";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { KitClient } from "yandex-kit-core";
import { registerStoreTools } from "./store.js";

interface RecordedCall {
  url: string;
  init: RequestInit | undefined;
}

async function setup(payload: unknown) {
  const calls: RecordedCall[] = [];
  const client = new KitClient({
    token: "t",
    rps: 1000,
    fetchImpl: (async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch,
  });

  const server = new McpServer({ name: "test-server", version: "0.0.0" });
  registerStoreTools(server, client);

  const mcpClient = new Client({ name: "test-client", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await mcpClient.connect(clientTransport);
  return { calls, mcpClient };
}

test("registers exactly get_store, get_current_user, get_regions, get_store_feeds with read-only annotations", async () => {
  const { mcpClient } = await setup({ store: "x" });
  const { tools } = await mcpClient.listTools();
  const names = tools.map((t) => t.name).sort();
  assert.deepEqual(names, ["get_current_user", "get_regions", "get_store", "get_store_feeds"]);
  for (const tool of tools) {
    assert.equal(tool.annotations?.readOnlyHint, true, `${tool.name} must be read-only`);
  }
});

test("get_store returns the stub payload as JSON text", async () => {
  const payload = { store: "x" };
  const { calls, mcpClient } = await setup(payload);
  const res = (await mcpClient.callTool({ name: "get_store", arguments: {} })) as {
    isError?: boolean;
    content: { type: string; text: string }[];
  };
  assert.ok(!res.isError);
  assert.equal(res.content[0]?.type, "text");
  assert.deepEqual(JSON.parse(res.content[0]!.text), payload);
  assert.equal(calls.length, 1);
  assert.ok(calls[0]!.url.endsWith("/v1/store"));
});

test("get_current_user and get_regions hit their endpoints", async () => {
  const { calls, mcpClient } = await setup({ ok: 1 });
  await mcpClient.callTool({ name: "get_current_user", arguments: {} });
  await mcpClient.callTool({ name: "get_regions", arguments: {} });
  assert.deepEqual(
    calls.map((c) => new URL(c.url).pathname),
    ["/v1/users/current", "/v1/geo/regions"],
  );
});

test("get_store maps a KIT API error to isError result without throwing", async () => {
  const client = new KitClient({
    token: "t",
    rps: 1000,
    maxRetries: 0,
    fetchImpl: (async () =>
      new Response(
        JSON.stringify({ code: "AUTHENTICATION_ERROR", message: "auth failed", trace_id: "tr1" }),
        { status: 401, headers: { "content-type": "application/json" } },
      )) as typeof fetch,
  });
  const server = new McpServer({ name: "test-server", version: "0.0.0" });
  registerStoreTools(server, client);
  const mcpClient = new Client({ name: "test-client", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await mcpClient.connect(clientTransport);

  const res = (await mcpClient.callTool({ name: "get_store", arguments: {} })) as {
    isError?: boolean;
    content: { type: string; text: string }[];
  };
  assert.equal(res.isError, true);
  const body = JSON.parse(res.content[0]!.text) as Record<string, unknown>;
  assert.equal(body.code, "AUTHENTICATION_ERROR");
  assert.equal(body.status, 401);
  assert.equal(body.traceId, "tr1");
});

test("get_store_feeds hits /v1/store/feeds and returns the payload", async () => {
  const payload = { feeds: [{ type: "ICML", url: "https://example.com/feed.xml" }] };
  const { calls, mcpClient } = await setup(payload);
  const res = (await mcpClient.callTool({ name: "get_store_feeds", arguments: {} })) as {
    isError?: boolean;
    content: { type: string; text: string }[];
  };
  assert.ok(!res.isError);
  assert.deepEqual(JSON.parse(res.content[0]!.text), payload);
  assert.ok(calls[0]!.url.endsWith("/v1/store/feeds"));
});
