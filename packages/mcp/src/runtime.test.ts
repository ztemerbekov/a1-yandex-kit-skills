import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createConnectionStore } from "yandex-kit-core/connections";
import { ConfigError } from "./config.js";
import { createRuntime } from "./runtime.js";
import { createMcpServer } from "./server.js";

const id = "11111111-1111-4111-8111-111111111111";
async function fixture(t: { after: (fn: () => Promise<void>) => void }) {
  const dir = await mkdtemp(join(tmpdir(), "kit-runtime-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const storageRoot = join(dir, "private");
  const binding = join(dir, ".yandex-kit", "project.json");
  const store = createConnectionStore({ storageRoot });
  await store.writeConnection(id, { version: 1, token: "project-private", store_id: "store-A", store_name: "Saved shop" }, { expectedRevision: null });
  await store.writeBinding(binding, { version: 1, connection_id: id }, { expectedRevision: null });
  return { dir, storageRoot, binding, store };
}

function response(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

test("project runtime ignores inherited token/base URL and pins one verified client across all tools", async (t) => {
  const { storageRoot, binding, store } = await fixture(t);
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchImpl: typeof fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return response({ id: "store-A", slug: "Verified shop", b2c_url: "https://shop.example" });
  };
  const runtime = await createRuntime({
    env: { YANDEX_KIT_TOKEN: "inherited-private", YANDEX_KIT_BASE_URL: "https://wrong.example", YANDEX_KIT_RPS: "1000" },
    argv: ["--project-config", binding], storageRoot, clientOptions: { fetchImpl },
  });
  assert.ok(Object.isFrozen(runtime.config));
  assert.equal(JSON.stringify(runtime).includes("project-private"), false);
  assert.equal(runtime.config.baseUrl, undefined);
  assert.deepEqual(runtime.store, { id: "store-A", name: "Verified shop", url: "https://shop.example" });
  assert.equal(calls.length, 1);
  const old = await store.readConnection(id);
  await store.writeConnection(id, { version: 1, token: "new-private", store_id: "store-B" }, { expectedRevision: old.revision });
  const server = createMcpServer(runtime, "0.0.0");
  const client = new Client({ name: "test", version: "0.0.0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  t.after(async () => { await client.close(); await server.close(); });
  await server.connect(b);
  await client.connect(a);
  assert.match(client.getServerVersion()!.title!, /Verified shop/);
  assert.match(client.getInstructions()!, /Verified shop/);
  const tools = await client.listTools();
  assert.ok(tools.tools.some((tool) => tool.name === "get_store"));
  assert.ok(tools.tools.some((tool) => tool.name === "kit_request"));
  const result = await client.callTool({ name: "get_store", arguments: {} });
  assert.deepEqual(JSON.parse((result.content as { text: string }[])[0]!.text), { id: "store-A", slug: "Verified shop", b2c_url: "https://shop.example" });
  await client.callTool({ name: "kit_request", arguments: { operation_id: "GetStore" } });
  assert.equal(calls.length, 3);
  for (const call of calls) {
    assert.equal(call.url, "https://api.kit.yandex.net/v1/store");
    assert.equal(call.init?.method, "GET");
    assert.equal(new Headers(call.init?.headers).get("Authorization"), "Bearer project-private");
  }
});

test("missing, malformed and unsupported project arguments fail closed before requests or env fallback", async (t) => {
  const { dir, storageRoot } = await fixture(t);
  for (const argv of [["--project-config", join(dir, "missing")], ["--project-config"], ["--project-config", "relative.json"], ["--project-config", "/tmp/a", "--project-config", "/tmp/b"], ["--unknown"]]) {
    let calls = 0;
    await assert.rejects(createRuntime({ env: { YANDEX_KIT_TOKEN: "inherited-private" }, argv, storageRoot, clientOptions: { fetchImpl: async () => { calls++; return response({}); } } }), (err: unknown) => {
      assert.ok(err instanceof ConfigError);
      assert.equal(err.reason, "invalid_config");
      assert.equal(String(err).includes("inherited-private"), false);
      return true;
    });
    assert.equal(calls, 0);
  }
});

for (const failure of ["mismatch", "auth", "network", "malformed"] as const) {
  test(`project identity gate blocks ${failure} and redacts untrusted errors`, async (t) => {
    const { storageRoot, binding } = await fixture(t);
    let calls = 0;
    const fetchImpl: typeof fetch = async () => {
      calls++;
      if (failure === "network") throw new Error("project-private leaked by transport");
      if (failure === "auth") return response({ code: "AUTHENTICATION_ERROR", message: "project-private" }, 401);
      return response(failure === "mismatch" ? { id: "store-B", slug: "Other", b2c_url: "https://other.example" } : {});
    };
    await assert.rejects(createRuntime({ env: {}, argv: ["--project-config", binding], storageRoot, clientOptions: { fetchImpl, maxRetries: 1, retryBaseMs: 1 } }), (err: unknown) => {
      assert.ok(err instanceof ConfigError);
      assert.equal(err.reason, "invalid_config");
      assert.equal(String(err).includes("project-private"), false);
      return true;
    });
    assert.equal(calls, failure === "network" ? 2 : 1);
  });
}

test("legacy env runtime preserves base URL and performs no project identity request", async () => {
  const calls: string[] = [];
  const runtime = await createRuntime({ env: { YANDEX_KIT_TOKEN: "legacy", YANDEX_KIT_BASE_URL: "https://legacy.example" }, clientOptions: { fetchImpl: async (url) => { calls.push(String(url)); return response({ id: "legacy" }); } } });
  assert.equal(calls.length, 0);
  assert.equal(runtime.store, undefined);
  await runtime.client.call("GetStore");
  assert.deepEqual(calls, ["https://legacy.example/v1/store"]);
});
