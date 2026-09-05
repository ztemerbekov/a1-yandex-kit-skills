import { test } from "node:test";
import assert from "node:assert/strict";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { KitClient } from "yandex-kit-core";

import { registerDiscountTools } from "./discounts.js";

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
  registerDiscountTools(server, client);
  const mcp = new Client({ name: "test-client", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await mcp.connect(clientTransport);
  return { calls, mcp };
}

function resultText(res: unknown): string {
  return (res as { content: { text: string }[] }).content[0]!.text;
}

const VALID_DISCOUNT = {
  title: "10% off",
  discount_value: { value: "10.00", type: "PERCENT" },
  discount_dates: { start_date: "2026-01-01T00:00:00Z" },
  status: "ACTIVE",
  binding_mode: "ALL_VARIANTS",
};

test("registers exactly the discount tools", async () => {
  const { mcp } = await setup();
  const { tools } = await mcp.listTools();
  const names = tools.map((t) => t.name).sort();
  assert.deepEqual(names, [
    "create_discount",
    "discount_action",
    "get_discount",
    "list_discounts",
    "manage_discount_objects",
    "update_discount",
  ]);
});

test("list_discounts passes status through and clamps per_page to 100", async () => {
  const { calls, mcp } = await setup({ discounts: [], total_count: 0 });
  const res = await mcp.callTool({
    name: "list_discounts",
    arguments: { status: ["ACTIVE", "ARCHIVED"], page: 2, per_page: 999 },
  });
  assert.equal((res as { isError?: boolean }).isError, undefined);
  assert.equal(calls.length, 1);
  const url = new URL(calls[0]!.url);
  assert.equal(url.pathname, "/v1/discounts");
  assert.equal(url.searchParams.get("page"), "2");
  assert.equal(url.searchParams.get("per_page"), "100");
  assert.deepEqual(url.searchParams.getAll("status"), ["ACTIVE", "ARCHIVED"]);
});

test("list_discounts all=true fetches via listAll keeping the status filter", async () => {
  const { calls, mcp } = await setup({ discounts: [{ id: "d1" }], total_count: 1 });
  const res = await mcp.callTool({
    name: "list_discounts",
    arguments: { status: ["ACTIVE"], all: true },
  });
  assert.equal(calls.length, 1);
  const url = new URL(calls[0]!.url);
  assert.equal(url.searchParams.get("page"), "1");
  assert.equal(url.searchParams.get("per_page"), "100");
  assert.deepEqual(url.searchParams.getAll("status"), ["ACTIVE"]);
  const data = JSON.parse(resultText(res));
  assert.deepEqual(data, {
    items: [{ id: "d1" }],
    coverage: "complete",
    received: 1,
    total_count: 1,
    pages_read: 1,
    pages: 1,
    truncated: false,
  });
});

test("get_discount hits /v1/discounts/{id}", async () => {
  const { calls, mcp } = await setup({ id: "d1" });
  await mcp.callTool({ name: "get_discount", arguments: { id: "abc-123" } });
  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0]!.url).pathname, "/v1/discounts/abc-123");
  assert.equal(calls[0]!.init?.method, "GET");
});

test("create_discount with invalid body fails without any network call", async () => {
  const { calls, mcp } = await setup();
  // CreateDiscountRequest requires title, discount_value, discount_dates, status, binding_mode.
  const res = await mcp.callTool({ name: "create_discount", arguments: { discount: {} } });
  assert.equal((res as { isError?: boolean }).isError, true);
  assert.equal(JSON.parse(resultText(res)).code, "LOCAL_VALIDATION_ERROR");
  assert.equal(calls.length, 0);
});

test("create_discount with a minimal valid body performs the request", async () => {
  const { calls, mcp } = await setup({ id: "d1" });
  const res = await mcp.callTool({
    name: "create_discount",
    arguments: { discount: VALID_DISCOUNT },
  });
  assert.equal((res as { isError?: boolean }).isError, undefined);
  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0]!.url).pathname, "/v1/discounts");
  assert.equal(calls[0]!.init?.method, "POST");
  const headers = calls[0]!.init?.headers as Record<string, string>;
  assert.equal(headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(calls[0]!.init?.body as string), VALID_DISCOUNT);
});

test("update_discount with an empty body fails without any network call", async () => {
  const { calls, mcp } = await setup();
  const res = await mcp.callTool({ name: "update_discount", arguments: { id: "d1", discount: {} } });
  assert.equal((res as { isError?: boolean }).isError, true);
  assert.equal(JSON.parse(resultText(res)).code, "EMPTY_UPDATE_BODY");
  assert.equal(calls.length, 0);
});

test("update_discount with a spec-invalid body fails without any network call", async () => {
  const { calls, mcp } = await setup();
  const res = await mcp.callTool({
    name: "update_discount",
    arguments: { id: "d1", discount: { status: "BOGUS" } },
  });
  assert.equal((res as { isError?: boolean }).isError, true);
  assert.equal(calls.length, 0);
});

test("update_discount sends a plain application/json PATCH", async () => {
  const { calls, mcp } = await setup({ id: "d1" });
  const res = await mcp.callTool({
    name: "update_discount",
    arguments: { id: "d1", discount: { title: "New title" } },
  });
  assert.equal((res as { isError?: boolean }).isError, undefined);
  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0]!.url).pathname, "/v1/discounts/d1");
  assert.equal(calls[0]!.init?.method, "PATCH");
  const headers = calls[0]!.init?.headers as Record<string, string>;
  assert.equal(headers["Content-Type"], "application/json");
});

test("discount_action archive hits /v1/discounts/{id}/archive", async () => {
  const { calls, mcp } = await setup({ id: "d1" });
  await mcp.callTool({ name: "discount_action", arguments: { id: "d1", action: "archive" } });
  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0]!.url).pathname, "/v1/discounts/d1/archive");
  assert.equal(calls[0]!.init?.method, "POST");
});

test("discount_action unarchive hits /v1/discounts/{id}/unarchive", async () => {
  const { calls, mcp } = await setup({ id: "d1" });
  await mcp.callTool({ name: "discount_action", arguments: { id: "d1", action: "unarchive" } });
  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0]!.url).pathname, "/v1/discounts/d1/unarchive");
});

test("manage_discount_objects with invalid body fails without any network call", async () => {
  const { calls, mcp } = await setup();
  const res = await mcp.callTool({
    name: "manage_discount_objects",
    arguments: { id: "d1", action: "add", objects: { product_variant_ids: "not-an-array" } },
  });
  assert.equal((res as { isError?: boolean }).isError, true);
  assert.equal(calls.length, 0);
});

test("manage_discount_objects add hits /v1/discounts/{id}/objects/add", async () => {
  const { calls, mcp } = await setup({ ok: true });
  const objects = { product_variant_ids: ["019b21d9-c5d9-777d-80bd-d67c664bc6d9"] };
  const res = await mcp.callTool({
    name: "manage_discount_objects",
    arguments: { id: "d1", action: "add", objects },
  });
  assert.equal((res as { isError?: boolean }).isError, undefined);
  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0]!.url).pathname, "/v1/discounts/d1/objects/add");
  assert.equal(calls[0]!.init?.method, "POST");
  assert.deepEqual(JSON.parse(calls[0]!.init?.body as string), objects);
});

test("manage_discount_objects remove hits /v1/discounts/{id}/objects/remove", async () => {
  const { calls, mcp } = await setup({ ok: true });
  const objects = { category_ids: ["019b21d9-c5d9-777d-80bd-d67c664bc6d9"] };
  const res = await mcp.callTool({
    name: "manage_discount_objects",
    arguments: { id: "d1", action: "remove", objects },
  });
  assert.equal((res as { isError?: boolean }).isError, undefined);
  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0]!.url).pathname, "/v1/discounts/d1/objects/remove");
});
