import { test } from "node:test";
import assert from "node:assert/strict";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { KitClient } from "yandex-kit-core";

import { registerAlertTools } from "./alerts.js";

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
  registerAlertTools(server, client);
  const mcp = new Client({ name: "test-client", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await mcp.connect(clientTransport);
  return { calls, mcp };
}

test("registers exactly list_alerts and resolve_alert with correct annotations", async () => {
  const { mcp } = await setup();
  const { tools } = await mcp.listTools();
  assert.deepEqual(
    tools.map((t) => t.name).sort(),
    ["list_alerts", "resolve_alert"],
  );
  assert.equal(tools.find((t) => t.name === "list_alerts")?.annotations?.readOnlyHint, true);
  assert.equal(tools.find((t) => t.name === "resolve_alert")?.annotations?.readOnlyHint, undefined);
});

test("list_alerts defaults the required status filter to ACTIVE", async () => {
  const { calls, mcp } = await setup({ alerts: [], total_count: 0 });
  await mcp.callTool({ name: "list_alerts", arguments: {} });
  assert.equal(calls.length, 1);
  const url = new URL(calls[0]!.url);
  assert.equal(url.pathname, "/v1/alerts");
  assert.deepEqual(url.searchParams.getAll("status"), ["ACTIVE"]);
});

test("list_alerts passes an explicit status filter and clamps per_page", async () => {
  const { calls, mcp } = await setup({ alerts: [], total_count: 0 });
  await mcp.callTool({
    name: "list_alerts",
    arguments: { status: ["ACTIVE", "RESOLVED"], per_page: 999 },
  });
  const url = new URL(calls[0]!.url);
  assert.deepEqual(url.searchParams.getAll("status"), ["ACTIVE", "RESOLVED"]);
  assert.equal(url.searchParams.get("per_page"), "100");
});

test("list_alerts all=true fetches via listAll", async () => {
  const { calls, mcp } = await setup({ alerts: [{ id: "a1" }], total_count: 1 });
  const res = await mcp.callTool({ name: "list_alerts", arguments: { all: true } });
  assert.equal(calls.length, 1);
  const url = new URL(calls[0]!.url);
  assert.equal(url.searchParams.get("per_page"), "100");
  assert.deepEqual(url.searchParams.getAll("status"), ["ACTIVE"]);
  const data = JSON.parse((res as { content: { text: string }[] }).content[0]!.text);
  assert.deepEqual(data, { items: [{ id: "a1" }], pages: 1, truncated: false });
});

test("resolve_alert POSTs to /v1/alerts/{alert_id}/resolve without a body", async () => {
  const { calls, mcp } = await setup({});
  const res = await mcp.callTool({ name: "resolve_alert", arguments: { alert_id: "al-1" } });
  assert.equal((res as { isError?: boolean }).isError, undefined);
  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0]!.url).pathname, "/v1/alerts/al-1/resolve");
  assert.equal(calls[0]!.init?.method, "POST");
  assert.equal(calls[0]!.init?.body, undefined);
});

test("resolve_alert documents that active CRITICAL alerts cannot be closed by hand", async () => {
  const { mcp } = await setup({});
  const { tools } = await mcp.listTools();
  const resolve = tools.find((tool) => tool.name === "resolve_alert");
  assert.match(resolve?.description ?? "", /CRITICAL/);
});
