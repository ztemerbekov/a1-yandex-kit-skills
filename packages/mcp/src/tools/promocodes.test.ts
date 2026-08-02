import { test } from "node:test";
import assert from "node:assert/strict";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { KitClient } from "yandex-kit-core";

import { registerPromocodeTools } from "./promocodes.js";

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
  registerPromocodeTools(server, client);
  const mcp = new Client({ name: "test-client", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await mcp.connect(clientTransport);
  return { calls, mcp };
}

function resultText(res: unknown): string {
  return (res as { content: { text: string }[] }).content[0]!.text;
}

const VALID_PROMOCODE = {
  code: "HELLO5",
  title: "5% off everything",
  discount_value: { value: "5.00", type: "PERCENT" },
  promocode_dates: { start_date: "2026-01-01T00:00:00Z" },
  type: "ORDER",
};

test("registers exactly the promocode tools (no archive action)", async () => {
  const { mcp } = await setup();
  const { tools } = await mcp.listTools();
  const names = tools.map((t) => t.name).sort();
  assert.deepEqual(names, [
    "create_promocode",
    "get_promocode",
    "list_promocodes",
    "manage_promocode_objects",
    "update_promocode",
  ]);
});

// The live API caps per_page at 25 for /v1/promocodes (stricter than the spec's 100).
test("list_promocodes passes status through and clamps per_page to the server cap of 25", async () => {
  const { calls, mcp } = await setup({ promocodes: [], total_count: 0 });
  const res = await mcp.callTool({
    name: "list_promocodes",
    arguments: { status: "ACTIVE", page: 2, per_page: 999 },
  });
  assert.equal((res as { isError?: boolean }).isError, undefined);
  assert.equal(calls.length, 1);
  const url = new URL(calls[0]!.url);
  assert.equal(url.pathname, "/v1/promocodes");
  assert.equal(url.searchParams.get("page"), "2");
  assert.equal(url.searchParams.get("per_page"), "25");
  assert.equal(url.searchParams.get("status"), "ACTIVE");
});

test("list_promocodes all=true fetches via listAll within the server per_page cap", async () => {
  const { calls, mcp } = await setup({ promocodes: [{ id: "pc1" }], total_count: 1 });
  const res = await mcp.callTool({
    name: "list_promocodes",
    arguments: { status: "INACTIVE", all: true },
  });
  assert.equal(calls.length, 1);
  const url = new URL(calls[0]!.url);
  assert.equal(url.searchParams.get("page"), "1");
  assert.equal(url.searchParams.get("per_page"), "25");
  assert.equal(url.searchParams.get("status"), "INACTIVE");
  const data = JSON.parse(resultText(res));
  assert.deepEqual(data, { items: [{ id: "pc1" }], pages: 1, truncated: false });
});

test("get_promocode hits /v1/promocodes/{id}", async () => {
  const { calls, mcp } = await setup({ id: "pc1" });
  await mcp.callTool({ name: "get_promocode", arguments: { id: "abc-123" } });
  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0]!.url).pathname, "/v1/promocodes/abc-123");
  assert.equal(calls[0]!.init?.method, "GET");
});

test("create_promocode with invalid body fails without any network call", async () => {
  const { calls, mcp } = await setup();
  // CreatePromocodeRequest requires code, title, discount_value, promocode_dates, type.
  const res = await mcp.callTool({ name: "create_promocode", arguments: { promocode: {} } });
  assert.equal((res as { isError?: boolean }).isError, true);
  assert.match(resultText(res), /code/);
  assert.equal(calls.length, 0);
});

test("create_promocode with a minimal valid body performs the request", async () => {
  const { calls, mcp } = await setup({ id: "pc1" });
  const res = await mcp.callTool({
    name: "create_promocode",
    arguments: { promocode: VALID_PROMOCODE },
  });
  assert.equal((res as { isError?: boolean }).isError, undefined);
  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0]!.url).pathname, "/v1/promocodes");
  assert.equal(calls[0]!.init?.method, "POST");
  const headers = calls[0]!.init?.headers as Record<string, string>;
  assert.equal(headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(calls[0]!.init?.body as string), VALID_PROMOCODE);
});

test("update_promocode with an empty body fails without any network call", async () => {
  const { calls, mcp } = await setup();
  const res = await mcp.callTool({
    name: "update_promocode",
    arguments: { id: "pc1", promocode: {} },
  });
  assert.equal((res as { isError?: boolean }).isError, true);
  assert.match(resultText(res), /empty/i);
  assert.equal(calls.length, 0);
});

test("update_promocode with a spec-invalid body fails without any network call", async () => {
  const { calls, mcp } = await setup();
  const res = await mcp.callTool({
    name: "update_promocode",
    arguments: { id: "pc1", promocode: { status: "BOGUS" } },
  });
  assert.equal((res as { isError?: boolean }).isError, true);
  assert.equal(calls.length, 0);
});

test("update_promocode sends a plain application/json PATCH", async () => {
  const { calls, mcp } = await setup({ id: "pc1" });
  const res = await mcp.callTool({
    name: "update_promocode",
    arguments: { id: "pc1", promocode: { title: "New title" } },
  });
  assert.equal((res as { isError?: boolean }).isError, undefined);
  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0]!.url).pathname, "/v1/promocodes/pc1");
  assert.equal(calls[0]!.init?.method, "PATCH");
  const headers = calls[0]!.init?.headers as Record<string, string>;
  assert.equal(headers["Content-Type"], "application/json");
});

test("manage_promocode_objects with invalid body fails without any network call", async () => {
  const { calls, mcp } = await setup();
  const res = await mcp.callTool({
    name: "manage_promocode_objects",
    arguments: { id: "pc1", action: "add", objects: { product_variant_ids: "not-an-array" } },
  });
  assert.equal((res as { isError?: boolean }).isError, true);
  assert.equal(calls.length, 0);
});

test("manage_promocode_objects add hits /v1/promocodes/{id}/objects/add", async () => {
  const { calls, mcp } = await setup({ ok: true });
  const objects = { product_variant_ids: ["019b21d9-c5d9-777d-80bd-d67c664bc6d9"] };
  const res = await mcp.callTool({
    name: "manage_promocode_objects",
    arguments: { id: "pc1", action: "add", objects },
  });
  assert.equal((res as { isError?: boolean }).isError, undefined);
  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0]!.url).pathname, "/v1/promocodes/pc1/objects/add");
  assert.equal(calls[0]!.init?.method, "POST");
  assert.deepEqual(JSON.parse(calls[0]!.init?.body as string), objects);
});

test("manage_promocode_objects remove hits /v1/promocodes/{id}/objects/remove", async () => {
  const { calls, mcp } = await setup({ ok: true });
  const objects = { collection_ids: ["019b21d9-c5d9-777d-80bd-d67c664bc6d9"] };
  const res = await mcp.callTool({
    name: "manage_promocode_objects",
    arguments: { id: "pc1", action: "remove", objects },
  });
  assert.equal((res as { isError?: boolean }).isError, undefined);
  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0]!.url).pathname, "/v1/promocodes/pc1/objects/remove");
});
