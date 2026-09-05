import { test } from "node:test";
import assert from "node:assert/strict";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { KitClient } from "yandex-kit-core";

import { registerCustomerTools } from "./customers.js";

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
  registerCustomerTools(server, client);
  const mcp = new Client({ name: "test-client", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await mcp.connect(clientTransport);
  return { calls, mcp };
}

function resultText(res: unknown): string {
  return (res as { content: { text: string }[] }).content[0]!.text;
}

test("registers exactly the four customer tools with correct annotations", async () => {
  const { mcp } = await setup();
  const { tools } = await mcp.listTools();
  const names = tools.map((t) => t.name).sort();
  assert.deepEqual(names, [
    "get_customer",
    "get_customer_orders",
    "list_customers",
    "update_customer",
  ]);
  const readOnly = new Set(["list_customers", "get_customer", "get_customer_orders"]);
  for (const tool of tools) {
    assert.equal(
      tool.annotations?.readOnlyHint,
      readOnly.has(tool.name) ? true : undefined,
      `${tool.name} readOnlyHint`,
    );
  }
});

test("list_customers passes page through and clamps per_page to 100", async () => {
  const { calls, mcp } = await setup({ customers: [], total_count: 0 });
  const res = await mcp.callTool({ name: "list_customers", arguments: { page: 2, per_page: 999 } });
  assert.equal((res as { isError?: boolean }).isError, undefined);
  assert.equal(calls.length, 1);
  const url = new URL(calls[0]!.url);
  assert.equal(url.pathname, "/v1/customers");
  assert.equal(url.searchParams.get("page"), "2");
  assert.equal(url.searchParams.get("per_page"), "100");
});

test("list_customers all=true fetches via listAll with per_page=100", async () => {
  const { calls, mcp } = await setup({ customers: [{ id: "c1" }], total_count: 1 });
  const res = await mcp.callTool({ name: "list_customers", arguments: { all: true } });
  assert.equal(calls.length, 1);
  const url = new URL(calls[0]!.url);
  assert.equal(url.searchParams.get("page"), "1");
  assert.equal(url.searchParams.get("per_page"), "100");
  const data = JSON.parse(resultText(res));
  assert.deepEqual(data, { items: [{ id: "c1" }], pages: 1, truncated: false });
});

test("list_customers redact:true masks personal fields but keeps ids, sums and dates", async () => {
  const customer = {
    customer_id: "c1",
    first_name: "Иван",
    last_name: "Иванов",
    phone: "+79991234567",
    email: "ivan@example.com",
    note: "постоянный клиент",
    order_count: 10,
    order_sum: "10000.00",
    registered_at: "2020-01-01T00:00:00Z",
  };
  const { mcp } = await setup({ customers: [customer], total_count: 1 });
  const res = await mcp.callTool({ name: "list_customers", arguments: { redact: true } });
  const data = JSON.parse(resultText(res));
  assert.deepEqual(data.customers[0], {
    customer_id: "c1",
    first_name: "[redacted]",
    last_name: "[redacted]",
    phone: "[redacted]",
    email: "[redacted]",
    note: "[redacted]",
    order_count: 10,
    order_sum: "10000.00",
    registered_at: "2020-01-01T00:00:00Z",
  });
  assert.equal(data.total_count, 1);
});

test("get_customer without redact returns personal fields untouched", async () => {
  const customer = { customer_id: "c1", phone: "+79991234567", email: "ivan@example.com" };
  const { mcp } = await setup(customer);
  const res = await mcp.callTool({ name: "get_customer", arguments: { id: "c1" } });
  assert.deepEqual(JSON.parse(resultText(res)), customer);
});

test("get_customer maps id to the customer_id path param", async () => {
  const { calls, mcp } = await setup({ id: "c1" });
  await mcp.callTool({ name: "get_customer", arguments: { id: "cust-42" } });
  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0]!.url).pathname, "/v1/customers/cust-42");
  assert.equal(calls[0]!.init?.method, "GET");
});

test("update_customer with an empty body fails without any network call", async () => {
  const { calls, mcp } = await setup();
  const res = await mcp.callTool({
    name: "update_customer",
    arguments: { id: "cust-42", customer: {} },
  });
  assert.equal((res as { isError?: boolean }).isError, true);
  assert.equal(JSON.parse(resultText(res)).code, "EMPTY_UPDATE_BODY");
  assert.equal(calls.length, 0);
});

test("update_customer with a spec-invalid body fails without any network call", async () => {
  const { calls, mcp } = await setup();
  // UpdateCustomerRequest has no required fields, so violate a type: first_name must be a string.
  const res = await mcp.callTool({
    name: "update_customer",
    arguments: { id: "cust-42", customer: { first_name: 123 } },
  });
  assert.equal((res as { isError?: boolean }).isError, true);
  assert.equal(JSON.parse(resultText(res)).code, "LOCAL_VALIDATION_ERROR");
  assert.equal(calls.length, 0);
});

test("update_customer sends a plain application/json PATCH to /v1/customers/{customer_id}", async () => {
  const { calls, mcp } = await setup({ id: "c1" });
  const customer = { first_name: "Ivan", email: "ivan@example.com" };
  const res = await mcp.callTool({
    name: "update_customer",
    arguments: { id: "cust-42", customer },
  });
  assert.equal((res as { isError?: boolean }).isError, undefined);
  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0]!.url).pathname, "/v1/customers/cust-42");
  assert.equal(calls[0]!.init?.method, "PATCH");
  const headers = calls[0]!.init?.headers as Record<string, string>;
  assert.equal(headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(calls[0]!.init?.body as string), customer);
});

test("get_customer_orders hits /v1/customers/{customer_id}/orders and clamps per_page", async () => {
  const { calls, mcp } = await setup({ order_ids: [], total_count: 0 });
  const res = await mcp.callTool({
    name: "get_customer_orders",
    arguments: { id: "cust-42", page: 2, per_page: 999 },
  });
  assert.equal((res as { isError?: boolean }).isError, undefined);
  assert.equal(calls.length, 1);
  const url = new URL(calls[0]!.url);
  assert.equal(url.pathname, "/v1/customers/cust-42/orders");
  assert.equal(url.searchParams.get("page"), "2");
  assert.equal(url.searchParams.get("per_page"), "100");
  assert.equal(calls[0]!.init?.method, "GET");
});
