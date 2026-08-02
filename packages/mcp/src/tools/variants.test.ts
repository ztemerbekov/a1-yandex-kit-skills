import { test } from "node:test";
import assert from "node:assert/strict";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { KitClient } from "yandex-kit-core";

import { registerVariantTools } from "./variants.js";

interface RecordedCall {
  url: string;
  init: RequestInit | undefined;
}

/** `payload` may be a function of the 0-based call index to vary responses per call. */
async function setup(payload: unknown = { ok: true }) {
  const calls: RecordedCall[] = [];
  const client = new KitClient({
    token: "t",
    rps: 1000,
    fetchImpl: (async (url: unknown, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      const body = typeof payload === "function" ? payload(calls.length - 1) : payload;
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch,
  });
  const server = new McpServer({ name: "test-server", version: "0.0.0" });
  registerVariantTools(server, client);
  const mcp = new Client({ name: "test-client", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await mcp.connect(clientTransport);
  return { calls, mcp };
}

function resultText(res: unknown): string {
  return (res as { content: { text: string }[] }).content[0]!.text;
}

test("list_variants passes page and filters through, clamps per_page to 100", async () => {
  const { calls, mcp } = await setup({ variants: [], total_count: 0 });
  const res = await mcp.callTool({
    name: "list_variants",
    arguments: { page: 3, per_page: 999, product_id: "prod-1", status: ["PUBLISHED"] },
  });
  assert.equal((res as { isError?: boolean }).isError, undefined);
  assert.equal(calls.length, 1);
  const url = new URL(calls[0]!.url);
  assert.equal(url.pathname, "/v1/variants");
  assert.equal(url.searchParams.get("page"), "3");
  assert.equal(url.searchParams.get("per_page"), "100");
  assert.equal(url.searchParams.get("product_id"), "prod-1");
  assert.deepEqual(url.searchParams.getAll("status"), ["PUBLISHED"]);
});

test("get_variant hits /v1/variants/{id}", async () => {
  const { calls, mcp } = await setup({ id: "v1" });
  await mcp.callTool({ name: "get_variant", arguments: { id: "v-42" } });
  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0]!.url).pathname, "/v1/variants/v-42");
  assert.equal(calls[0]!.init?.method, "GET");
});

test("create_variant with invalid body fails without any network call", async () => {
  const { calls, mcp } = await setup();
  // CreateVariantRequest requires both name and product_id.
  const res = await mcp.callTool({
    name: "create_variant",
    arguments: { variant: { name: "T-shirt" } },
  });
  assert.equal((res as { isError?: boolean }).isError, true);
  assert.equal(JSON.parse(resultText(res)).code, "LOCAL_VALIDATION_ERROR");
  assert.equal(calls.length, 0);
});

test("create_variant with a minimal valid body performs the request", async () => {
  const { calls, mcp } = await setup({ id: "v1" });
  const variant = { name: "T-shirt", product_id: "019b21d9-c5d9-777d-80bd-d67c664bc6d9" };
  const res = await mcp.callTool({ name: "create_variant", arguments: { variant } });
  assert.equal((res as { isError?: boolean }).isError, undefined);
  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0]!.url).pathname, "/v1/variants");
  assert.equal(calls[0]!.init?.method, "POST");
  const headers = calls[0]!.init?.headers as Record<string, string>;
  assert.equal(headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(calls[0]!.init?.body as string), variant);
});

test("update_variant with an empty body fails without any network call", async () => {
  const { calls, mcp } = await setup();
  const res = await mcp.callTool({ name: "update_variant", arguments: { id: "v1", variant: {} } });
  assert.equal((res as { isError?: boolean }).isError, true);
  assert.equal(JSON.parse(resultText(res)).code, "EMPTY_UPDATE_BODY");
  assert.equal(calls.length, 0);
});

test("update_variant sends application/merge-patch+json", async () => {
  const { calls, mcp } = await setup({ id: "v1" });
  const res = await mcp.callTool({
    name: "update_variant",
    arguments: { id: "v1", variant: { name: "Renamed" } },
  });
  assert.equal((res as { isError?: boolean }).isError, undefined);
  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0]!.url).pathname, "/v1/variants/v1");
  assert.equal(calls[0]!.init?.method, "PATCH");
  const headers = calls[0]!.init?.headers as Record<string, string>;
  assert.equal(headers["Content-Type"], "application/merge-patch+json");
});

test("variant_action archive hits /v1/variants/{id}/archive", async () => {
  const { calls, mcp } = await setup();
  const res = await mcp.callTool({ name: "variant_action", arguments: { id: "v1", action: "archive" } });
  assert.equal((res as { isError?: boolean }).isError, undefined);
  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0]!.url).pathname, "/v1/variants/v1/archive");
  assert.equal(calls[0]!.init?.method, "POST");
});

test("variant_action unarchive hits /v1/variants/{id}/unarchive", async () => {
  const { calls, mcp } = await setup();
  await mcp.callTool({ name: "variant_action", arguments: { id: "v1", action: "unarchive" } });
  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0]!.url).pathname, "/v1/variants/v1/unarchive");
});

// Issue #54 guardrail: the live API silently strips ARCHIVED from the status
// filter and falls back to the default non-archived listing.

test("list_variants fails with STATUS_FILTER_IGNORED when the response has statuses outside the filter", async () => {
  const { calls, mcp } = await setup({
    variants: [
      { id: "v1", status: "PUBLISHED" },
      { id: "v2", status: "HIDDEN" },
    ],
    total_count: 2,
  });
  const res = await mcp.callTool({ name: "list_variants", arguments: { status: ["ARCHIVED"] } });
  assert.equal((res as { isError?: boolean }).isError, true);
  assert.equal(JSON.parse(resultText(res)).code, "STATUS_FILTER_IGNORED");
  assert.equal(calls.length, 1, "out-of-filter items need no extra probe");
});

test("list_variants returns a provably empty archive when the unfiltered probe is non-empty", async () => {
  const { calls, mcp } = await setup((call: number) =>
    call === 0
      ? { variants: [], total_count: 0 }
      : { variants: [{ id: "v1", status: "PUBLISHED" }], total_count: 12 },
  );
  const res = await mcp.callTool({ name: "list_variants", arguments: { status: ["ARCHIVED"] } });
  assert.equal((res as { isError?: boolean }).isError, undefined);
  assert.deepEqual(JSON.parse(resultText(res)).variants, []);
  assert.equal(calls.length, 2);
  const probeUrl = new URL(calls[1]!.url);
  assert.equal(probeUrl.searchParams.get("per_page"), "1");
  assert.deepEqual(probeUrl.searchParams.getAll("status"), [], "the probe must be unfiltered");
});

test("list_variants fails with ARCHIVE_READ_UNSUPPORTED when both listings are empty", async () => {
  const { calls, mcp } = await setup({ variants: [], total_count: 0 });
  const res = await mcp.callTool({ name: "list_variants", arguments: { status: ["ARCHIVED"] } });
  assert.equal((res as { isError?: boolean }).isError, true);
  assert.equal(JSON.parse(resultText(res)).code, "ARCHIVE_READ_UNSUPPORTED");
  assert.equal(calls.length, 2);
});

test("list_variants passes archived variants through once the API honors the filter", async () => {
  const { calls, mcp } = await setup({
    variants: [{ id: "v1", status: "ARCHIVED" }],
    total_count: 1,
  });
  const res = await mcp.callTool({ name: "list_variants", arguments: { status: ["ARCHIVED"] } });
  assert.equal((res as { isError?: boolean }).isError, undefined);
  assert.equal(JSON.parse(resultText(res)).variants[0].status, "ARCHIVED");
  assert.equal(calls.length, 1, "a trustworthy response needs no probe");
});

test("list_variants all=true also detects an ignored status filter", async () => {
  const { mcp } = await setup({ variants: [{ id: "v1", status: "PUBLISHED" }] });
  const res = await mcp.callTool({
    name: "list_variants",
    arguments: { all: true, status: ["ARCHIVED"] },
  });
  assert.equal((res as { isError?: boolean }).isError, true);
  assert.equal(JSON.parse(resultText(res)).code, "STATUS_FILTER_IGNORED");
});

test("variant_action rejects an invalid action value", async () => {
  const { calls, mcp } = await setup();
  let errored = false;
  try {
    const res = await mcp.callTool({ name: "variant_action", arguments: { id: "v1", action: "delete" } });
    errored = (res as { isError?: boolean }).isError === true;
  } catch {
    errored = true; // zod input validation surfaces as a protocol error
  }
  assert.equal(errored, true);
  assert.equal(calls.length, 0);
});
