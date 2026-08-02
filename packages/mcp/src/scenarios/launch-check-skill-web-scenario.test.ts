import assert from "node:assert/strict";
import { test } from "node:test";

import { FakeLaunchWebAdapter, runLaunchCheckScenario } from "./launch-check-skill-scenario.js";
import {
  FakeP1Mcp,
  type PromoCategory,
  type PromoStore,
  type PromoWarehouse,
} from "./promo-launcher-skill-scenario.js";
import type {
  OperatorOrder,
  OperatorProduct,
  OperatorVariant,
} from "./operator-skill-scenario.js";

const NOW = new Date("2026-07-30T09:00:00Z");
const CATEGORY_ID = "00000000-0000-4000-8000-000000000001";
const WAREHOUSE_ID = "00000000-0000-4000-8000-000000000002";
const PRODUCT_ID = "00000000-0000-4000-8000-000000000003";
const VARIANT_ID = "00000000-0000-4000-8000-000000000004";
const STOREFRONT_URL = "https://ready-store.example";
const PRODUCT_PAGE_URL = `${STOREFRONT_URL}/products/ready-1`;

function store(): PromoStore {
  return { id: "store-1", slug: "ready-store", b2c_url: STOREFRONT_URL };
}

function category(): PromoCategory {
  return { id: CATEGORY_ID, title: "Категория", status: "ACTIVE" };
}

function warehouse(): PromoWarehouse {
  return { id: WAREHOUSE_ID, title: "Склад", status: "ACTIVE" };
}

function product(): OperatorProduct {
  return { id: PRODUCT_ID, category_ids: [CATEGORY_ID] };
}

function variant(): OperatorVariant {
  return {
    id: VARIANT_ID,
    sku: "READY-1",
    name: "Готовый товар",
    status: "PUBLISHED",
    product_id: PRODUCT_ID,
    pricing: { price: "1000.00" },
    stocks: [{ warehouse_id: WAREHOUSE_ID, quantity: 3, reserved: 0 }],
    media: [{ type: "IMAGE", image_id: "image-1", display_sequence: 1 }],
  };
}

function order(overrides: Partial<OperatorOrder> = {}): OperatorOrder {
  return {
    id: "order-1",
    order_number: 1001,
    created_at: "2026-07-30T08:00:00Z",
    status: "WAIT_FOR_DELIVERY",
    client: {},
    payment: { status: "PAYMENT_PAID" },
    delivery_chunks: [
      {
        id: 1,
        delivery_info: {
          raw_status: "in_transit",
          human_status: "В пути",
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

function mcpWith(orders: OperatorOrder[] = []): FakeP1Mcp {
  return new FakeP1Mcp({
    store: store(),
    products: [product()],
    variants: [variant()],
    categories: [category()],
    warehouses: [warehouse()],
    orders,
  });
}

function availableWeb(): FakeLaunchWebAdapter {
  return new FakeLaunchWebAdapter({
    responses: {
      [STOREFRONT_URL]: {
        status: 200,
        finalUrl: `${STOREFRONT_URL}/`,
        publicPageUrls: [PRODUCT_PAGE_URL],
      },
      [PRODUCT_PAGE_URL]: { status: 200, finalUrl: PRODUCT_PAGE_URL },
    },
  });
}

test("an absent web capability leaves the storefront unverified and caps readiness", async () => {
  const mcp = mcpWith();
  const result = await runLaunchCheckScenario({
    request: "Можно запускать?",
    now: NOW,
    externalOrderProcessing: false,
    mcp,
  });

  assert.equal(result.status, "CONDITIONALLY_READY");
  assert.equal(result.web.state, "NOT_CHECKED");
  assert.equal(mcp.writeCalls.length, 0);
});

test("an inaccessible public storefront is a proven blocker and NOT_READY", async () => {
  const mcp = mcpWith();
  const web = new FakeLaunchWebAdapter({
    response: { status: 503, finalUrl: STOREFRONT_URL },
  });
  const result = await runLaunchCheckScenario({
    request: "Проверь публичную витрину",
    now: NOW,
    externalOrderProcessing: false,
    web,
    mcp,
  });

  assert.equal(result.status, "NOT_READY");
  assert.equal(result.web.state, "UNAVAILABLE");
  assert.deepEqual(web.calls, [STOREFRONT_URL]);
  assert.ok(result.blockers.length > 0);
  assert.equal(mcp.writeCalls.length, 0);
});

test("an available storefront without checkout evidence remains conditionally ready", async () => {
  const mcp = mcpWith();
  const web = availableWeb();
  const result = await runLaunchCheckScenario({
    request: "Проверь магазин снаружи",
    now: NOW,
    externalOrderProcessing: false,
    web,
    mcp,
  });

  assert.equal(result.status, "CONDITIONALLY_READY");
  assert.equal(result.web.state, "AVAILABLE");
  assert.deepEqual(web.calls, [STOREFRONT_URL, PRODUCT_PAGE_URL]);
  assert.equal(result.checkout.sufficient, false);
  assert.equal(mcp.writeCalls.length, 0);
});

test("a reachable root without a discoverable public page is incomplete web coverage", async () => {
  const mcp = mcpWith();
  const web = new FakeLaunchWebAdapter({
    response: { status: 200, finalUrl: STOREFRONT_URL },
  });
  const result = await runLaunchCheckScenario({
    request: "Проверь магазин снаружи",
    now: NOW,
    externalOrderProcessing: false,
    web,
    checkoutEvidence: {
      kind: "manual",
      ownerConfirmed: true,
      details: "Checkout пройден вручную",
    },
    mcp,
  });

  assert.equal(result.status, "CONDITIONALLY_READY");
  assert.equal(result.web.state, "NOT_CHECKED");
  assert.equal(mcp.writeCalls.length, 0);
});

test("a paid test order is read by ID and can provide sufficient checkout evidence", async () => {
  const checkoutOrder = order();
  const mcp = mcpWith([checkoutOrder]);
  const web = availableWeb();
  const result = await runLaunchCheckScenario({
    request: "Проверь запуск по тестовому заказу order-1",
    now: NOW,
    externalOrderProcessing: false,
    web,
    checkoutEvidence: { kind: "order", orderId: "order-1" },
    mcp,
  });

  assert.equal(result.status, "READY");
  assert.equal(result.checkout.source, "ORDER");
  assert.equal(result.checkout.sufficient, true);
  assert.ok(
    mcp.calls.some(
      (call) => call.name === "get_order" && call.arguments.id === "order-1",
    ),
  );
  assert.equal(mcp.writeCalls.length, 0);
  assert.equal(
    mcp.calls.some((call) =>
      ["create_order", "confirm_order", "pay_order"].includes(call.name),
    ),
    false,
  );
});

test("a paid order with a failed delivery status is not sufficient for READY", async () => {
  const failedDelivery = order({
    delivery_chunks: [
      {
        id: 1,
        delivery_info: {
          raw_status: "cancelled",
          human_status: "Отменена",
          address: { courier_locality: "Москва" },
        },
      },
    ],
  });
  const mcp = mcpWith([failedDelivery]);
  const result = await runLaunchCheckScenario({
    request: "Проверь заказ order-1",
    now: NOW,
    externalOrderProcessing: false,
    web: availableWeb(),
    checkoutEvidence: { kind: "order", orderId: "order-1" },
    mcp,
  });

  assert.equal(result.status, "CONDITIONALLY_READY");
  assert.equal(result.checkout.sufficient, false);
  assert.equal(mcp.writeCalls.length, 0);
});

test("explicit manual checkout proof is owner-provided evidence, not an API claim", async () => {
  const mcp = mcpWith();
  const web = availableWeb();
  const result = await runLaunchCheckScenario({
    request: "Я вручную прошёл checkout: заказ создан и оплата прошла",
    now: NOW,
    externalOrderProcessing: false,
    web,
    checkoutEvidence: {
      kind: "manual",
      ownerConfirmed: true,
      details: "Владелец создал заказ и успешно оплатил его 30 июля",
    },
    mcp,
  });

  assert.equal(result.status, "READY");
  assert.equal(result.checkout.source, "MANUAL");
  assert.equal(result.checkout.sufficient, true);
  assert.equal(
    mcp.calls.some((call) => call.name === "get_order"),
    false,
  );
  assert.equal(mcp.writeCalls.length, 0);
});
