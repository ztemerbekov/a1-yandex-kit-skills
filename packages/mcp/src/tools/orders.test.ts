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

test("registers exactly the seven order tools with correct annotations", async () => {
  const { mcp } = await setup();
  const { tools } = await mcp.listTools();
  const names = tools.map((t) => t.name).sort();
  assert.deepEqual(names, [
    "cancel_order",
    "complete_order_delivery",
    "confirm_order",
    "get_order",
    "get_order_addons",
    "list_orders",
    "set_order_marking_codes",
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
  const res = await mcp.callTool({
    name: "cancel_order",
    arguments: { id: "abc-123", reason: "customer requested cancellation" },
  });
  assert.equal((res as { isError?: boolean }).isError, undefined);
  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0]!.url).pathname, "/v1/orders/abc-123/cancel");
  assert.equal(calls[0]!.init?.method, "POST");
  assert.equal(calls[0]!.init?.body, undefined);
});

test("cancel_order documents owner reason as log context that KIT does not store", async () => {
  const { mcp } = await setup({});
  const { tools } = await mcp.listTools();
  const cancel = tools.find((tool) => tool.name === "cancel_order");
  const reason = (
    cancel?.inputSchema as {
      properties?: { reason?: { description?: string } };
    }
  ).properties?.reason;

  assert.ok(reason);
  assert.match(reason.description ?? "", /not sent to or stored by the KIT API/i);
});

test("get_order_addons hits /v1/orders/{id}/addons", async () => {
  const { calls, mcp } = await setup({ order_addons: [] });
  await mcp.callTool({ name: "get_order_addons", arguments: { id: "abc-123" } });
  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0]!.url).pathname, "/v1/orders/abc-123/addons");
  assert.equal(calls[0]!.init?.method, "GET");
});

test("complete_order_delivery POSTs to /v1/orders/{id}/delivery/complete without a body", async () => {
  const { calls, mcp } = await setup({});
  const res = await mcp.callTool({ name: "complete_order_delivery", arguments: { id: "abc-123" } });
  assert.equal((res as { isError?: boolean }).isError, undefined);
  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0]!.url).pathname, "/v1/orders/abc-123/delivery/complete");
  assert.equal(calls[0]!.init?.method, "POST");
  assert.equal(calls[0]!.init?.body, undefined);
});

test("set_order_marking_codes POSTs the batch to /v1/orders/{id}/marking-codes", async () => {
  const { calls, mcp } = await setup({});
  const res = await mcp.callTool({
    name: "set_order_marking_codes",
    arguments: {
      id: "abc-123",
      items: [
        {
          order_item_id: "00000000-0000-0000-0000-000000000001",
          marking_code: "0104670147122765215Fx_t42mlIYny91EE1192Z5CcNr9XGy6luZHI79Fy20sQ=",
        },
        { order_item_id: "00000000-0000-0000-0000-000000000002", marking_code: null },
      ],
    },
  });
  assert.equal((res as { isError?: boolean }).isError, undefined);
  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0]!.url).pathname, "/v1/orders/abc-123/marking-codes");
  assert.equal(calls[0]!.init?.method, "POST");
  assert.deepEqual(JSON.parse(String(calls[0]!.init?.body)), {
    items: [
      {
        order_item_id: "00000000-0000-0000-0000-000000000001",
        marking_code: "0104670147122765215Fx_t42mlIYny91EE1192Z5CcNr9XGy6luZHI79Fy20sQ=",
      },
      { order_item_id: "00000000-0000-0000-0000-000000000002", marking_code: null },
    ],
  });
});

test("set_order_marking_codes rejects a repeated order item before the network call", async () => {
  const { calls, mcp } = await setup({});
  const res = await mcp.callTool({
    name: "set_order_marking_codes",
    arguments: {
      id: "abc-123",
      items: [
        { order_item_id: "00000000-0000-0000-0000-000000000001", marking_code: "code-a" },
        { order_item_id: "00000000-0000-0000-0000-000000000001", marking_code: null },
      ],
    },
  });
  assert.equal((res as { isError?: boolean }).isError, true);
  const payload = JSON.parse((res as { content: { text: string }[] }).content[0]!.text);
  assert.equal(payload.code, "DUPLICATE_ORDER_ITEM_ID");
  assert.match(payload.error, /00000000-0000-0000-0000-000000000001/);
  assert.equal(calls.length, 0);
});

test("set_order_marking_codes rejects an empty batch before the network call", async () => {
  // .min(1) on the zod array rejects at the protocol layer, before the handler.
  const { calls, mcp } = await setup({});
  let errored = false;
  try {
    const res = await mcp.callTool({
      name: "set_order_marking_codes",
      arguments: { id: "abc-123", items: [] },
    });
    errored = (res as { isError?: boolean }).isError === true;
  } catch {
    errored = true;
  }
  assert.equal(errored, true);
  assert.equal(calls.length, 0);
});
