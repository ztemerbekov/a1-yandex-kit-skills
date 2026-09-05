import { test } from "node:test";
import assert from "node:assert/strict";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { KitClient } from "yandex-kit-core";

import { registerWarehouseTools } from "./warehouses.js";

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
  registerWarehouseTools(server, client);
  const mcp = new Client({ name: "test-client", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await mcp.connect(clientTransport);
  return { calls, mcp };
}

function resultText(res: unknown): string {
  return (res as { content: { text: string }[] }).content[0]!.text;
}

test("tools/list contains exactly the warehouse tools", async () => {
  const { mcp } = await setup();
  const { tools } = await mcp.listTools();
  assert.deepEqual(
    tools.map((t) => t.name).sort(),
    ["create_warehouse", "get_warehouse", "list_warehouses", "update_warehouse", "warehouse_action"],
  );
});

test("list_warehouses clamps per_page to 100 and defaults status to ACTIVE", async () => {
  const { calls, mcp } = await setup({ warehouses: [], total_count: 0 });
  const res = await mcp.callTool({
    name: "list_warehouses",
    arguments: { page: 2, per_page: 999 },
  });
  assert.equal((res as { isError?: boolean }).isError, undefined);
  assert.equal(calls.length, 1);
  const url = new URL(calls[0]!.url);
  assert.equal(url.pathname, "/v1/warehouses");
  assert.equal(url.searchParams.get("page"), "2");
  assert.equal(url.searchParams.get("per_page"), "100");
  assert.deepEqual(url.searchParams.getAll("status"), ["ACTIVE"]);
});

test("list_warehouses all=true fetches via listAll keeping the status filter", async () => {
  const { calls, mcp } = await setup({ warehouses: [{ id: "w1" }], total_count: 1 });
  const res = await mcp.callTool({
    name: "list_warehouses",
    arguments: { all: true, status: ["ARCHIVED"] },
  });
  assert.equal(calls.length, 1);
  const url = new URL(calls[0]!.url);
  assert.equal(url.searchParams.get("page"), "1");
  assert.equal(url.searchParams.get("per_page"), "100");
  assert.deepEqual(url.searchParams.getAll("status"), ["ARCHIVED"]);
  const data = JSON.parse(resultText(res));
  assert.deepEqual(data, {
    items: [{ id: "w1" }],
    coverage: "complete",
    received: 1,
    total_count: 1,
    pages_read: 1,
  });
});

test("get_warehouse hits /v1/warehouses/{id}", async () => {
  const { calls, mcp } = await setup({ id: "w1" });
  await mcp.callTool({ name: "get_warehouse", arguments: { id: "w-42" } });
  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0]!.url).pathname, "/v1/warehouses/w-42");
  assert.equal(calls[0]!.init?.method, "GET");
});

test("create_warehouse with invalid body fails without any network call", async () => {
  const { calls, mcp } = await setup();
  // CreateWarehouseRequest requires title.
  const res = await mcp.callTool({ name: "create_warehouse", arguments: { warehouse: {} } });
  assert.equal((res as { isError?: boolean }).isError, true);
  assert.equal(JSON.parse(resultText(res)).code, "LOCAL_VALIDATION_ERROR");
  assert.equal(calls.length, 0);
});

test("create_warehouse with a minimal valid body performs the request", async () => {
  const { calls, mcp } = await setup({ id: "w1" });
  const warehouse = { title: "Main warehouse" };
  const res = await mcp.callTool({ name: "create_warehouse", arguments: { warehouse } });
  assert.equal((res as { isError?: boolean }).isError, undefined);
  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0]!.url).pathname, "/v1/warehouses");
  assert.equal(calls[0]!.init?.method, "POST");
  const headers = calls[0]!.init?.headers as Record<string, string>;
  assert.equal(headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(calls[0]!.init?.body as string), warehouse);
});

test("update_warehouse with an empty body fails without any network call", async () => {
  const { calls, mcp } = await setup();
  const res = await mcp.callTool({
    name: "update_warehouse",
    arguments: { id: "w1", warehouse: {} },
  });
  assert.equal((res as { isError?: boolean }).isError, true);
  assert.equal(JSON.parse(resultText(res)).code, "EMPTY_UPDATE_BODY");
  assert.equal(calls.length, 0);
});

test("update_warehouse with a spec-invalid body fails without any network call", async () => {
  const { calls, mcp } = await setup();
  // title must be a string.
  const res = await mcp.callTool({
    name: "update_warehouse",
    arguments: { id: "w1", warehouse: { title: 123 } },
  });
  assert.equal((res as { isError?: boolean }).isError, true);
  assert.equal(calls.length, 0);
});

test("update_warehouse passes null field values through to the API (merge-patch removal)", async () => {
  const { calls, mcp } = await setup({ id: "w1" });
  const res = await mcp.callTool({
    name: "update_warehouse",
    arguments: { id: "w1", warehouse: { title: null } },
  });
  assert.equal((res as { isError?: boolean }).isError, undefined);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.init?.method, "PATCH");
  assert.deepEqual(JSON.parse(calls[0]!.init?.body as string), { title: null });
});

test("update_warehouse sends application/merge-patch+json", async () => {
  const { calls, mcp } = await setup({ id: "w1" });
  const res = await mcp.callTool({
    name: "update_warehouse",
    arguments: { id: "w1", warehouse: { title: "Renamed" } },
  });
  assert.equal((res as { isError?: boolean }).isError, undefined);
  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0]!.url).pathname, "/v1/warehouses/w1");
  assert.equal(calls[0]!.init?.method, "PATCH");
  const headers = calls[0]!.init?.headers as Record<string, string>;
  assert.equal(headers["Content-Type"], "application/merge-patch+json");
});

test("warehouse_action archive hits /v1/warehouses/{id}/archive", async () => {
  const { calls, mcp } = await setup();
  const res = await mcp.callTool({
    name: "warehouse_action",
    arguments: { id: "w1", action: "archive" },
  });
  assert.equal((res as { isError?: boolean }).isError, undefined);
  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0]!.url).pathname, "/v1/warehouses/w1/archive");
  assert.equal(calls[0]!.init?.method, "POST");
});

test("warehouse_action unarchive hits /v1/warehouses/{id}/unarchive", async () => {
  const { calls, mcp } = await setup();
  await mcp.callTool({ name: "warehouse_action", arguments: { id: "w1", action: "unarchive" } });
  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0]!.url).pathname, "/v1/warehouses/w1/unarchive");
});
