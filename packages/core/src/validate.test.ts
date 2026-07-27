import { test } from "node:test";
import assert from "node:assert/strict";

import { getRegistry } from "./registry.js";
import { resolveOperationSchema, validateRequestBody } from "./validate.js";

test("validateRequestBody accepts a valid CreateWebhook body", () => {
  const result = validateRequestBody("CreateWebhook", {
    url: "https://x.example/hook",
    events: ["ORDER_STATUS_CHANGED"],
  });
  assert.deepEqual(result, { valid: true, errors: [] });
});

test("validateRequestBody rejects CreateWebhook body missing a required field", () => {
  const result = validateRequestBody("CreateWebhook", {
    url: "https://x.example/hook",
  });
  assert.equal(result.valid, false);
  assert.ok(result.errors.length > 0);
  assert.ok(
    result.errors.some((e) => e.includes("events")),
    `errors should mention "events": ${JSON.stringify(result.errors)}`,
  );
});

test("validateRequestBody rejects CreateWebhook body with events as a string", () => {
  const result = validateRequestBody("CreateWebhook", {
    url: "https://x.example/hook",
    events: "ORDER_STATUS_CHANGED",
  });
  assert.equal(result.valid, false);
  assert.ok(result.errors.length > 0);
  assert.ok(
    result.errors.some((e) => e.includes("/events")),
    `errors should mention "/events": ${JSON.stringify(result.errors)}`,
  );
});

// The spec has exactly 3 fields shaped as {allOf:[{$ref:X}], nullable:true}
// (no sibling `type`); the API accepts null there to clear the field.
test("validateRequestBody accepts null for nullable allOf fields", () => {
  for (const [op, field] of [
    ["UpdateProduct", "size_table"],
    ["UpdateBlog", "attachment"],
    ["UpdateAddon", "geography"],
  ] as const) {
    const result = validateRequestBody(op, { [field]: null });
    assert.deepEqual(result, { valid: true, errors: [] }, `${op}.${field} must accept null`);
  }
});

test("validateRequestBody still rejects a non-null invalid nullable allOf field", () => {
  const result = validateRequestBody("UpdateProduct", { size_table: 42 });
  assert.equal(result.valid, false);
  assert.ok(
    result.errors.some((e) => e.includes("/size_table")),
    `errors should mention "/size_table": ${JSON.stringify(result.errors)}`,
  );
});

test("validateRequestBody is a no-op for an op without a request body", () => {
  const result = validateRequestBody("GetStore", { anything: "goes" });
  assert.deepEqual(result, { valid: true, errors: [] });
});

test("validateRequestBody throws for an unknown operationId", () => {
  assert.throws(
    () => validateRequestBody("NoSuchOperation", {}),
    /Unknown operationId: NoSuchOperation/,
  );
});

test("resolveOperationSchema fully dereferences the GetProducts response", () => {
  const { response } = resolveOperationSchema("GetProducts");
  assert.ok(response, "GetProducts should have a response schema");
  const json = JSON.stringify(response);
  assert.ok(!json.includes('"$ref"'), "response must contain no $ref");
  const products = (response as any).properties?.products;
  assert.equal(products?.type, "array");
  assert.equal(typeof products?.items, "object");
});

test("resolveOperationSchema completes for every op in the registry", () => {
  const registry = getRegistry();
  const ids = Object.keys(registry.ops);
  assert.equal(ids.length, registry.opsCount);
  for (const id of ids) {
    // Must terminate (cycle-safe deref) and leave no unresolved $ref behind.
    const resolved = resolveOperationSchema(id);
    assert.ok(!JSON.stringify(resolved).includes('"$ref"'), id);
  }
});
