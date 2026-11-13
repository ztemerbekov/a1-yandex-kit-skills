import { test } from "node:test";
import assert from "node:assert/strict";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { KitClient } from "yandex-kit-core";

import { registerProductTools } from "./products.js";

interface RecordedCall {
  url: string;
  init: RequestInit | undefined;
}

async function setup(payload: unknown = { ok: true }, status = 200) {
  const calls: RecordedCall[] = [];
  const client = new KitClient({
    token: "t",
    rps: 1000,
    fetchImpl: (async (url: unknown, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      if (status === 204) return new Response(null, { status });
      return new Response(JSON.stringify(payload), {
        status,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch,
  });
  const server = new McpServer({ name: "test-server", version: "0.0.0" });
  registerProductTools(server, client);
  const mcp = new Client({ name: "test-client", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await mcp.connect(clientTransport);
  return { calls, mcp };
}

function resultText(res: unknown): string {
  return (res as { content: { text: string }[] }).content[0]!.text;
}

test("list_products passes page through and clamps per_page to 100", async () => {
  const { calls, mcp } = await setup({ products: [], total_count: 0 });
  const res = await mcp.callTool({ name: "list_products", arguments: { page: 2, per_page: 999 } });
  assert.equal((res as { isError?: boolean }).isError, undefined);
  assert.equal(calls.length, 1);
  const url = new URL(calls[0]!.url);
  assert.equal(url.pathname, "/v1/products");
  assert.equal(url.searchParams.get("page"), "2");
  assert.equal(url.searchParams.get("per_page"), "100");
});

test("list_products all=true fetches via listAll with per_page=100", async () => {
  const { calls, mcp } = await setup({ products: [{ id: "p1" }], total_count: 1 });
  const res = await mcp.callTool({ name: "list_products", arguments: { all: true } });
  assert.equal(calls.length, 1);
  const url = new URL(calls[0]!.url);
  assert.equal(url.searchParams.get("page"), "1");
  assert.equal(url.searchParams.get("per_page"), "100");
  const data = JSON.parse(resultText(res));
  assert.deepEqual(data, {
    items: [{ id: "p1" }],
    coverage: "complete",
    received: 1,
    total_count: 1,
    pages_read: 1,
    pages: 1,
    truncated: false,
  });
});

test("list_products marks a short page 2 without total_count as partial", async () => {
  const { calls, mcp } = await setup({ products: [{ id: "p1" }] });
  const res = await mcp.callTool({
    name: "list_products",
    arguments: { page: 2, per_page: 2 },
  });

  assert.equal(new URL(calls[0]!.url).searchParams.get("page"), "2");
  assert.equal(JSON.parse(resultText(res)).coverage, "partial");
});

test("list_products marks an empty page 2 without total_count as partial", async () => {
  const { mcp } = await setup({ products: [] });
  const res = await mcp.callTool({
    name: "list_products",
    arguments: { page: 2, per_page: 2 },
  });

  assert.equal(JSON.parse(resultText(res)).coverage, "partial");
});

test("list_products keeps a short page 1 without total_count complete", async () => {
  const { mcp } = await setup({ products: [{ id: "p1" }] });
  const res = await mcp.callTool({
    name: "list_products",
    arguments: { page: 1, per_page: 2 },
  });

  assert.equal(JSON.parse(resultText(res)).coverage, "complete");
});

test("list_products marks a full page without total_count as partial", async () => {
  const { mcp } = await setup({ products: [{ id: "p1" }, { id: "p2" }] });
  const res = await mcp.callTool({
    name: "list_products",
    arguments: { page: 1, per_page: 2 },
  });

  assert.equal(JSON.parse(resultText(res)).coverage, "partial");
});

test("get_product hits /v1/products/{id}", async () => {
  const { calls, mcp } = await setup({ id: "p1" });
  await mcp.callTool({ name: "get_product", arguments: { id: "abc-123" } });
  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0]!.url).pathname, "/v1/products/abc-123");
  assert.equal(calls[0]!.init?.method, "GET");
});

test("create_product with invalid body fails without any network call", async () => {
  const { calls, mcp } = await setup();
  // CreateProductRequest requires category_ids.
  const res = await mcp.callTool({ name: "create_product", arguments: { product: {} } });
  assert.equal((res as { isError?: boolean }).isError, true);
  assert.equal(JSON.parse(resultText(res)).code, "LOCAL_VALIDATION_ERROR");
  assert.equal(calls.length, 0);
});

test("create_product with a minimal valid body performs the request", async () => {
  const { calls, mcp } = await setup({ id: "p1" });
  const product = { category_ids: ["019b21d9-c5d9-777d-80bd-d67c664bc6d9"] };
  const res = await mcp.callTool({ name: "create_product", arguments: { product } });
  assert.equal((res as { isError?: boolean }).isError, undefined);
  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0]!.url).pathname, "/v1/products");
  assert.equal(calls[0]!.init?.method, "POST");
  const headers = calls[0]!.init?.headers as Record<string, string>;
  assert.equal(headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(calls[0]!.init?.body as string), product);
});

test("update_product with an empty body fails without any network call", async () => {
  const { calls, mcp } = await setup();
  const res = await mcp.callTool({ name: "update_product", arguments: { id: "p1", product: {} } });
  assert.equal((res as { isError?: boolean }).isError, true);
  assert.equal(JSON.parse(resultText(res)).code, "EMPTY_UPDATE_BODY");
  assert.equal(calls.length, 0);
});

test("update_product sends a plain application/json PATCH", async () => {
  const { calls, mcp } = await setup({ id: "p1" });
  const product = { category_ids: ["019b21d9-c5d9-777d-80bd-d67c664bc6d9"] };
  const res = await mcp.callTool({ name: "update_product", arguments: { id: "p1", product } });
  assert.equal((res as { isError?: boolean }).isError, undefined);
  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0]!.url).pathname, "/v1/products/p1");
  assert.equal(calls[0]!.init?.method, "PATCH");
  const headers = calls[0]!.init?.headers as Record<string, string>;
  assert.equal(headers["Content-Type"], "application/json");
});

const CARD_1 = "019b21d9-c5d9-777d-80bd-d67c664bc6d1";
const CARD_2 = "019b21d9-c5d9-777d-80bd-d67c664bc6d2";

/** Calls a tool and reports whether it failed, either as an isError result or a protocol error. */
async function callFails(mcp: Client, name: string, args: Record<string, unknown>): Promise<boolean> {
  try {
    const res = await mcp.callTool({ name, arguments: args });
    return (res as { isError?: boolean }).isError === true;
  } catch {
    return true; // zod input validation surfaces as a protocol error
  }
}

test("bulk_update_card_slugs POSTs the exact batch and maps 204 to {ok:true}", async () => {
  const { calls, mcp } = await setup(undefined, 204);
  const items = [
    { product_card_id: CARD_1, slug: "iphone-15-pro-black" },
    { product_card_id: CARD_2, slug: "case_2" },
  ];
  const res = await mcp.callTool({ name: "bulk_update_card_slugs", arguments: { items } });
  assert.equal((res as { isError?: boolean }).isError, undefined);
  assert.deepEqual(JSON.parse(resultText(res)), { ok: true });
  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0]!.url).pathname, "/v1/products/cards/slugs/bulk_update");
  assert.equal(calls[0]!.init?.method, "POST");
  const headers = calls[0]!.init?.headers as Record<string, string>;
  assert.equal(headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(String(calls[0]!.init?.body)), { items });
});

test("bulk_update_card_slugs rejects a repeated card before the network call", async () => {
  const { calls, mcp } = await setup(undefined, 204);
  const res = await mcp.callTool({
    name: "bulk_update_card_slugs",
    arguments: {
      items: [
        { product_card_id: CARD_1, slug: "a" },
        { product_card_id: CARD_1, slug: "b" },
      ],
    },
  });
  assert.equal((res as { isError?: boolean }).isError, true);
  const payload = JSON.parse(resultText(res));
  assert.equal(payload.code, "DUPLICATE_PRODUCT_CARD_ID");
  assert.match(payload.error, new RegExp(CARD_1));
  assert.equal(calls.length, 0);
});

test("bulk_update_card_slugs rejects a repeated slug before the network call", async () => {
  const { calls, mcp } = await setup(undefined, 204);
  const res = await mcp.callTool({
    name: "bulk_update_card_slugs",
    arguments: {
      items: [
        { product_card_id: CARD_1, slug: "same" },
        { product_card_id: CARD_2, slug: "same" },
      ],
    },
  });
  assert.equal((res as { isError?: boolean }).isError, true);
  const payload = JSON.parse(resultText(res));
  assert.equal(payload.code, "DUPLICATE_SLUG");
  assert.match(payload.error, /same/);
  assert.equal(calls.length, 0);
});

test("bulk_update_card_slugs rejects an empty batch and a batch above 100 without a network call", async () => {
  const { calls, mcp } = await setup(undefined, 204);
  assert.equal(await callFails(mcp, "bulk_update_card_slugs", { items: [] }), true);
  const items = Array.from({ length: 101 }, (_, i) => ({
    product_card_id: `card-${i}`,
    slug: `slug-${i}`,
  }));
  assert.equal(await callFails(mcp, "bulk_update_card_slugs", { items }), true);
  assert.equal(calls.length, 0);
});

test("bulk_update_card_slugs rejects malformed slugs without a network call", async () => {
  const { calls, mcp } = await setup(undefined, 204);
  for (const slug of ["Iphone", "has space", "", "x".repeat(201), "кириллица"]) {
    assert.equal(
      await callFails(mcp, "bulk_update_card_slugs", { items: [{ product_card_id: CARD_1, slug }] }),
      true,
      `slug ${JSON.stringify(slug)} must be rejected`,
    );
  }
  assert.equal(calls.length, 0);
});

test("bulk_update_card_slugs surfaces the per-item errors of a rejected batch", async () => {
  const itemError = {
    product_card_id: CARD_2,
    code: "SLUG_ALREADY_TAKEN",
    message: "Ссылка занята другой карточкой",
  };
  const { calls, mcp } = await setup(
    { code: "VALIDATION_ERROR", message: "Bulk failed", trace_id: "tr-1", errors: [itemError] },
    400,
  );
  const res = await mcp.callTool({
    name: "bulk_update_card_slugs",
    arguments: { items: [{ product_card_id: CARD_2, slug: "taken" }] },
  });
  assert.equal((res as { isError?: boolean }).isError, true);
  const payload = JSON.parse(resultText(res));
  assert.equal(payload.code, "VALIDATION_ERROR");
  assert.equal(payload.status, 400);
  assert.equal(payload.traceId, "tr-1");
  assert.deepEqual(payload.errors, [itemError]);
  assert.equal(payload.errors_total, undefined);
  assert.equal(calls.length, 1, "a mutation is attempted exactly once");
});

test("fail() caps per-item errors at 50 and reports errors_total", async () => {
  const errors = Array.from({ length: 73 }, (_, i) => ({
    product_card_id: `card-${i}`,
    code: "PRODUCT_CARD_NOT_FOUND",
    message: "not found",
  }));
  const { mcp } = await setup({ code: "VALIDATION_ERROR", message: "Bulk failed", errors }, 400);
  const res = await mcp.callTool({
    name: "bulk_update_card_slugs",
    arguments: { items: [{ product_card_id: CARD_1, slug: "a" }] },
  });
  const payload = JSON.parse(resultText(res));
  assert.equal(payload.errors.length, 50);
  assert.deepEqual(payload.errors[0], errors[0]);
  assert.equal(payload.errors_total, 73);
});
