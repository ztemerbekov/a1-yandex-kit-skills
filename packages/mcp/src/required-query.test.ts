import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { getRegistry, KitClient, type RegistryOp } from "yandex-kit-core";

import type { Runtime } from "./runtime.js";
import { createMcpServer } from "./server.js";

/** The registry operation a recorded request went to; a literal path wins over a templated one. */
function matchOp(method: string, pathname: string): RegistryOp | undefined {
  return Object.values(getRegistry().ops)
    .filter((op) => {
      if (op.method.toUpperCase() !== method) return false;
      const pattern = op.path.replace(/[.*+?^$()|[\]\\]/g, "\\$&").replace(/\{[^}]+\}/g, "[^/]+");
      return new RegExp(`^${pattern}$`).test(pathname);
    })
    .sort((a, b) => a.pathParams.length - b.pathParams.length)[0];
}

async function connect(calls: Array<{ method: string; url: URL }>): Promise<Client> {
  const client = new KitClient({
    token: "t",
    rps: 1000,
    fetchImpl: (async (url: unknown, init?: RequestInit) => {
      calls.push({ method: (init?.method ?? "GET").toUpperCase(), url: new URL(String(url)) });
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch,
  });
  const server = createMcpServer({ client } as Runtime, "0.0.0");
  const mcp = new Client({ name: "test-client", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await mcp.connect(clientTransport);
  return mcp;
}

// An empty status array serializes to no status parameter at all, so it must never reach the
// API: the filter is required there and the answer would be the same 400.
test("list tools with a status filter reject an empty array before the network", async () => {
  const calls: Array<{ method: string; url: URL }> = [];
  const mcp = await connect(calls);
  const { tools } = await mcp.listTools();
  const withStatus = tools
    .filter((tool) => {
      const status = (tool.inputSchema.properties as Record<string, { type?: string }> | undefined)
        ?.status;
      // GetVariants takes status as an optional filter, so an empty array is harmless there.
      return tool.name.startsWith("list_") && tool.name !== "list_variants" && status?.type === "array";
    })
    .map((tool) => tool.name)
    .sort();
  assert.deepEqual(withStatus, [
    "list_alerts",
    "list_blogs",
    "list_categories",
    "list_characteristics",
    "list_collections",
    "list_discounts",
    "list_videos",
    "list_warehouses",
  ]);
  for (const name of withStatus) {
    const res = await mcp.callTool({ name, arguments: { status: [] } });
    assert.equal((res as { isError?: boolean }).isError, true, `${name} accepted status: []`);
  }
  assert.equal(calls.length, 0);
});

// A tool callable with no arguments must still send every query parameter the spec marks
// required, or the API answers 400 «Обязательный параметр '…' отсутствует». That is how
// list_characteristics (fixed in 1.13.1) and list_blogs (fixed in 1.14.1) broke: the spec made
// `status` required and the tool kept sending none.
test("tools callable without arguments send every required query parameter", async () => {
  const calls: Array<{ method: string; url: URL }> = [];
  const mcp = await connect(calls);

  const { tools } = await mcp.listTools();
  const checked: string[] = [];
  const missing: string[] = [];
  for (const tool of tools) {
    if ((tool.inputSchema.required ?? []).length > 0) continue;
    calls.length = 0;
    // The stub's empty body may fail the tool afterwards; only the request it sent matters.
    await mcp.callTool({ name: tool.name, arguments: {} });
    for (const call of calls) {
      const op = matchOp(call.method, call.url.pathname);
      assert.ok(op, `${tool.name}: no registry operation for ${call.method} ${call.url.pathname}`);
      checked.push(tool.name);
      for (const param of op.queryParams) {
        if (param.required && !call.url.searchParams.has(param.name)) {
          missing.push(`${tool.name} -> ${op.id}: ${param.name}`);
        }
      }
    }
  }

  assert.deepEqual(missing, []);
  // Guards the guard: these two are the tools the rule was written for.
  assert.ok(checked.includes("list_blogs"));
  assert.ok(checked.includes("list_characteristics"));
});
