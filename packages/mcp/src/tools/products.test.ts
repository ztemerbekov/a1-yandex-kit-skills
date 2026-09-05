import { test } from "node:test";
import assert from "node:assert/strict";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { KitClient } from "yandex-kit-core";

import { registerProductTools } from "./products.js";

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
  registerProductTools(server, client);
  const mcp = new Client({ name: "test-client", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await mcp.connect(clientTransport);
  return { calls, mcp };
}

function resultText(res: unknown): string {
  return (res as { content: { text: string }[] }).content[0]!.text;
}

test("list_products passes page through and clamps per_page to 100", async () => {
  const { calls, mcp } = await setup({ products: [], total_count: 0 });
  const res = await mcp.callTool({ name: "list_products", arguments: { page: 2, per_page: 999 } });
  assert.equal((res as { isError?: boolean }).isError, undefined);
  assert.equal(calls.length, 1);
  const url = new URL(calls[0]!.url);
  assert.equal(url.pathname, "/v1/products");
  assert.equal(url.searchParams.get("page"), "2");
  assert.equal(url.searchParams.get("per_page"), "100");
});

test("list_products all=true fetches via listAll with per_page=100", async () => {
  const { calls, mcp } = await setup({ products: [{ id: "p1" }], total_count: 1 });
  const res = await mcp.callTool({ name: "list_products", arguments: { all: true } });
  assert.equal(calls.length, 1);
  const url = new URL(calls[0]!.url);
  assert.equal(url.searchParams.get("page"), "1");
  assert.equal(url.searchParams.get("per_page"), "100");
  const data = JSON.parse(resultText(res));
  assert.deepEqual(data, {
    items: [{ id: "p1" }],
    coverage: "complete",
    received: 1,
    total_count: 1,
    pages_read: 1,
    pages: 1,
    truncated: false,
  });
});

test("get_product hits /v1/products/{id}", async () => {
  const { calls, mcp } = await setup({ id: "p1" });
  await mcp.callTool({ name: "get_product", arguments: { id: "abc-123" } });
  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0]!.url).pathname, "/v1/products/abc-123");
  assert.equal(calls[0]!.init?.method, "GET");
});

test("create_product with invalid body fails without any network call", async () => {
  const { calls, mcp } = await setup();
  // CreateProductRequest requires category_ids.
  const res = await mcp.callTool({ name: "create_product", arguments: { product: {} } });
  assert.equal((res as { isError?: boolean }).isError, true);
  assert.equal(JSON.parse(resultText(res)).code, "LOCAL_VALIDATION_ERROR");
  assert.equal(calls.length, 0);
});

test("create_product with a minimal valid body performs the request", async () => {
  const { calls, mcp } = await setup({ id: "p1" });
  const product = { category_ids: ["019b21d9-c5d9-777d-80bd-d67c664bc6d9"] };
  const res = await mcp.callTool({ name: "create_product", arguments: { product } });
  assert.equal((res as { isError?: boolean }).isError, undefined);
  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0]!.url).pathname, "/v1/products");
  assert.equal(calls[0]!.init?.method, "POST");
  const headers = calls[0]!.init?.headers as Record<string, string>;
  assert.equal(headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(calls[0]!.init?.body as string), product);
});

test("update_product with an empty body fails without any network call", async () => {
  const { calls, mcp } = await setup();
  const res = await mcp.callTool({ name: "update_product", arguments: { id: "p1", product: {} } });
  assert.equal((res as { isError?: boolean }).isError, true);
  assert.equal(JSON.parse(resultText(res)).code, "EMPTY_UPDATE_BODY");
  assert.equal(calls.length, 0);
});

test("update_product sends a plain application/json PATCH", async () => {
  const { calls, mcp } = await setup({ id: "p1" });
  const product = { category_ids: ["019b21d9-c5d9-777d-80bd-d67c664bc6d9"] };
  const res = await mcp.callTool({ name: "update_product", arguments: { id: "p1", product } });
  assert.equal((res as { isError?: boolean }).isError, undefined);
  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0]!.url).pathname, "/v1/products/p1");
  assert.equal(calls[0]!.init?.method, "PATCH");
  const headers = calls[0]!.init?.headers as Record<string, string>;
  assert.equal(headers["Content-Type"], "application/json");
});
