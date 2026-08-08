import { test } from "node:test";
import assert from "node:assert/strict";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { KitClient } from "yandex-kit-core";

import { registerCharacteristicTools } from "./characteristics.js";

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
  registerCharacteristicTools(server, client);
  const mcp = new Client({ name: "test-client", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await mcp.connect(clientTransport);
  return { calls, mcp };
}

function resultText(res: unknown): string {
  return (res as { content: { text: string }[] }).content[0]!.text;
}

test("registers exactly the two color tools with correct annotations", async () => {
  const { mcp } = await setup();
  const { tools } = await mcp.listTools();
  assert.deepEqual(
    tools.map((t) => t.name).sort(),
    ["list_characteristic_colors", "update_characteristic_color"],
  );
  assert.equal(
    tools.find((t) => t.name === "list_characteristic_colors")?.annotations?.readOnlyHint,
    true,
  );
  assert.equal(
    tools.find((t) => t.name === "update_characteristic_color")?.annotations?.readOnlyHint,
    undefined,
  );
});

test("list_characteristic_colors passes search_text and clamps per_page", async () => {
  const { calls, mcp } = await setup({ colors: [], total_count: 0 });
  await mcp.callTool({
    name: "list_characteristic_colors",
    arguments: { search_text: "крас", per_page: 999 },
  });
  assert.equal(calls.length, 1);
  const url = new URL(calls[0]!.url);
  assert.equal(url.pathname, "/v1/characteristics/colors");
  assert.equal(url.searchParams.get("search_text"), "крас");
  assert.equal(url.searchParams.get("per_page"), "100");
});

test("list_characteristic_colors all=true fetches via listAll", async () => {
  const { calls, mcp } = await setup({
    colors: [{ value: "Красный", color_hex: "#FF0000" }],
    total_count: 1,
  });
  const res = await mcp.callTool({ name: "list_characteristic_colors", arguments: { all: true } });
  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0]!.url).searchParams.get("per_page"), "100");
  const data = JSON.parse(resultText(res));
  assert.deepEqual(data.items, [{ value: "Красный", color_hex: "#FF0000" }]);
});

test("update_characteristic_color PATCHes /v1/characteristics/colors with both fields", async () => {
  const { calls, mcp } = await setup({ value: "Красный", color_hex: "#FF0000" });
  const res = await mcp.callTool({
    name: "update_characteristic_color",
    arguments: { value: "Красный", color_hex: "#FF0000" },
  });
  assert.equal((res as { isError?: boolean }).isError, undefined);
  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0]!.url).pathname, "/v1/characteristics/colors");
  assert.equal(calls[0]!.init?.method, "PATCH");
  assert.deepEqual(JSON.parse(String(calls[0]!.init?.body)), {
    value: "Красный",
    color_hex: "#FF0000",
  });
  // Plain JSON, not merge-patch: the spec declares application/json for this PATCH.
  const headers = new Headers(calls[0]!.init?.headers);
  assert.equal(headers.get("content-type"), "application/json");
});

test("update_characteristic_color accepts the special multicoloured value", async () => {
  const { calls, mcp } = await setup({ value: "Радужный", color_hex: "multicoloured" });
  const res = await mcp.callTool({
    name: "update_characteristic_color",
    arguments: { value: "Радужный", color_hex: "multicoloured" },
  });
  assert.equal((res as { isError?: boolean }).isError, undefined);
  assert.equal(JSON.parse(String(calls[0]!.init?.body)).color_hex, "multicoloured");
});
