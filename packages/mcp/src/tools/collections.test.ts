import { test } from "node:test";
import assert from "node:assert/strict";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { KitClient } from "yandex-kit-core";

import { registerCollectionTools } from "./collections.js";

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
  registerCollectionTools(server, client);
  const mcp = new Client({ name: "test-client", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await mcp.connect(clientTransport);
  return { calls, mcp };
}

function resultText(res: unknown): string {
  return (res as { content: { text: string }[] }).content[0]!.text;
}

test("registers exactly the collection tools", async () => {
  const { mcp } = await setup();
  const { tools } = await mcp.listTools();
  const names = tools.map((t) => t.name).sort();
  assert.deepEqual(names, [
    "create_collection",
    "delete_collection",
    "get_collection",
    "list_collections",
    "manage_collection_cards",
    "update_collection",
  ]);
});

test("list_collections passes page, clamps per_page to 100, defaults status to both", async () => {
  const { calls, mcp } = await setup({ collections: [], total_count: 0 });
  const res = await mcp.callTool({
    name: "list_collections",
    arguments: { page: 2, per_page: 999, type: ["STATIC"] },
  });
  assert.equal((res as { isError?: boolean }).isError, undefined);
  assert.equal(calls.length, 1);
  const url = new URL(calls[0]!.url);
  assert.equal(url.pathname, "/v1/collections");
  assert.equal(url.searchParams.get("page"), "2");
  assert.equal(url.searchParams.get("per_page"), "100");
  assert.deepEqual(url.searchParams.getAll("status"), ["ACTIVE", "INACTIVE"]);
  assert.deepEqual(url.searchParams.getAll("type"), ["STATIC"]);
});

test("list_collections all=true fetches via listAll with per_page=100", async () => {
  const { calls, mcp } = await setup({ collections: [{ id: "c1" }], total_count: 1 });
  const res = await mcp.callTool({ name: "list_collections", arguments: { all: true } });
  assert.equal(calls.length, 1);
  const url = new URL(calls[0]!.url);
  assert.equal(url.searchParams.get("page"), "1");
  assert.equal(url.searchParams.get("per_page"), "100");
  const data = JSON.parse(resultText(res));
  assert.deepEqual(data, {
    items: [{ id: "c1" }],
    coverage: "complete",
    received: 1,
    total_count: 1,
    pages_read: 1,
  });
});

test("get_collection maps id to the collection_id path parameter", async () => {
  const { calls, mcp } = await setup({ id: "c1" });
  await mcp.callTool({ name: "get_collection", arguments: { id: "col-42" } });
  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0]!.url).pathname, "/v1/collections/col-42");
  assert.equal(calls[0]!.init?.method, "GET");
});

test("create_collection with invalid body fails without any network call", async () => {
  const { calls, mcp } = await setup();
  // CreateCollectionRequest requires title, status and collection_type.
  const res = await mcp.callTool({
    name: "create_collection",
    arguments: { collection: { title: "Summer" } },
  });
  assert.equal((res as { isError?: boolean }).isError, true);
  assert.equal(JSON.parse(resultText(res)).code, "LOCAL_VALIDATION_ERROR");
  assert.equal(calls.length, 0);
});

test("create_collection with a minimal valid body performs the request", async () => {
  const { calls, mcp } = await setup({ id: "c1" });
  const collection = { title: "Summer", status: "ACTIVE", collection_type: "STATIC" };
  const res = await mcp.callTool({ name: "create_collection", arguments: { collection } });
  assert.equal((res as { isError?: boolean }).isError, undefined);
  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0]!.url).pathname, "/v1/collections");
  assert.equal(calls[0]!.init?.method, "POST");
  const headers = calls[0]!.init?.headers as Record<string, string>;
  assert.equal(headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(calls[0]!.init?.body as string), collection);
});

test("update_collection with an empty body fails without any network call", async () => {
  const { calls, mcp } = await setup();
  const res = await mcp.callTool({
    name: "update_collection",
    arguments: { id: "c1", collection: {} },
  });
  assert.equal((res as { isError?: boolean }).isError, true);
  assert.equal(JSON.parse(resultText(res)).code, "EMPTY_UPDATE_BODY");
  assert.equal(calls.length, 0);
});

test("update_collection with a spec-invalid body fails without any network call", async () => {
  const { calls, mcp } = await setup();
  // title must be a string.
  const res = await mcp.callTool({
    name: "update_collection",
    arguments: { id: "c1", collection: { title: 123 } },
  });
  assert.equal((res as { isError?: boolean }).isError, true);
  assert.equal(JSON.parse(resultText(res)).code, "LOCAL_VALIDATION_ERROR");
  assert.equal(calls.length, 0);
});

test("update_collection sends a plain application/json PATCH to /v1/collections/{collection_id}", async () => {
  const { calls, mcp } = await setup({ id: "c1" });
  const res = await mcp.callTool({
    name: "update_collection",
    arguments: { id: "c1", collection: { title: "Renamed" } },
  });
  assert.equal((res as { isError?: boolean }).isError, undefined);
  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0]!.url).pathname, "/v1/collections/c1");
  assert.equal(calls[0]!.init?.method, "PATCH");
  const headers = calls[0]!.init?.headers as Record<string, string>;
  assert.equal(headers["Content-Type"], "application/json");
});

test("delete_collection sends DELETE and is marked destructive", async () => {
  const { calls, mcp } = await setup();
  const { tools } = await mcp.listTools();
  const tool = tools.find((t) => t.name === "delete_collection");
  assert.equal(tool?.annotations?.destructiveHint, true);
  const res = await mcp.callTool({ name: "delete_collection", arguments: { id: "c1" } });
  assert.equal((res as { isError?: boolean }).isError, undefined);
  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0]!.url).pathname, "/v1/collections/c1");
  assert.equal(calls[0]!.init?.method, "DELETE");
});

test("manage_collection_cards with invalid body fails without any network call", async () => {
  const { calls, mcp } = await setup();
  // AddCardsToStaticCollectionRequest requires product_card_ids.
  const res = await mcp.callTool({
    name: "manage_collection_cards",
    arguments: { id: "c1", action: "add", cards: {} },
  });
  assert.equal((res as { isError?: boolean }).isError, true);
  assert.equal(JSON.parse(resultText(res)).code, "LOCAL_VALIDATION_ERROR");
  assert.equal(calls.length, 0);
});

test("manage_collection_cards add hits /v1/collections/{collection_id}/cards/add", async () => {
  const { calls, mcp } = await setup();
  const cards = { product_card_ids: ["019b21d9-c5d9-777d-80bd-d67c664bc6d9"] };
  const res = await mcp.callTool({
    name: "manage_collection_cards",
    arguments: { id: "c1", action: "add", cards },
  });
  assert.equal((res as { isError?: boolean }).isError, undefined);
  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0]!.url).pathname, "/v1/collections/c1/cards/add");
  assert.equal(calls[0]!.init?.method, "POST");
  assert.deepEqual(JSON.parse(calls[0]!.init?.body as string), cards);
});

test("manage_collection_cards remove hits /v1/collections/{collection_id}/cards/remove", async () => {
  const { calls, mcp } = await setup();
  const cards = { product_card_ids: ["019b21d9-c5d9-777d-80bd-d67c664bc6d9"] };
  await mcp.callTool({
    name: "manage_collection_cards",
    arguments: { id: "c1", action: "remove", cards },
  });
  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0]!.url).pathname, "/v1/collections/c1/cards/remove");
});
