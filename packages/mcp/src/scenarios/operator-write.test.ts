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
} from "./operator-scenario.js";

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
  assert.match(result.report, /Выполнено \(1\)/);
  assert.match(result.report, /order-123.*подтверждён/i);
  assert.doesNotMatch(result.report, /подтвердите действие/i);
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
  assert.match(result.report, /Выполнено \(1\)/);
  assert.match(result.report, /клиент попросил/);
  assert.match(result.report, /API.*не сохраняет причину/i);
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
  assert.match(result.report, /подтвердить или отменить\?/i);
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
  assert.match(result.report, /Выполнено \(1\)/);
  assert.match(result.report, /Не выполнено \(1\)/);
  assert.match(result.report, /order-202.*API rejected order 202/i);
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
  assert.match(result.report, /Выполнено \(1\)/);
  assert.match(result.report, /SKU-42.*4990\.00/);
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
  assert.match(result.report, /Выполнено \(1\)/);
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
  assert.match(result.report, /Выполнено \(1\)/);
  assert.match(result.report, /warehouse-1.*5/i);
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
  assert.match(result.report, /Выполнено \(1\)/);
  assert.match(result.report, /PROMO10.*10/);
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
  assert.match(result.report, /Выполнено \(1\)/);
  assert.match(result.report, /PROMO10.*INACTIVE/);
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
  assert.match(result.report, /Выполнено \(1\)/);
  assert.match(result.report, /SALE15.*15\.00.*PERCENT/);
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
  assert.match(result.report, /Неоднозначно \(1\)/);
  assert.match(result.report, /несколько акций.*точный ID/i);
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
  assert.match(result.report, /Выполнено \(1\)/);
  assert.match(result.report, /PROMO10.*SKU-42.*привязан/i);
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
  assert.match(result.report, /Выполнено \(1\)/);
  assert.match(result.report, /webhook-1.*ACTIVE/);
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
  assert.match(result.report, /Выполнено \(1\)/);
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
    assert.match(result.report, /Выполнено \(0\)/);
    assert.match(result.report, /Не выполнено \(0\)/);
    assert.match(result.report, /Неоднозначно \(1\)/);
    assert.match(result.report, /результат неизвестен.*нужна проверка/i);
  }
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
  assert.match(result.report, /Выполнено \(1\)/);
  assert.match(result.report, /Не выполнено \(1\)/);
  assert.match(result.report, /Неоднозначно \(1\)/);
  assert.match(result.report, /order-402.*результат неизвестен/i);
  assert.match(result.report, /order-403.*API rejected order 403/i);
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
  assert.match(result.report, /Выполнено \(0\)/);
  assert.match(result.report, /Не выполнено \(0\)/);
  assert.match(result.report, /Неоднозначно \(1\)/);
  assert.match(result.report, /повторное чтение не подтвердило.*результат неизвестен/i);
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
  assert.match(result.report, /укажите.*цену.*SKU-42/i);
  assert.equal(mcp.writeCalls.length, 0);
});
