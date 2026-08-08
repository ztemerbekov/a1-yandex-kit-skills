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
  // The error always echoes the unknown id, and "CreateWebhooks" contains
  // "CreateWebhook" as a substring — only the "Did you mean" prefix proves
  // the suggestion machinery actually ran.
  assert.ok(text(res).includes("Did you mean"), text(res));
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

test("kit_request rejects multipart UploadFile pointing at upload_file", async () => {
  const { calls, mcpClient } = await setup();
  const res = await mcpClient.callTool({
    name: "kit_request",
    arguments: { operation_id: "UploadFile" },
  });
  assert.equal((res as any).isError, true);
  assert.equal(parse(res).code, "MULTIPART_NOT_SUPPORTED");
  // The hint is the consumer LLM's routing signal — it must name exactly the
  // right tool (a generic "upload_file or upload_video" would be ambiguous).
  assert.match(parse(res).error, /upload_file/);
  assert.doesNotMatch(parse(res).error, /upload_video/);
  assert.doesNotMatch(parse(res).error, /planned/);
  assert.equal(calls.length, 0);
});

test("kit_request rejects multipart UploadVideo pointing at upload_video, not upload_file", async () => {
  const { calls, mcpClient } = await setup();
  const res = await mcpClient.callTool({
    name: "kit_request",
    arguments: { operation_id: "UploadVideo" },
  });
  assert.equal((res as any).isError, true);
  assert.equal(parse(res).code, "MULTIPART_NOT_SUPPORTED");
  assert.match(parse(res).error, /upload_video/);
  assert.doesNotMatch(parse(res).error, /upload_file/);
  assert.equal(calls.length, 0);
});

test("kit_request rejects an empty {} PATCH body before any network call", async () => {
  const { calls, mcpClient } = await setup();
  const res = await mcpClient.callTool({
    name: "kit_request",
    arguments: { operation_id: "UpdateProduct", path_params: { id: "p1" }, body: {} },
  });
  assert.equal((res as any).isError, true);
  assert.equal(parse(res).code, "EMPTY_UPDATE_BODY");
  assert.equal(calls.length, 0, "an all-optional schema must not let {} reach the live store");
});

// Issue #54 guardrail: the live API silently strips ARCHIVED from the
// GetVariants status filter and falls back to the default listing.

test("kit_request rejects a list response with statuses outside the requested filter", async () => {
  const { calls, mcpClient } = await setup({
    variants: [{ id: "v1", status: "PUBLISHED" }],
    total_count: 1,
  });
  const res = await mcpClient.callTool({
    name: "kit_request",
    arguments: {
      operation_id: "GetVariants",
      query: { status: ["ARCHIVED"], page: 1, per_page: 100 },
    },
  });
  assert.equal((res as any).isError, true);
  assert.equal(parse(res).code, "STATUS_FILTER_IGNORED");
  assert.equal(calls.length, 1);
});

test("kit_request guards a scalar-string status filter like a one-element array", async () => {
  // ?status=ARCHIVED is the same wire form whether the agent sent "ARCHIVED"
  // or ["ARCHIVED"] — the guard must not be bypassed by the scalar spelling.
  const { calls, mcpClient } = await setup({
    variants: [{ id: "v1", status: "PUBLISHED" }],
    total_count: 1,
  });
  const res = await mcpClient.callTool({
    name: "kit_request",
    arguments: { operation_id: "GetVariants", query: { status: "ARCHIVED" } },
  });
  assert.equal((res as any).isError, true);
  assert.equal(parse(res).code, "STATUS_FILTER_IGNORED");
  assert.equal(calls.length, 1);
});

test("kit_request passes an honored status filter through unchanged", async () => {
  const payload = { variants: [{ id: "v1", status: "ARCHIVED" }], total_count: 1 };
  const { mcpClient } = await setup(payload);
  const res = await mcpClient.callTool({
    name: "kit_request",
    arguments: { operation_id: "GetVariants", query: { status: ["ARCHIVED"] } },
  });
  assert.equal((res as any).isError ?? false, false);
  assert.deepEqual(parse(res), payload);
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
