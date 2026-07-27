import { test } from "node:test";
import assert from "node:assert/strict";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { KitClient } from "yandex-kit-core";

import { registerGiftCardTools } from "./giftcards.js";

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
  registerGiftCardTools(server, client);
  const mcp = new Client({ name: "test-client", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await mcp.connect(clientTransport);
  return { calls, mcp };
}

test("registers exactly list_gift_cards and get_gift_card, both read-only", async () => {
  const { mcp } = await setup();
  const { tools } = await mcp.listTools();
  const names = tools.map((t) => t.name).sort();
  assert.deepEqual(names, ["get_gift_card", "list_gift_cards"]);
  for (const tool of tools) {
    assert.equal(tool.annotations?.readOnlyHint, true, `${tool.name} must be read-only`);
  }
});

test("list_gift_cards passes page/filters through and clamps per_page to 100", async () => {
  const { calls, mcp } = await setup({ gift_cards: [], total_count: 0 });
  const res = await mcp.callTool({
    name: "list_gift_cards",
    arguments: { page: 2, per_page: 999, status: "ACTIVATED", purchased_date_from: "2026-01-01" },
  });
  assert.equal((res as { isError?: boolean }).isError, undefined);
  assert.equal(calls.length, 1);
  const url = new URL(calls[0]!.url);
  assert.equal(url.pathname, "/v1/gift_cards");
  assert.equal(url.searchParams.get("page"), "2");
  assert.equal(url.searchParams.get("per_page"), "100");
  assert.equal(url.searchParams.get("status"), "ACTIVATED");
  assert.equal(url.searchParams.get("purchased_date_from"), "2026-01-01");
});

test("list_gift_cards all=true fetches via listAll with per_page=100", async () => {
  const { calls, mcp } = await setup({ gift_cards: [{ id: "g1" }], total_count: 1 });
  const res = await mcp.callTool({ name: "list_gift_cards", arguments: { all: true } });
  assert.equal(calls.length, 1);
  const url = new URL(calls[0]!.url);
  assert.equal(url.searchParams.get("page"), "1");
  assert.equal(url.searchParams.get("per_page"), "100");
  const data = JSON.parse((res as { content: { text: string }[] }).content[0]!.text);
  assert.deepEqual(data, { items: [{ id: "g1" }], pages: 1, truncated: false });
});

test("get_gift_card maps id to the gift_card_id path param", async () => {
  const { calls, mcp } = await setup({ id: "g1" });
  await mcp.callTool({ name: "get_gift_card", arguments: { id: "gc-7" } });
  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0]!.url).pathname, "/v1/gift_cards/gc-7");
  assert.equal(calls[0]!.init?.method, "GET");
});
