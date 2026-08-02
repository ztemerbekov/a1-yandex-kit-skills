import { test } from "node:test";
import assert from "node:assert/strict";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { KitClient } from "yandex-kit-core";

import { registerCategoryTools } from "./categories.js";

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
  registerCategoryTools(server, client);
  const mcp = new Client({ name: "test-client", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await mcp.connect(clientTransport);
  return { calls, mcp };
}

function resultText(res: unknown): string {
  return (res as { content: { text: string }[] }).content[0]!.text;
}

test("list_categories passes page, clamps per_page to 100, defaults status=ACTIVE", async () => {
  const { calls, mcp } = await setup({ categories: [], total_count: 0 });
  const res = await mcp.callTool({ name: "list_categories", arguments: { page: 2, per_page: 999 } });
  assert.equal((res as { isError?: boolean }).isError, undefined);
  assert.equal(calls.length, 1);
  const url = new URL(calls[0]!.url);
  assert.equal(url.pathname, "/v1/categories");
  assert.equal(url.searchParams.get("page"), "2");
  assert.equal(url.searchParams.get("per_page"), "100");
  // status is a required query parameter of GetCategories.
  assert.deepEqual(url.searchParams.getAll("status"), ["ACTIVE"]);
});

test("list_categories passes an explicit status filter through", async () => {
  const { calls, mcp } = await setup({ categories: [], total_count: 0 });
  await mcp.callTool({ name: "list_categories", arguments: { status: ["ARCHIVED"] } });
  assert.equal(calls.length, 1);
  assert.deepEqual(new URL(calls[0]!.url).searchParams.getAll("status"), ["ARCHIVED"]);
});

test("get_category hits /v1/categories/{id}", async () => {
  const { calls, mcp } = await setup({ id: "c1" });
  await mcp.callTool({ name: "get_category", arguments: { id: "cat-7" } });
  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0]!.url).pathname, "/v1/categories/cat-7");
  assert.equal(calls[0]!.init?.method, "GET");
});

test("create_category with invalid body fails without any network call", async () => {
  const { calls, mcp } = await setup();
  // CreateCategoryRequest requires title.
  const res = await mcp.callTool({ name: "create_category", arguments: { category: { slug: "phones" } } });
  assert.equal((res as { isError?: boolean }).isError, true);
  assert.equal(JSON.parse(resultText(res)).code, "LOCAL_VALIDATION_ERROR");
  assert.equal(calls.length, 0);
});

test("create_category with a minimal valid body performs the request", async () => {
  const { calls, mcp } = await setup({ id: "c1" });
  const category = { title: "Phones" };
  const res = await mcp.callTool({ name: "create_category", arguments: { category } });
  assert.equal((res as { isError?: boolean }).isError, undefined);
  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0]!.url).pathname, "/v1/categories");
  assert.equal(calls[0]!.init?.method, "POST");
  const headers = calls[0]!.init?.headers as Record<string, string>;
  assert.equal(headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(calls[0]!.init?.body as string), category);
});

test("update_category with an empty body fails without any network call", async () => {
  const { calls, mcp } = await setup();
  const res = await mcp.callTool({ name: "update_category", arguments: { id: "c1", category: {} } });
  assert.equal((res as { isError?: boolean }).isError, true);
  assert.equal(JSON.parse(resultText(res)).code, "EMPTY_UPDATE_BODY");
  assert.equal(calls.length, 0);
});

test("update_category sends application/merge-patch+json", async () => {
  const { calls, mcp } = await setup({ id: "c1" });
  const res = await mcp.callTool({
    name: "update_category",
    arguments: { id: "c1", category: { title: "Renamed" } },
  });
  assert.equal((res as { isError?: boolean }).isError, undefined);
  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0]!.url).pathname, "/v1/categories/c1");
  assert.equal(calls[0]!.init?.method, "PATCH");
  const headers = calls[0]!.init?.headers as Record<string, string>;
  assert.equal(headers["Content-Type"], "application/merge-patch+json");
});

test("category_action archive hits /v1/categories/{id}/archive with archive_variants", async () => {
  const { calls, mcp } = await setup();
  const res = await mcp.callTool({
    name: "category_action",
    arguments: { id: "c1", action: "archive", archive_variants: true },
  });
  assert.equal((res as { isError?: boolean }).isError, undefined);
  assert.equal(calls.length, 1);
  const url = new URL(calls[0]!.url);
  assert.equal(url.pathname, "/v1/categories/c1/archive");
  assert.equal(url.searchParams.get("archive_variants"), "true");
  assert.equal(calls[0]!.init?.method, "POST");
});

test("category_action unarchive hits /v1/categories/{id}/unarchive", async () => {
  const { calls, mcp } = await setup();
  await mcp.callTool({ name: "category_action", arguments: { id: "c1", action: "unarchive" } });
  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0]!.url).pathname, "/v1/categories/c1/unarchive");
});

test("category_action rejects an invalid action value", async () => {
  const { calls, mcp } = await setup();
  let errored = false;
  try {
    const res = await mcp.callTool({ name: "category_action", arguments: { id: "c1", action: "purge" } });
    errored = (res as { isError?: boolean }).isError === true;
  } catch {
    errored = true; // zod input validation surfaces as a protocol error
  }
  assert.equal(errored, true);
  assert.equal(calls.length, 0);
});
