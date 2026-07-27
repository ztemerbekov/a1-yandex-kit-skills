import { test } from "node:test";
import assert from "node:assert/strict";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { KitClient } from "yandex-kit-core";

import { registerOrderTools } from "./orders.js";

interface RecordedCall {
  url: string;
  init: RequestInit | undefined;
}

async function setup(payload: unknown = { ok: true }) {
  const calls: RecordedCall[] = [];
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
  registerOrderTools(server, client);
  const mcp = new Client({ name: "test-client", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await mcp.connect(clientTransport);
  return { calls, mcp };
}

test("registers exactly the five order tools with correct annotations", async () => {
  const { mcp } = await setup();
  const { tools } = await mcp.listTools();
  const names = tools.map((t) => t.name).sort();
  assert.deepEqual(names, [
    "cancel_order",
    "confirm_order",
    "get_order",
    "get_order_addons",
    "list_orders",
  ]);
  const readOnly = new Set(["list_orders", "get_order", "get_order_addons"]);
  for (const tool of tools) {
    assert.equal(
      tool.annotations?.readOnlyHint,
      readOnly.has(tool.name) ? true : undefined,
      `${tool.name} readOnlyHint`,
    );
  }
});

test("list_orders passes page through and clamps per_page to 100", async () => {
  const { calls, mcp } = await setup({ orders: [], total_count: 0 });
  const res = await mcp.callTool({ name: "list_orders", arguments: { page: 3, per_page: 999 } });
  assert.equal((res as { isError?: boolean }).isError, undefined);
  assert.equal(calls.length, 1);
  const url = new URL(calls[0]!.url);
  assert.equal(url.pathname, "/v1/orders");
  assert.equal(url.searchParams.get("page"), "3");
  assert.equal(url.searchParams.get("per_page"), "100");
});

test("list_orders all=true fetches via listAll with per_page=100", async () => {
  const { calls, mcp } = await setup({ orders: [{ id: "o1" }], total_count: 1 });
  const res = await mcp.callTool({ name: "list_orders", arguments: { all: true } });
  assert.equal(calls.length, 1);
  const url = new URL(calls[0]!.url);
  assert.equal(url.searchParams.get("page"), "1");
  assert.equal(url.searchParams.get("per_page"), "100");
  const data = JSON.parse((res as { content: { text: string }[] }).content[0]!.text);
  assert.deepEqual(data, { items: [{ id: "o1" }], pages: 1, truncated: false });
});

test("get_order hits /v1/orders/{id}", async () => {
  const { calls, mcp } = await setup({ id: "o1" });
  await mcp.callTool({ name: "get_order", arguments: { id: "abc-123" } });
  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0]!.url).pathname, "/v1/orders/abc-123");
  assert.equal(calls[0]!.init?.method, "GET");
});

test("confirm_order POSTs to /v1/orders/{id}/confirm without a body", async () => {
  const { calls, mcp } = await setup({});
  const res = await mcp.callTool({ name: "confirm_order", arguments: { id: "abc-123" } });
  assert.equal((res as { isError?: boolean }).isError, undefined);
  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0]!.url).pathname, "/v1/orders/abc-123/confirm");
  assert.equal(calls[0]!.init?.method, "POST");
  assert.equal(calls[0]!.init?.body, undefined);
});

test("cancel_order POSTs to /v1/orders/{id}/cancel without a body", async () => {
  const { calls, mcp } = await setup({});
  const res = await mcp.callTool({ name: "cancel_order", arguments: { id: "abc-123" } });
  assert.equal((res as { isError?: boolean }).isError, undefined);
  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0]!.url).pathname, "/v1/orders/abc-123/cancel");
  assert.equal(calls[0]!.init?.method, "POST");
  assert.equal(calls[0]!.init?.body, undefined);
});

test("get_order_addons hits /v1/orders/{id}/addons", async () => {
  const { calls, mcp } = await setup({ order_addons: [] });
  await mcp.callTool({ name: "get_order_addons", arguments: { id: "abc-123" } });
  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0]!.url).pathname, "/v1/orders/abc-123/addons");
  assert.equal(calls[0]!.init?.method, "GET");
});
