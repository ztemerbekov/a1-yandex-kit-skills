import { test } from "node:test";
import assert from "node:assert/strict";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { KitClient } from "yandex-kit-core";

import { registerMetaTools } from "./meta.js";

interface RecordedCall {
  url: string;
  init?: RequestInit;
}

async function setup(payload: unknown = { ok: true }) {
  const calls: RecordedCall[] = [];
  const fetchImpl = (async (url: unknown, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  const client = new KitClient({ token: "t", rps: 1000, fetchImpl });
  const server = new McpServer({ name: "test-server", version: "0.0.0" });
  registerMetaTools(server, client);

  const mcpClient = new Client({ name: "test-client", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await mcpClient.connect(clientTransport);
  return { calls, mcpClient };
}

function text(res: unknown): string {
  const r = res as { content: { type: string; text: string }[] };
  return r.content[0]!.text;
}

function parse(res: unknown): any {
  return JSON.parse(text(res));
}

test("search_operations finds category ops by Russian keyword", async () => {
  const { mcpClient } = await setup();
  const res = await mcpClient.callTool({
    name: "search_operations",
    arguments: { query: "категории", limit: 50 },
  });
  const out = parse(res);
  const ids = out.results.map((r: any) => r.operationId);
  for (const id of ["GetCategories", "CreateCategory", "UpdateCategory"]) {
    assert.ok(ids.includes(id), `expected ${id} in results: ${ids.join(",")}`);
  }
  assert.ok(out.total >= 3);
  const first = out.results[0];
  assert.equal(typeof first.method, "string");
  assert.equal(typeof first.path, "string");
  assert.equal(typeof first.summaryRu, "string");
  assert.equal(typeof first.paginated, "boolean");
});

test("search_operations finds webhook ops by operationId match", async () => {
  const { mcpClient } = await setup();
  const res = await mcpClient.callTool({
    name: "search_operations",
    arguments: { query: "webhook" },
  });
  const out = parse(res);
  const ids = out.results.map((r: any) => r.operationId);
  assert.ok(ids.includes("GetWebhooks"), ids.join(","));
  assert.ok(ids.includes("CreateWebhook"), ids.join(","));
});

test("search_operations respects limit", async () => {
  const { mcpClient } = await setup();
  const res = await mcpClient.callTool({
    name: "search_operations",
    arguments: { query: "webhook", limit: 2 },
  });
  const out = parse(res);
  assert.equal(out.results.length, 2);
  assert.ok(out.total > 2, `total=${out.total}`);
});

test("get_operation_schema returns dereferenced CreateWebhook schema", async () => {
  const { mcpClient } = await setup();
  const res = await mcpClient.callTool({
    name: "get_operation_schema",
    arguments: { operation_id: "CreateWebhook" },
  });
  const out = parse(res);
  assert.equal(out.requestContentType, "application/json");
  assert.equal(out.method, "post");
  assert.equal(out.path, "/v1/webhooks");
  assert.ok(out.requestSchema, "expected a request schema");
  assert.ok(!text(res).includes('"$ref"'), "schema must be fully dereferenced");
});

test("get_operation_schema unknown id fails with suggestions", async () => {
  const { mcpClient } = await setup();
  const res = await mcpClient.callTool({
    name: "get_operation_schema",
    arguments: { operation_id: "CreateWebhooks" },
  });
  assert.equal((res as any).isError, true);
  assert.ok(text(res).includes("CreateWebhook"), text(res));
});

test("kit_request executes GetStore via fetch", async () => {
  const payload = { store: { id: "s1", name: "Demo" } };
  const { calls, mcpClient } = await setup(payload);
  const res = await mcpClient.callTool({
    name: "kit_request",
    arguments: { operation_id: "GetStore" },
  });
  assert.equal((res as any).isError ?? false, false);
  assert.deepEqual(parse(res), payload);
  assert.equal(calls.length, 1);
  assert.ok(calls[0]!.url.includes("/v1/store"), calls[0]!.url);
  assert.equal(calls[0]!.init?.method, "GET");
});

test("kit_request blocks invalid CreateWebhook body before any network call", async () => {
  const { calls, mcpClient } = await setup();
  const res = await mcpClient.callTool({
    name: "kit_request",
    arguments: { operation_id: "CreateWebhook", body: {} }, // missing required url/events
  });
  assert.equal((res as any).isError, true);
  assert.equal(parse(res).code, "LOCAL_VALIDATION_ERROR");
  assert.equal(calls.length, 0, "must not hit the API on invalid body");
});

test("kit_request with validate=false skips validation and sends the request", async () => {
  const { calls, mcpClient } = await setup({ id: "wh1" });
  const res = await mcpClient.callTool({
    name: "kit_request",
    // Same schema-invalid body as above, but validation is explicitly disabled.
    arguments: { operation_id: "CreateWebhook", body: {}, validate: false },
  });
  assert.equal((res as any).isError ?? false, false);
  assert.deepEqual(parse(res), { id: "wh1" });
  assert.equal(calls.length, 1, "request must reach the API when validation is skipped");
  assert.equal(calls[0]!.init?.method, "POST");
});

test("kit_request rejects multipart UploadFile", async () => {
  const { calls, mcpClient } = await setup();
  const res = await mcpClient.callTool({
    name: "kit_request",
    arguments: { operation_id: "UploadFile" },
  });
  assert.equal((res as any).isError, true);
  assert.equal(parse(res).code, "MULTIPART_NOT_SUPPORTED");
  assert.equal(calls.length, 0);
});

test("kit_request unknown operation fails with suggestions", async () => {
  const { calls, mcpClient } = await setup();
  const res = await mcpClient.callTool({
    name: "kit_request",
    arguments: { operation_id: "CreateWebhok" },
  });
  assert.equal((res as any).isError, true);
  assert.equal(parse(res).code, "UNKNOWN_OPERATION");
  // The suggestion list is the feature under test; its wording is the contract.
  assert.ok(text(res).includes("Did you mean"), text(res));
  assert.equal(calls.length, 0);
});
