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
  assert.deepEqual(data, {
    items: [{ id: "o1" }],
    coverage: "complete",
    received: 1,
    total_count: 1,
    pages_read: 1,
  });
});

test("list_orders all=true reports coverage partial when the listing is truncated", async () => {
  // A short page that contradicts total_count: listAll flags truncation.
  const { mcp } = await setup({
    orders: Array.from({ length: 50 }, (_, i) => ({ id: `o${i}` })),
    total_count: 700,
  });
  const res = await mcp.callTool({ name: "list_orders", arguments: { all: true } });
  const data = JSON.parse((res as { content: { text: string }[] }).content[0]!.text);
  assert.equal(data.coverage, "partial");
  assert.equal(data.received, 50);
  assert.equal(data.total_count, 700);
  assert.equal(data.pages_read, 1);
});

test("list_orders single page reports coverage partial when total_count exceeds received", async () => {
  const { mcp } = await setup({ orders: [{ id: "o1" }, { id: "o2" }], total_count: 50 });
  const res = await mcp.callTool({ name: "list_orders", arguments: { page: 1 } });
  const data = JSON.parse((res as { content: { text: string }[] }).content[0]!.text);
  assert.equal(data.coverage, "partial");
  assert.equal(data.received, 2);
  assert.equal(data.total_count, 50);
  assert.equal(data.pages_read, 1);
  assert.deepEqual(data.orders, [{ id: "o1" }, { id: "o2" }]);
});

test("list_orders single page without total_count: a full page is partial (may continue)", async () => {
  const { mcp } = await setup({ orders: [{ id: "o1" }, { id: "o2" }, { id: "o3" }] });
  const res = await mcp.callTool({ name: "list_orders", arguments: { per_page: 3 } });
  const data = JSON.parse((res as { content: { text: string }[] }).content[0]!.text);
  assert.equal(data.coverage, "partial");
  assert.equal(data.received, 3);
  assert.equal(data.total_count, undefined);
  assert.equal(data.pages_read, 1);
});

test("list_orders single page without total_count: a short page is complete", async () => {
  const { mcp } = await setup({ orders: [{ id: "o1" }, { id: "o2" }] });
  const res = await mcp.callTool({ name: "list_orders", arguments: { per_page: 5 } });
  const data = JSON.parse((res as { content: { text: string }[] }).content[0]!.text);
  assert.equal(data.coverage, "complete");
  assert.equal(data.received, 2);
  assert.equal(data.pages_read, 1);
});

const PII_ORDER = {
  id: "o1",
  order_number: 1234567,
  created_at: "2020-01-01T00:00:00Z",
  status: "CREATED",
  total_price: "1200.00",
  client: {
    first_name: "Иван",
    last_name: "Иванов",
    patronymic: "Иванович",
    phone: "+79991234567",
    email: "ivan@example.com",
    is_notify: true,
  },
  delivery_chunks: [
    {
      id: 0,
      total_price: "1200.00",
      delivery_info: {
        raw_status: "IN_TRANSIT",
        delivery_notes: "код домофона 42",
        address: {
          courier_locality: "Москва",
          courier_address: "ул. Ленина, 1",
          appartment: "5",
          entrance: "2",
          intercom: "42",
          pickup_point_id: "pp-1",
        },
      },
      items: [{ id: "i1", price: "1200.00", quantity: 2 }],
    },
  ],
};

test("get_order redact:true masks nested personal fields but not ids/amounts/statuses", async () => {
  const { mcp } = await setup(PII_ORDER);
  const res = await mcp.callTool({ name: "get_order", arguments: { id: "o1", redact: true } });
  assert.equal((res as { isError?: boolean }).isError, undefined);
  const data = JSON.parse((res as { content: { text: string }[] }).content[0]!.text);
  // personal fields masked, including nested ones
  assert.deepEqual(data.client, {
    first_name: "[redacted]",
    last_name: "[redacted]",
    patronymic: "[redacted]",
    phone: "[redacted]",
    email: "[redacted]",
    is_notify: true,
  });
  const info = data.delivery_chunks[0].delivery_info;
  assert.equal(info.delivery_notes, "[redacted]");
  assert.deepEqual(info.address, {
    courier_locality: "[redacted]",
    courier_address: "[redacted]",
    appartment: "[redacted]",
    entrance: "[redacted]",
    intercom: "[redacted]",
    pickup_point_id: "pp-1", // identifier, not PII
  });
  // ids, amounts, statuses and dates survive untouched
  assert.equal(data.id, "o1");
  assert.equal(data.order_number, 1234567);
  assert.equal(data.created_at, "2020-01-01T00:00:00Z");
  assert.equal(data.status, "CREATED");
  assert.equal(data.total_price, "1200.00");
  assert.deepEqual(data.delivery_chunks[0].items, [{ id: "i1", price: "1200.00", quantity: 2 }]);
});

test("get_order without redact returns personal fields untouched", async () => {
  const { mcp } = await setup(PII_ORDER);
  const res = await mcp.callTool({ name: "get_order", arguments: { id: "o1" } });
  const data = JSON.parse((res as { content: { text: string }[] }).content[0]!.text);
  assert.deepEqual(data, PII_ORDER);
});

test("list_orders redact:true masks personal fields inside every listed order", async () => {
  const { calls, mcp } = await setup({ orders: [PII_ORDER], total_count: 1 });
  const res = await mcp.callTool({ name: "list_orders", arguments: { redact: true } });
  const data = JSON.parse((res as { content: { text: string }[] }).content[0]!.text);
  assert.equal(data.orders[0].client.phone, "[redacted]");
  assert.equal(data.orders[0].id, "o1");
  assert.equal(data.total_count, 1);
  // redact is response-side only: the request carries no redact flag
  assert.equal(new URL(calls[0]!.url).searchParams.get("redact"), null);
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
