import assert from "node:assert/strict";
import { test } from "node:test";

import {
  FakeOperatorMcp,
  runOperatorScenario,
  type OperatorDiscount,
  type OperatorOrder,
  type OperatorPromocode,
  type OperatorVariant,
  type OperatorWebhook,
} from "./operator-skill-scenario.js";

/** Simulates a consumer that receives the actual coverage envelope without legacy aliases. */
class ActualCoverageEnvelopeMcp extends FakeOperatorMcp {
  readonly observedEnvelopes: Array<Record<string, unknown>> = [];

  override async call(name: string, arguments_: Record<string, unknown>): Promise<unknown> {
    const result = await super.call(name, arguments_);
    if (arguments_.all === true && result !== null && typeof result === "object") {
      const actual = result as Record<string, unknown>;
      const { pages: _pages, truncated: _truncated, ...envelope } = actual;
      this.observedEnvelopes.push(envelope);
      return envelope;
    }
    return result;
  }
}

const NOW = new Date("2026-07-30T10:00:00Z");

function order(overrides: Partial<OperatorOrder> = {}): OperatorOrder {
  return {
    id: "order-123",
    order_number: 123,
    created_at: "2026-07-30T09:00:00Z",
    status: "WAIT_FOR_CONFIRMATION",
    client: { first_name: "Анна" },
    payment: { status: "PAYMENT_PAID" },
    delivery_chunks: [],
    total_price: "1000.00",
    total_final_price: "1000.00",
    purchased_price: "1000.00",
    gift_card_discount: "0.00",
    ...overrides,
  };
}

function variant(overrides: Partial<OperatorVariant> = {}): OperatorVariant {
  return {
    id: "variant-42",
    sku: "SKU-42",
    name: "Товар 42",
    status: "PUBLISHED",
    product_id: "product-42",
    pricing: { price: "1000.00" },
    stocks: [{ warehouse_id: "warehouse-1", quantity: 3, reserved: 0 }],
    media: [{ type: "IMAGE", image_id: "image-1", display_sequence: 1 }],
    ...overrides,
  };
}

function promocode(overrides: Partial<OperatorPromocode> = {}): OperatorPromocode {
  return {
    id: "promocode-10",
    code: "PROMO10",
    title: "Промокод 10",
    status: "ACTIVE",
    type: "ORDER",
    binding_mode: "ALL_VARIANTS",
    max_usage: 5,
    usage_count: 1,
    promocode_dates: { start_date: "2026-07-01T00:00:00Z" },
    ...overrides,
  };
}

function webhook(overrides: Partial<OperatorWebhook> = {}): OperatorWebhook {
  return {
    id: "webhook-1",
    url: "https://example.com/webhook",
    status: "INACTIVE",
    events: ["ORDER_STATUS_CHANGED"],
    ...overrides,
  };
}

function discount(overrides: Partial<OperatorDiscount> = {}): OperatorDiscount {
  return {
    id: "discount-15",
    title: "SALE15",
    status: "ACTIVE",
    discount_value: { value: "10.00", type: "PERCENT" },
    discount_dates: { start_date: "2026-07-01T00:00:00Z" },
    binding_mode: "ALL_VARIANTS",
    ...overrides,
  };
}

test("an exact confirmation reads, writes once, and re-reads without another question", async () => {
  const mcp = new FakeOperatorMcp({ orders: [order()] });

  const result = await runOperatorScenario({
    request: "Подтверди заказ 123",
    kitContext: true,
    now: NOW,
    mcp,
  });

  assert.deepEqual(
    mcp.calls
      .filter((call) => ["get_order", "confirm_order"].includes(call.name))
      .map((call) => ({ name: call.name, arguments: call.arguments })),
    [
      { name: "get_order", arguments: { id: "order-123" } },
      { name: "confirm_order", arguments: { id: "order-123" } },
      { name: "get_order", arguments: { id: "order-123" } },
    ],
  );
  assert.equal(mcp.calls.filter((call) => call.name === "confirm_order").length, 1);
});

test("an exact cancellation keeps the owner-provided reason in the MCP log and verifies the result", async () => {
  const mcp = new FakeOperatorMcp({
    orders: [order({ id: "order-124", order_number: 124, status: "NEW" })],
  });

  const result = await runOperatorScenario({
    request: "Отмени заказ 124, причина: клиент попросил",
    kitContext: true,
    now: NOW,
    mcp,
  });

  assert.deepEqual(
    mcp.calls
      .filter((call) => ["get_order", "cancel_order"].includes(call.name))
      .map((call) => ({ name: call.name, arguments: call.arguments })),
    [
      { name: "get_order", arguments: { id: "order-124" } },
      {
        name: "cancel_order",
        arguments: { id: "order-124", reason: "клиент попросил" },
      },
      { name: "get_order", arguments: { id: "order-124" } },
    ],
  );
  assert.equal(mcp.calls.filter((call) => call.name === "cancel_order").length, 1);
});

test("an exact cancellation does not require a reason the API cannot store", async () => {
  const mcp = new FakeOperatorMcp({
    orders: [order({ id: "order-125", order_number: 125, status: "NEW" })],
  });

  const result = await runOperatorScenario({
    request: "Отмени заказ 125",
    kitContext: true,
    now: NOW,
    mcp,
  });

  assert.deepEqual(
    mcp.calls
      .filter((call) => ["get_order", "cancel_order"].includes(call.name))
      .map((call) => ({ name: call.name, arguments: call.arguments })),
    [
      { name: "get_order", arguments: { id: "order-125" } },
      { name: "cancel_order", arguments: { id: "order-125" } },
      { name: "get_order", arguments: { id: "order-125" } },
    ],
  );
});

test("an ambiguous order command asks whether to confirm or cancel and performs no write", async () => {
  const mcp = new FakeOperatorMcp({ orders: [order()] });

  const result = await runOperatorScenario({
    request: "Обработай заказы",
    kitContext: true,
    now: NOW,
    mcp,
  });

  assert.equal(mcp.calls.length, 0);
  assert.equal(mcp.writeCalls.length, 0);
});

test("an exact confirmation batch continues after a local error and reports both outcomes", async () => {
  const mcp = new FakeOperatorMcp({
    orders: [
      order({ id: "order-201", order_number: 201 }),
      order({ id: "order-202", order_number: 202 }),
    ],
    writeErrors: {
      "confirm_order:order-202": new Error("API rejected order 202"),
    },
  });

  const result = await runOperatorScenario({
    request: "Подтверди заказы 201, 202",
    kitContext: true,
    now: NOW,
    mcp,
  });

  assert.deepEqual(
    mcp.calls
      .filter((call) => ["get_order", "confirm_order"].includes(call.name))
      .map((call) => `${call.name}:${String(call.arguments.id)}`),
    [
      "get_order:order-201",
      "confirm_order:order-201",
      "get_order:order-201",
      "get_order:order-202",
      "confirm_order:order-202",
      "get_order:order-202",
    ],
  );
  assert.equal(mcp.calls.filter((call) => call.name === "confirm_order").length, 2);
});

test("an exact cancellation batch continues after a local error and retains the shared reason", async () => {
  const mcp = new FakeOperatorMcp({
    orders: [
      order({ id: "order-211", order_number: 211, status: "NEW" }),
      order({ id: "order-212", order_number: 212, status: "NEW" }),
    ],
    writeErrors: {
      "cancel_order:order-212": new Error("API rejected order 212"),
    },
  });

  const result = await runOperatorScenario({
    request: "Отмени заказы 211, 212, причина: клиент попросил",
    kitContext: true,
    now: NOW,
    mcp,
  });

  assert.deepEqual(
    mcp.calls
      .filter((call) => ["get_order", "cancel_order"].includes(call.name))
      .map((call) => `${call.name}:${String(call.arguments.id)}`),
    [
      "get_order:order-211",
      "cancel_order:order-211",
      "get_order:order-211",
      "get_order:order-212",
      "cancel_order:order-212",
      "get_order:order-212",
    ],
  );
  assert.equal(mcp.calls.filter((call) => call.name === "cancel_order").length, 2);
  assert.ok(
    mcp.calls
      .filter((call) => call.name === "cancel_order")
      .every((call) => call.arguments.reason === "клиент попросил"),
  );
});

test("an exact SKU price change reads, writes the stated value once, and verifies it", async () => {
  const mcp = new FakeOperatorMcp({ orders: [], variants: [variant()] });

  const result = await runOperatorScenario({
    request: "Поставь цену 4 990 для SKU-42",
    kitContext: true,
    now: NOW,
    mcp,
  });

  assert.deepEqual(
    mcp.calls
      .filter((call) => ["get_variant", "update_variant"].includes(call.name))
      .map((call) => ({ name: call.name, arguments: call.arguments })),
    [
      { name: "get_variant", arguments: { id: "variant-42" } },
      {
        name: "update_variant",
        arguments: {
          id: "variant-42",
          variant: { pricing: { price: "4990.00" } },
        },
      },
      { name: "get_variant", arguments: { id: "variant-42" } },
    ],
  );
  assert.equal(mcp.calls.filter((call) => call.name === "update_variant").length, 1);
});

test("an exact HIDDEN SKU remains addressable like the real list_variants contract", async () => {
  const mcp = new FakeOperatorMcp({
    orders: [],
    variants: [variant({ status: "HIDDEN" })],
  });

  const result = await runOperatorScenario({
    request: "Поставь цену 4 990 для SKU-42",
    kitContext: true,
    now: NOW,
    mcp,
  });

  assert.equal(mcp.calls.filter((call) => call.name === "update_variant").length, 1);
});

test("duplicate exact SKU matches require an ID and perform no write", async () => {
  const mcp = new FakeOperatorMcp({
    orders: [],
    variants: [
      variant({ id: "variant-a", sku: "DUP" }),
      variant({ id: "variant-b", sku: "DUP" }),
    ],
  });

  const result = await runOperatorScenario({
    request: "Поставь цену 100 для DUP",
    kitContext: true,
    now: NOW,
    mcp,
  });

  assert.equal(mcp.writeCalls.length, 0);
});

test("a truncated SKU lookup cannot prove uniqueness and performs no write", async () => {
  const mcp = new FakeOperatorMcp({
    orders: [],
    variants: [variant({ sku: "DUP" })],
    truncated: { variants: true },
  });

  const result = await runOperatorScenario({
    request: "Поставь цену 100 для DUP",
    kitContext: true,
    now: NOW,
    mcp,
  });

  assert.equal(mcp.writeCalls.length, 0);
});

test("a partial actual coverage envelope cannot write a visible SKU", async () => {
  const mcp = new ActualCoverageEnvelopeMcp({
    orders: [],
    variants: [variant({ sku: "DUP" })],
    truncated: { variants: true },
  });

  await runOperatorScenario({
    request: "Поставь цену 100 для DUP",
    kitContext: true,
    now: NOW,
    mcp,
  });

  assert.equal(mcp.writeCalls.length, 0);
  assert.equal(mcp.observedEnvelopes.length, 1);
  assert.equal(mcp.observedEnvelopes[0]?.coverage, "partial");
  assert.equal("pages" in mcp.observedEnvelopes[0]!, false);
  assert.equal("truncated" in mcp.observedEnvelopes[0]!, false);
});

test("an explicit variant ID wins over a coincidentally matching SKU", async () => {
  const mcp = new FakeOperatorMcp({
    orders: [],
    variants: [
      variant({ id: "DUP", sku: "PRIMARY" }),
      variant({ id: "variant-other", sku: "DUP" }),
    ],
    truncated: { variants: true },
  });

  const result = await runOperatorScenario({
    request: "Поставь цену 100 для DUP",
    kitContext: true,
    now: NOW,
    mcp,
  });

  assert.deepEqual(
    mcp.calls
      .filter((call) => call.name === "update_variant")
      .map((call) => call.arguments.id),
    ["DUP"],
  );
});

test("an explicit UUID bypasses a failed list lookup and uses its detail read", async () => {
  const id = "00000000-0000-4000-8000-000000000042";
  const mcp = new FakeOperatorMcp({
    orders: [],
    variants: [variant({ id, sku: "PRIMARY" })],
    readErrors: {
      list_variants: new Error("variant list unavailable"),
    },
  });

  const result = await runOperatorScenario({
    request: `Поставь цену 100 для ${id}`,
    kitContext: true,
    now: NOW,
    mcp,
  });

  assert.deepEqual(
    mcp.calls
      .filter((call) => ["list_variants", "get_variant", "update_variant"].includes(call.name))
      .map((call) => call.name),
    ["get_variant", "update_variant", "get_variant"],
  );
});

test("duplicate order numbers require an ID and perform no write", async () => {
  const mcp = new FakeOperatorMcp({
    orders: [
      order({ id: "order-a", order_number: 777 }),
      order({ id: "order-b", order_number: 777 }),
    ],
  });

  const result = await runOperatorScenario({
    request: "Подтверди заказ 777",
    kitContext: true,
    now: NOW,
    mcp,
  });

  assert.equal(mcp.writeCalls.length, 0);
});

test("an exact stock change preserves other warehouses and verifies the stated quantity", async () => {
  const mcp = new FakeOperatorMcp({
    orders: [],
    variants: [
      variant({
        stocks: [
          { warehouse_id: "warehouse-1", quantity: 3, reserved: 1 },
          { warehouse_id: "warehouse-2", quantity: 8, reserved: 2 },
        ],
      }),
    ],
  });

  const result = await runOperatorScenario({
    request: "Установи остаток 5 для SKU-42 на складе warehouse-1",
    kitContext: true,
    now: NOW,
    mcp,
  });

  assert.deepEqual(
    mcp.calls
      .filter((call) => ["get_variant", "update_variant"].includes(call.name))
      .map((call) => ({ name: call.name, arguments: call.arguments })),
    [
      { name: "get_variant", arguments: { id: "variant-42" } },
      {
        name: "update_variant",
        arguments: {
          id: "variant-42",
          variant: {
            stocks: [
              { warehouse_id: "warehouse-1", quantity: 5, reserved: 1 },
              { warehouse_id: "warehouse-2", quantity: 8, reserved: 2 },
            ],
          },
        },
      },
      { name: "get_variant", arguments: { id: "variant-42" } },
    ],
  );
  assert.equal(mcp.calls.filter((call) => call.name === "update_variant").length, 1);
});

test("a stock change is ambiguous when verification loses a sibling warehouse", async () => {
  const mcp = new FakeOperatorMcp({
    orders: [],
    variants: [
      variant({
        stocks: [
          { warehouse_id: "warehouse-1", quantity: 3, reserved: 1 },
          { warehouse_id: "warehouse-2", quantity: 8, reserved: 2 },
        ],
      }),
    ],
    variantWriteOverrides: {
      "update_variant:variant-42": {
        stocks: [
          { warehouse_id: "warehouse-1", quantity: 5, reserved: 1 },
        ],
      },
    },
  });

  const result = await runOperatorScenario({
    request: "Установи остаток 5 для SKU-42 на складе warehouse-1",
    kitContext: true,
    now: NOW,
    mcp,
  });

  assert.equal(mcp.writeCalls.length, 1);
});

test("an exact promocode limit change reads, writes once, and verifies it", async () => {
  const mcp = new FakeOperatorMcp({ orders: [], promocodes: [promocode()] });

  const result = await runOperatorScenario({
    request: "Установи лимит 10 для промокода PROMO10",
    kitContext: true,
    now: NOW,
    mcp,
  });

  assert.deepEqual(
    mcp.calls
      .filter((call) => ["get_promocode", "update_promocode"].includes(call.name))
      .map((call) => ({ name: call.name, arguments: call.arguments })),
    [
      { name: "get_promocode", arguments: { id: "promocode-10" } },
      {
        name: "update_promocode",
        arguments: { id: "promocode-10", promocode: { max_usage: 10 } },
      },
      { name: "get_promocode", arguments: { id: "promocode-10" } },
    ],
  );
  assert.deepEqual(
    mcp.calls
      .filter((call) => call.name === "list_promocodes")
      .map((call) => call.arguments.status)
      .sort(),
    ["ACTIVE", "INACTIVE"],
  );
  assert.equal(mcp.calls.filter((call) => call.name === "update_promocode").length, 1);
});

test("an exact promocode status change uses the owner-stated status", async () => {
  const mcp = new FakeOperatorMcp({ orders: [], promocodes: [promocode()] });

  const result = await runOperatorScenario({
    request: "Отключи промокод PROMO10",
    kitContext: true,
    now: NOW,
    mcp,
  });

  assert.deepEqual(
    mcp.calls
      .filter((call) => ["get_promocode", "update_promocode"].includes(call.name))
      .map((call) => ({ name: call.name, arguments: call.arguments })),
    [
      { name: "get_promocode", arguments: { id: "promocode-10" } },
      {
        name: "update_promocode",
        arguments: { id: "promocode-10", promocode: { status: "INACTIVE" } },
      },
      { name: "get_promocode", arguments: { id: "promocode-10" } },
    ],
  );
});

test("duplicate promocode codes require an ID and perform no write", async () => {
  const mcp = new FakeOperatorMcp({
    orders: [],
    promocodes: [
      promocode({ id: "promo-a", code: "DUPCODE" }),
      promocode({ id: "promo-b", code: "DUPCODE" }),
    ],
  });

  const result = await runOperatorScenario({
    request: "Отключи промокод DUPCODE",
    kitContext: true,
    now: NOW,
    mcp,
  });

  assert.equal(mcp.writeCalls.length, 0);
});

test("an exact discount value is written with its stated unit and verified", async () => {
  const mcp = new FakeOperatorMcp({ orders: [], discounts: [discount()] });

  const result = await runOperatorScenario({
    request: "Установи скидку 15% для акции SALE15",
    kitContext: true,
    now: NOW,
    mcp,
  });

  assert.deepEqual(
    mcp.calls
      .filter((call) => ["get_discount", "update_discount"].includes(call.name))
      .map((call) => ({ name: call.name, arguments: call.arguments })),
    [
      { name: "get_discount", arguments: { id: "discount-15" } },
      {
        name: "update_discount",
        arguments: {
          id: "discount-15",
          discount: { discount_value: { value: "15.00", type: "PERCENT" } },
        },
      },
      { name: "get_discount", arguments: { id: "discount-15" } },
    ],
  );
});

test("duplicate discount titles require an exact ID and perform no write", async () => {
  const mcp = new FakeOperatorMcp({
    orders: [],
    discounts: [
      discount({ id: "discount-a", title: "SUMMER" }),
      discount({ id: "discount-b", title: "SUMMER" }),
    ],
  });

  const result = await runOperatorScenario({
    request: "Установи скидку 15% для акции SUMMER",
    kitContext: true,
    now: NOW,
    mcp,
  });

  assert.equal(mcp.calls.filter((call) => call.name === "update_discount").length, 0);
});

test("an exact promocode binding reads current IDs, writes once, and verifies the SKU", async () => {
  const mcp = new FakeOperatorMcp({
    orders: [],
    variants: [variant()],
    promocodes: [promocode({ binding_mode: "SELECTED_VARIANTS" })],
    bindings: { "GetPromocodeVariantIDs:promocode-10": [] },
  });

  const result = await runOperatorScenario({
    request: "Привяжи SKU-42 к промокоду PROMO10",
    kitContext: true,
    now: NOW,
    mcp,
  });

  assert.equal(mcp.calls.filter((call) => call.name === "manage_promocode_objects").length, 1);
  assert.deepEqual(
    mcp.calls.find((call) => call.name === "manage_promocode_objects")?.arguments,
    {
      id: "promocode-10",
      action: "add",
      objects: { product_variant_ids: ["variant-42"] },
    },
  );
  assert.equal(
    mcp.calls.filter(
      (call) =>
        call.name === "kit_request" &&
        call.arguments.operation_id === "GetPromocodeVariantIDs",
    ).length,
    2,
  );
});

test("an exact webhook validation and activation is verified by a final read", async () => {
  const mcp = new FakeOperatorMcp({ orders: [], webhooks: [webhook()] });

  const result = await runOperatorScenario({
    request: "Проверь и активируй вебхук webhook-1",
    kitContext: true,
    now: NOW,
    mcp,
  });

  assert.deepEqual(
    mcp.calls
      .filter((call) => ["get_webhook", "validate_webhook"].includes(call.name))
      .map((call) => ({ name: call.name, arguments: call.arguments })),
    [
      { name: "get_webhook", arguments: { id: "webhook-1" } },
      {
        name: "validate_webhook",
        arguments: { id: "webhook-1", activate: true },
      },
      { name: "get_webhook", arguments: { id: "webhook-1" } },
    ],
  );
  assert.equal(mcp.calls.filter((call) => call.name === "validate_webhook").length, 1);
});

test("standalone exact webhook activation authorizes validation with activate=true", async () => {
  const mcp = new FakeOperatorMcp({ orders: [], webhooks: [webhook()] });

  const result = await runOperatorScenario({
    request: "Активируй вебхук webhook-1",
    kitContext: true,
    now: NOW,
    mcp,
  });

  assert.equal(mcp.calls.filter((call) => call.name === "validate_webhook").length, 1);
  assert.deepEqual(
    mcp.calls.find((call) => call.name === "validate_webhook")?.arguments,
    { id: "webhook-1", activate: true },
  );
});

test("confirmation, cancellation and price timeouts are attempted once, re-read, and ambiguous", async () => {
  const timeout = new Error("request timed out after 30000ms");
  timeout.name = "TimeoutError";
  const cases = [
    {
      request: "Подтверди заказ 301",
      mcp: new FakeOperatorMcp({
        orders: [order({ id: "order-301", order_number: 301 })],
        writeErrors: { "confirm_order:order-301": timeout },
      }),
      tool: "confirm_order",
      read: "get_order",
      id: "order-301",
    },
    {
      request: "Отмени заказ 302, причина: клиент попросил",
      mcp: new FakeOperatorMcp({
        orders: [order({ id: "order-302", order_number: 302, status: "NEW" })],
        writeErrors: { "cancel_order:order-302": timeout },
      }),
      tool: "cancel_order",
      read: "get_order",
      id: "order-302",
    },
    {
      request: "Поставь цену 4 990 для SKU-42",
      mcp: new FakeOperatorMcp({
        orders: [],
        variants: [variant()],
        writeErrors: { "update_variant:variant-42": timeout },
      }),
      tool: "update_variant",
      read: "get_variant",
      id: "variant-42",
    },
  ];

  for (const scenario of cases) {
    const result = await runOperatorScenario({
      request: scenario.request,
      kitContext: true,
      now: NOW,
      mcp: scenario.mcp,
    });

    assert.deepEqual(
      scenario.mcp.calls
        .filter((call) => [scenario.read, scenario.tool].includes(call.name))
        .map((call) => `${call.name}:${String(call.arguments.id)}`),
      [
        `${scenario.read}:${scenario.id}`,
        `${scenario.tool}:${scenario.id}`,
        `${scenario.read}:${scenario.id}`,
      ],
    );
    assert.equal(scenario.mcp.calls.filter((call) => call.name === scenario.tool).length, 1);
  }
});

test("a mutation 5xx is ambiguous and is never retried", async () => {
  const serverError = Object.assign(new Error("internal server error"), {
    status: 500,
  });
  const mcp = new FakeOperatorMcp({
    orders: [order()],
    writeErrors: {
      "confirm_order:order-123": serverError,
    },
  });

  const result = await runOperatorScenario({
    request: "Подтверди заказ 123",
    kitContext: true,
    now: NOW,
    mcp,
  });

  assert.equal(mcp.calls.filter((call) => call.name === "confirm_order").length, 1);
  assert.equal(mcp.calls.filter((call) => call.name === "get_order").length, 2);
});

test("HTTP 408 after a mutation is ambiguous even without a timeout word", async () => {
  const requestTimeout = Object.assign(new Error("request expired"), {
    status: 408,
  });
  const mcp = new FakeOperatorMcp({
    orders: [order()],
    writeErrors: {
      "confirm_order:order-123": requestTimeout,
    },
  });

  const result = await runOperatorScenario({
    request: "Подтверди заказ 123",
    kitContext: true,
    now: NOW,
    mcp,
  });

  assert.equal(mcp.calls.filter((call) => call.name === "confirm_order").length, 1);
});

test("an order lookup error becomes a per-target batch outcome", async () => {
  const mcp = new FakeOperatorMcp({
    orders: [
      order({ id: "order-501", order_number: 501 }),
      order({ id: "order-502", order_number: 502 }),
    ],
    listOrderErrors: {
      1: new Error("orders unavailable"),
    },
  });

  const result = await runOperatorScenario({
    request: "Подтверди заказы 501, 502",
    kitContext: true,
    now: NOW,
    mcp,
  });

  assert.equal(mcp.writeCalls.length, 0);
});

test("a confirmation batch separates failed and ambiguous items and continues", async () => {
  const timeout = new Error("network timeout");
  timeout.name = "TimeoutError";
  const mcp = new FakeOperatorMcp({
    orders: [
      order({ id: "order-401", order_number: 401 }),
      order({ id: "order-402", order_number: 402 }),
      order({ id: "order-403", order_number: 403 }),
    ],
    writeErrors: {
      "confirm_order:order-402": timeout,
      "confirm_order:order-403": new Error("API rejected order 403"),
    },
  });

  const result = await runOperatorScenario({
    request: "Подтверди заказы 401, 402, 403",
    kitContext: true,
    now: NOW,
    mcp,
  });

  assert.equal(mcp.calls.filter((call) => call.name === "confirm_order").length, 3);
});

test("a successful mutation response with a mismatching re-read is ambiguous", async () => {
  const mcp = new FakeOperatorMcp({
    orders: [],
    variants: [variant()],
    writeNoops: ["update_variant:variant-42"],
  });

  const result = await runOperatorScenario({
    request: "Поставь цену 4 990 для SKU-42",
    kitContext: true,
    now: NOW,
    mcp,
  });

  assert.equal(mcp.calls.filter((call) => call.name === "update_variant").length, 1);
  assert.equal(mcp.calls.filter((call) => call.name === "get_variant").length, 2);
});

test("review, show, inspect and find intents stay read-only while actually reading the store", async () => {
  for (const request of [
    "Проверь магазин",
    "Покажи состояние магазина",
    "Разбери магазин",
    "Найди проблемы магазина",
  ]) {
    const mcp = new FakeOperatorMcp({ orders: [] });

    await runOperatorScenario({
      request,
      kitContext: true,
      now: NOW,
      mcp,
    });

    assert.ok(mcp.calls.length > 0, `${request}: expected read calls`);
    assert.equal(mcp.writeCalls.length, 0, `${request}: expected no write calls`);
  }
});

test("a price repair without a stated value asks for that value and performs no write", async () => {
  const mcp = new FakeOperatorMcp({ orders: [], variants: [variant()] });

  const result = await runOperatorScenario({
    request: "Исправь цену SKU-42",
    kitContext: true,
    now: NOW,
    mcp,
  });

  assert.equal(mcp.calls.length, 0);
  assert.equal(mcp.writeCalls.length, 0);
});
