import { test } from "node:test";
import assert from "node:assert/strict";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { KitClient } from "yandex-kit-core";

import { registerSimilarCardsTools } from "./similar-cards.js";

interface RecordedCall {
  url: string;
  init: RequestInit | undefined;
}

/** `routes` maps a URL pathname to the JSON payload it answers; unknown paths get 204. */
async function setup(routes: Record<string, unknown> = {}) {
  const calls: RecordedCall[] = [];
  const client = new KitClient({
    token: "t",
    rps: 1000,
    fetchImpl: (async (url: unknown, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      const payload = routes[new URL(String(url)).pathname];
      if (payload === undefined) return new Response(null, { status: 204 });
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch,
  });
  const server = new McpServer({ name: "test-server", version: "0.0.0" });
  registerSimilarCardsTools(server, client);
  const mcp = new Client({ name: "test-client", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await mcp.connect(clientTransport);
  return { calls, mcp };
}

function resultText(res: unknown): string {
  return (res as { content: { text: string }[] }).content[0]!.text;
}

test("tools/list contains the similar-cards tools with their annotations", async () => {
  const { mcp } = await setup();
  const { tools } = await mcp.listTools();
  assert.deepEqual(
    tools.map((t) => t.name).sort(),
    [
      "delete_similar_cards",
      "get_similar_cards",
      "manage_similar_cards_objects",
      "set_similar_cards_mode",
    ],
  );
  const byName = new Map(tools.map((t) => [t.name, t]));
  assert.equal(byName.get("get_similar_cards")?.annotations?.readOnlyHint, true);
  assert.equal(byName.get("delete_similar_cards")?.annotations?.destructiveHint, true);
});

test("get_similar_cards reads the card IDs in SELECTED_CARDS mode", async () => {
  const { calls, mcp } = await setup({
    "/v1/similar-cards/card-1": { product_card_id: "card-1", binding_mode: "SELECTED_CARDS" },
    "/v1/similar-cards/card-1/cards": { product_card_ids: ["card-2", "card-3"], total_count: 2 },
  });
  const res = await mcp.callTool({
    name: "get_similar_cards",
    arguments: { product_card_id: "card-1" },
  });
  assert.equal((res as { isError?: boolean }).isError, undefined);
  assert.deepEqual(
    calls.map((c) => new URL(c.url).pathname),
    ["/v1/similar-cards/card-1", "/v1/similar-cards/card-1/cards"],
  );
  const data = JSON.parse(resultText(res));
  assert.equal(data.binding_mode, "SELECTED_CARDS");
  assert.deepEqual(data.cards.items, ["card-2", "card-3"]);
  assert.equal(data.cards.coverage, "complete");
  assert.equal(data.categories, undefined);
});

test("get_similar_cards reads categories and collections in SELECTED_CATEGORIES_COLLECTIONS mode", async () => {
  const { calls, mcp } = await setup({
    "/v1/similar-cards/card-1": {
      product_card_id: "card-1",
      binding_mode: "SELECTED_CATEGORIES_COLLECTIONS",
    },
    "/v1/similar-cards/card-1/categories": { category_ids: ["cat-1"], total_count: 1 },
    "/v1/similar-cards/card-1/collections": { collection_ids: ["col-1"], total_count: 1 },
  });
  const res = await mcp.callTool({
    name: "get_similar_cards",
    arguments: { product_card_id: "card-1" },
  });
  const data = JSON.parse(resultText(res));
  assert.deepEqual(data.categories.items, ["cat-1"]);
  assert.deepEqual(data.collections.items, ["col-1"]);
  assert.equal(data.cards, undefined);
  assert.equal(calls.length, 3);
});

test("get_similar_cards makes no list calls in ALL_VARIANTS mode", async () => {
  const { calls, mcp } = await setup({
    "/v1/similar-cards/card-1": { product_card_id: "card-1", binding_mode: "ALL_VARIANTS" },
  });
  await mcp.callTool({ name: "get_similar_cards", arguments: { product_card_id: "card-1" } });
  assert.equal(calls.length, 1);
});

test("set_similar_cards_mode create/update map to POST/PUT with the binding_mode body", async () => {
  const settings = { product_card_id: "card-1", binding_mode: "ALL_VARIANTS" };
  for (const [action, method] of [
    ["create", "POST"],
    ["update", "PUT"],
  ] as const) {
    const { calls, mcp } = await setup({ "/v1/similar-cards/card-1": settings });
    const res = await mcp.callTool({
      name: "set_similar_cards_mode",
      arguments: { product_card_id: "card-1", action, binding_mode: "ALL_VARIANTS" },
    });
    assert.equal((res as { isError?: boolean }).isError, undefined);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.init?.method, method);
    assert.equal(new URL(calls[0]!.url).pathname, "/v1/similar-cards/card-1");
    assert.deepEqual(JSON.parse(calls[0]!.init?.body as string), { binding_mode: "ALL_VARIANTS" });
  }
});

test("set_similar_cards_mode rejects an unknown binding_mode without any network call", async () => {
  const { calls, mcp } = await setup();
  const res = await mcp.callTool({
    name: "set_similar_cards_mode",
    arguments: { product_card_id: "card-1", action: "create", binding_mode: "EVERYTHING" },
  });
  assert.equal((res as { isError?: boolean }).isError, true);
  assert.equal(calls.length, 0);
});

test("manage_similar_cards_objects add/remove hit objects/add and objects/remove", async () => {
  for (const action of ["add", "remove"] as const) {
    const { calls, mcp } = await setup();
    const objects = { product_card_ids: ["card-2"] };
    const res = await mcp.callTool({
      name: "manage_similar_cards_objects",
      arguments: { product_card_id: "card-1", action, objects },
    });
    assert.equal((res as { isError?: boolean }).isError, undefined);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.init?.method, "POST");
    assert.equal(new URL(calls[0]!.url).pathname, `/v1/similar-cards/card-1/objects/${action}`);
    assert.deepEqual(JSON.parse(calls[0]!.init?.body as string), objects);
  }
});

test("manage_similar_cards_objects rejects empty, mixed and oversized bodies without any network call", async () => {
  const { calls, mcp } = await setup();
  for (const objects of [
    {},
    { product_card_ids: [] },
    { product_card_ids: ["card-2"], category_ids: ["cat-1"] },
    { product_card_ids: Array.from({ length: 501 }, (_, i) => `card-${i}`) },
    {
      category_ids: Array.from({ length: 300 }, (_, i) => `cat-${i}`),
      collection_ids: Array.from({ length: 201 }, (_, i) => `col-${i}`),
    },
  ]) {
    const res = await mcp.callTool({
      name: "manage_similar_cards_objects",
      arguments: { product_card_id: "card-1", action: "add", objects },
    });
    assert.equal((res as { isError?: boolean }).isError, true);
    assert.equal(JSON.parse(resultText(res)).code, "LOCAL_VALIDATION_ERROR");
  }
  assert.equal(calls.length, 0);
});

test("delete_similar_cards hits DELETE /v1/similar-cards/{product_card_id}", async () => {
  const { calls, mcp } = await setup();
  const res = await mcp.callTool({
    name: "delete_similar_cards",
    arguments: { product_card_id: "card-1" },
  });
  assert.equal((res as { isError?: boolean }).isError, undefined);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.init?.method, "DELETE");
  assert.equal(new URL(calls[0]!.url).pathname, "/v1/similar-cards/card-1");
});
