import { test } from "node:test";
import assert from "node:assert/strict";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { KitClient } from "yandex-kit-core";

import { registerWebhookTools } from "./webhooks.js";

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
  registerWebhookTools(server, client);
  const mcp = new Client({ name: "test-client", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await mcp.connect(clientTransport);
  return { calls, mcp };
}

function resultText(res: unknown): string {
  return (res as { content: { text: string }[] }).content[0]!.text;
}

test("tools/list contains exactly the webhook tools", async () => {
  const { mcp } = await setup();
  const { tools } = await mcp.listTools();
  assert.deepEqual(
    tools.map((t) => t.name).sort(),
    [
      "create_webhook",
      "delete_webhook",
      "get_webhook",
      "list_webhooks",
      "update_webhook",
      "validate_webhook",
    ],
  );
  for (const name of ["list_webhooks", "get_webhook"]) {
    const tool = tools.find((t) => t.name === name);
    assert.equal(tool?.annotations?.readOnlyHint, true, `${name} must be read-only`);
  }
});

test("list_webhooks hits GET /v1/webhooks", async () => {
  const { calls, mcp } = await setup({ webhooks: [] });
  const res = await mcp.callTool({ name: "list_webhooks", arguments: {} });
  assert.equal((res as { isError?: boolean }).isError, undefined);
  assert.equal(calls.length, 1);
  const url = new URL(calls[0]!.url);
  assert.equal(url.pathname, "/v1/webhooks");
  assert.equal(url.search, "");
  assert.equal(calls[0]!.init?.method, "GET");
});

test("get_webhook maps id to the webhook_id path param", async () => {
  const { calls, mcp } = await setup({ id: "wh-1" });
  await mcp.callTool({ name: "get_webhook", arguments: { id: "wh-42" } });
  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0]!.url).pathname, "/v1/webhooks/wh-42");
  assert.equal(calls[0]!.init?.method, "GET");
});

test("create_webhook with invalid body fails without any network call", async () => {
  const { calls, mcp } = await setup();
  // CreateWebhookRequest requires both url and events.
  const res = await mcp.callTool({
    name: "create_webhook",
    arguments: { webhook: { url: "https://example.com/hook" } },
  });
  assert.equal((res as { isError?: boolean }).isError, true);
  assert.equal(JSON.parse(resultText(res)).code, "LOCAL_VALIDATION_ERROR");
  assert.equal(calls.length, 0);
});

test("create_webhook with a minimal valid body performs the request", async () => {
  const { calls, mcp } = await setup({ id: "wh-1", secret: "s" });
  const webhook = { url: "https://example.com/hook", events: ["ORDER_STATUS_CHANGED"] };
  const res = await mcp.callTool({ name: "create_webhook", arguments: { webhook } });
  assert.equal((res as { isError?: boolean }).isError, undefined);
  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0]!.url).pathname, "/v1/webhooks");
  assert.equal(calls[0]!.init?.method, "POST");
  const headers = calls[0]!.init?.headers as Record<string, string>;
  assert.equal(headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(calls[0]!.init?.body as string), webhook);
});

test("update_webhook with an empty body fails without any network call", async () => {
  const { calls, mcp } = await setup();
  const res = await mcp.callTool({ name: "update_webhook", arguments: { id: "wh-1", webhook: {} } });
  assert.equal((res as { isError?: boolean }).isError, true);
  assert.equal(JSON.parse(resultText(res)).code, "EMPTY_UPDATE_BODY");
  assert.equal(calls.length, 0);
});

test("update_webhook with a spec-invalid body fails without any network call", async () => {
  const { calls, mcp } = await setup();
  // events must be an array of enum strings.
  const res = await mcp.callTool({
    name: "update_webhook",
    arguments: { id: "wh-1", webhook: { events: "ORDER_STATUS_CHANGED" } },
  });
  assert.equal((res as { isError?: boolean }).isError, true);
  assert.equal(calls.length, 0);
});

test("update_webhook sends a plain application/json PATCH to /v1/webhooks/{webhook_id}", async () => {
  const { calls, mcp } = await setup({ id: "wh-1" });
  const res = await mcp.callTool({
    name: "update_webhook",
    arguments: { id: "wh-1", webhook: { deactivate: true } },
  });
  assert.equal((res as { isError?: boolean }).isError, undefined);
  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0]!.url).pathname, "/v1/webhooks/wh-1");
  assert.equal(calls[0]!.init?.method, "PATCH");
  const headers = calls[0]!.init?.headers as Record<string, string>;
  assert.equal(headers["Content-Type"], "application/json");
});

test("delete_webhook sends DELETE to /v1/webhooks/{webhook_id} and is marked destructive", async () => {
  const { calls, mcp } = await setup();
  const { tools } = await mcp.listTools();
  const tool = tools.find((t) => t.name === "delete_webhook");
  assert.equal(tool?.annotations?.destructiveHint, true);
  const res = await mcp.callTool({ name: "delete_webhook", arguments: { id: "wh-1" } });
  assert.equal((res as { isError?: boolean }).isError, undefined);
  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0]!.url).pathname, "/v1/webhooks/wh-1");
  assert.equal(calls[0]!.init?.method, "DELETE");
});

test("validate_webhook posts to /v1/webhooks/{webhook_id}/validate with activate", async () => {
  const { calls, mcp } = await setup();
  const res = await mcp.callTool({
    name: "validate_webhook",
    arguments: { id: "wh-1", activate: true },
  });
  assert.equal((res as { isError?: boolean }).isError, undefined);
  assert.equal(calls.length, 1);
  const url = new URL(calls[0]!.url);
  assert.equal(url.pathname, "/v1/webhooks/wh-1/validate");
  assert.equal(url.searchParams.get("activate"), "true");
  assert.equal(calls[0]!.init?.method, "POST");
});
