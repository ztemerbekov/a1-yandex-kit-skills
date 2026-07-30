import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import {
  FakeOperatorMcp,
  runOperatorReadOnlyScenario,
  type OperatorOrder,
} from "./operator-scenario.js";

const NOW = new Date("2026-07-29T15:00:00Z");

function order(overrides: Partial<OperatorOrder> = {}): OperatorOrder {
  return {
    id: "order-1",
    order_number: 1001,
    created_at: "2026-07-29T09:00:00Z",
    status: "NEW",
    client: { first_name: "Анна", is_notify: true },
    payment: { status: "PAYMENT_PENDING_OR_UNPAID" },
    delivery_chunks: [
      {
        id: 1,
        delivery_info: {
          raw_status: "new",
          human_status: "Новый",
          address: { courier_locality: "Москва" },
        },
      },
    ],
    total_price: "1000.00",
    total_final_price: "1000.00",
    purchased_price: "1000.00",
    gift_card_discount: "0.00",
    ...overrides,
  };
}

test("the operator skill is installable and declares the supported Russian requests", async () => {
  const skill = await readFile(new URL("../../../../skills/a1-yandex-kit-operator/SKILL.md", import.meta.url), "utf8");

  assert.match(skill, /^---\nname: a1-yandex-kit-operator\n/m);
  for (const request of [
    "Как дела в магазине?",
    "Дай статус по магазину",
    "Проведи разбор",
    "Всё ли нормально?",
    "Что срочного?",
    "Что требует внимания?",
  ]) {
    assert.match(skill, new RegExp(request.replace(/[?]/g, "\\?")));
  }
  assert.match(skill, /непросмотренн(ые|ых) заказы/i);
});

test("full review follows every page, expands risky orders, and records a read-only report", async () => {
  const waiting = order({ id: "waiting", order_number: 2001, status: "WAIT_FOR_CONFIRMATION" });
  const overdue = order({
    id: "overdue",
    order_number: 2002,
    created_at: "2026-07-20T09:00:00Z",
    status: "WAIT_FOR_DELIVERY",
    payment: { status: "PAYMENT_PAID" },
    delivery_chunks: [
      {
        id: 7,
        delivery_info: {
          raw_status: "in_transit",
          human_status: "В пути",
          interval: { to: "2026-07-28T12:00:00Z" },
          address: { courier_locality: "Казань" },
        },
      },
    ],
  });
  const mcp = new FakeOperatorMcp({
    orders: [waiting, overdue],
    pageSize: 1,
    addons: { overdue: [{ id: "addon-1" }] },
  });

  const result = await runOperatorReadOnlyScenario({
    request: "Проведи разбор магазина",
    kitContext: true,
    now: NOW,
    mcp,
  });

  assert.deepEqual(
    mcp.calls.filter((call) => call.name === "list_orders").map((call) => call.arguments),
    [
      { page: 1, per_page: 100 },
      { page: 2, per_page: 100 },
    ],
  );
  assert.deepEqual(
    mcp.calls.filter((call) => call.name === "get_order").map((call) => call.arguments),
    [{ id: "waiting" }, { id: "overdue" }],
  );
  assert.deepEqual(
    mcp.calls.filter((call) => call.name === "get_order_addons").map((call) => call.arguments),
    [{ id: "waiting" }, { id: "overdue" }],
  );
  assert.equal(mcp.writeCalls.length, 0);
  assert.equal(mcp.finalAnswer, result.report);
  assert.match(result.report, /waiting/);
  assert.match(result.report, /overdue/);
  assert.match(result.report, /интервал доставки/i);
  assert.match(result.report, /Клиент: Анна/);
  assert.match(result.report, /услуг: 1/);
});

test("urgent view excludes a non-critical new order but keeps overdue delivery", async () => {
  const newOrder = order({ id: "new", order_number: 3001 });
  const overdue = order({
    id: "overdue",
    order_number: 3002,
    created_at: "2026-07-20T09:00:00Z",
    status: "WAIT_FOR_DELIVERY",
    delivery_chunks: [
      {
        id: 1,
        delivery_info: {
          raw_status: "in_transit",
          human_status: "В пути",
          interval: { to: "2026-07-28T12:00:00Z" },
          address: {},
        },
      },
    ],
  });
  const mcp = new FakeOperatorMcp({ orders: [newOrder, overdue] });

  const result = await runOperatorReadOnlyScenario({
    request: "Что срочного?",
    kitContext: true,
    now: NOW,
    mcp,
  });

  assert.match(result.report, /overdue/);
  assert.doesNotMatch(result.report, /Заказ #3001 \(new\)/);
  assert.equal(mcp.writeCalls.length, 0);
});

test("a requested period filters routine orders but never hides an unresolved current threat", async () => {
  const today = order({ id: "today", order_number: 4001 });
  const oldNew = order({ id: "old-new", order_number: 4002, created_at: "2026-07-20T09:00:00Z" });
  const oldRefund = order({
    id: "old-refund",
    order_number: 4003,
    created_at: "2026-07-20T09:00:00Z",
    status: "PARTIAL_REFUND",
  });
  const mcp = new FakeOperatorMcp({ orders: [today, oldNew, oldRefund] });

  const result = await runOperatorReadOnlyScenario({
    request: "Дай статус за сегодня",
    kitContext: true,
    now: NOW,
    mcp,
  });

  assert.match(result.report, /today/);
  assert.match(result.report, /old-refund/);
  assert.doesNotMatch(result.report, /Заказ #4002 \(old-new\)/);
  assert.match(result.report, /Срез: сегодня/);
  assert.equal(mcp.writeCalls.length, 0);
});

test("detail and addon read failures remain visible as missing data in a partial report", async () => {
  const mcp = new FakeOperatorMcp({
    orders: [order({ id: "waiting", status: "WAIT_FOR_CONFIRMATION" })],
    getOrderErrors: { waiting: new Error("details unavailable") },
    addonErrors: { waiting: new Error("addons unavailable") },
  });

  const result = await runOperatorReadOnlyScenario({
    request: "Проведи разбор",
    kitContext: true,
    now: NOW,
    mcp,
  });

  assert.match(result.report, /Недостающие данные:.*детали заказа.*услуги заказа/i);
  assert.equal(mcp.writeCalls.length, 0);
  assert.equal(mcp.finalAnswer, result.report);
});

test("mixed store combines catalog, promotion and webhook signals without a write", async () => {
  const mcp = new FakeOperatorMcp({
    orders: [],
    variants: [
      {
        id: "sku-broken",
        sku: "BROKEN-1",
        name: "Опубликованный SKU без цены",
        status: "PUBLISHED",
        product_id: "product-without-category",
        pricing: {},
        stocks: [{ warehouse_id: "w1", quantity: 2, reserved: 2 }],
        media: [],
      },
    ],
    products: [{ id: "product-without-category", category_ids: [] }],
    discounts: [
      {
        id: "expired-discount",
        title: "Летняя скидка",
        status: "ACTIVE",
        discount_dates: { start_date: "2026-07-01T00:00:00Z", end_date: "2026-07-28T00:00:00Z" },
        binding_mode: "ALL_VARIANTS",
      },
    ],
    promocodes: [
      {
        id: "spent-promo",
        code: "LIMIT",
        title: "Лимитированный",
        status: "ACTIVE",
        type: "PRODUCTS",
        binding_mode: "SELECTED_VARIANTS",
        max_usage: 5,
        usage_count: 5,
        promocode_dates: { start_date: "2026-07-01T00:00:00Z" },
      },
      {
        id: "all-variants-promo",
        code: "MAYBE-OVERLAP",
        title: "Возможное пересечение",
        status: "ACTIVE",
        type: "PRODUCTS",
        binding_mode: "ALL_VARIANTS",
        usage_count: 0,
        promocode_dates: { start_date: "2026-07-01T00:00:00Z" },
      },
    ],
    bindings: { "GetPromocodeVariantIDs:spent-promo": [] },
    webhooks: [
      {
        id: "inactive-webhook",
        url: "https://example.test/hook",
        status: "INACTIVE",
        events: ["ORDER_STATUS_CHANGED"],
      },
    ],
  });

  const result = await runOperatorReadOnlyScenario({
    request: "Как дела в магазине?",
    kitContext: true,
    now: NOW,
    mcp,
  });

  for (const id of ["sku-broken", "expired-discount", "spent-promo", "inactive-webhook"]) {
    assert.match(result.report, new RegExp(id));
  }
  assert.match(result.report, /требует проверки/i);
  assert.doesNotMatch(result.report, /пересечение.*ошибка/i);
  assert.deepEqual(
    new Set(mcp.calls.map((call) => call.name)),
    new Set(["list_orders", "list_variants", "list_products", "list_discounts", "list_promocodes", "kit_request", "list_webhooks"]),
  );
  assert.equal(mcp.writeCalls.length, 0);
});

test("healthy operational data reports no objective store signals", async () => {
  const mcp = new FakeOperatorMcp({
    orders: [],
    variants: [
      {
        id: "healthy-sku",
        sku: "HEALTHY-1",
        name: "Исправный SKU",
        status: "PUBLISHED",
        product_id: "healthy-product",
        pricing: { price: "100.00" },
        stocks: [{ warehouse_id: "w1", quantity: 3, reserved: 0 }],
        media: [{ type: "IMAGE", image_id: "image-1", display_sequence: 1 }],
      },
      {
        id: "hidden-broken-sku",
        sku: "HIDDEN-BROKEN",
        name: "Скрытый SKU не относится к витринному срезу",
        status: "HIDDEN",
        product_id: "hidden-product",
        pricing: {},
        stocks: [{ warehouse_id: "w1", quantity: 0, reserved: 0 }],
        media: [],
      },
    ],
    products: [
      { id: "healthy-product", category_ids: ["category-1"] },
      { id: "hidden-product", category_ids: [] },
    ],
    discounts: [],
    promocodes: [
      {
        id: "selected-promo",
        code: "SELECTED",
        title: "Выбранный без ошибки",
        status: "ACTIVE",
        type: "PRODUCTS",
        binding_mode: "SELECTED_VARIANTS",
        usage_count: 0,
        promocode_dates: { start_date: "2026-07-01T00:00:00Z" },
      },
    ],
    bindings: { "GetPromocodeVariantIDs:selected-promo": ["healthy-sku"] },
    webhooks: [
      {
        id: "healthy-webhook",
        url: "https://example.test/hook",
        status: "ACTIVE",
        events: ["ORDER_STATUS_CHANGED", "ORDER_PAYMENT_STATUS_CHANGED", "ORDER_DELIVERY_STATUS_CHANGED"],
      },
    ],
  });

  const result = await runOperatorReadOnlyScenario({
    request: "Проведи разбор",
    kitContext: true,
    now: NOW,
    mcp,
  });

  assert.match(result.report, /Объективных рисков.*не найдено/i);
  assert.doesNotMatch(result.report, /hidden-broken-sku/i);
  assert.equal(mcp.writeCalls.length, 0);
});

test("truncated catalog read is visible instead of claiming complete coverage", async () => {
  const mcp = new FakeOperatorMcp({
    orders: [],
    variants: [],
    products: [],
    discounts: [],
    promocodes: [],
    webhooks: [],
    truncated: { variants: true },
  });

  const result = await runOperatorReadOnlyScenario({
    request: "Проведи разбор",
    kitContext: true,
    now: NOW,
    mcp,
  });

  assert.match(result.report, /Покрытие каталога/);
  assert.match(result.report, /Требует проверки/);
  assert.equal(mcp.writeCalls.length, 0);
});

test("short 'Как дела?' needs KIT context and never invokes a tool without it", async () => {
  const withoutContext = new FakeOperatorMcp({ orders: [order()] });
  const clarification = await runOperatorReadOnlyScenario({
    request: "Как дела?",
    kitContext: false,
    now: NOW,
    mcp: withoutContext,
  });

  assert.equal(withoutContext.calls.length, 0);
  assert.match(clarification.report, /контекст.*Яндекс KIT/i);

  const withContext = new FakeOperatorMcp({ orders: [order()] });
  await runOperatorReadOnlyScenario({
    request: "Как дела?",
    kitContext: true,
    now: NOW,
    mcp: withContext,
  });
  assert.ok(withContext.calls.length > 0);
  assert.equal(withContext.writeCalls.length, 0);
});
