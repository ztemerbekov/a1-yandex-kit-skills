import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import {
  runLaunchCheckScenario,
  type LaunchCheckResult,
} from "./launch-check-skill-scenario.js";
import {
  FakeP1Mcp,
  type PromoCategory,
  type PromoGift,
  type PromoStore,
  type PromoWarehouse,
} from "./promo-launcher-skill-scenario.js";
import type {
  OperatorDiscount,
  OperatorProduct,
  OperatorPromocode,
  OperatorVariant,
  OperatorWebhook,
} from "./operator-skill-scenario.js";

const LAUNCH_CHECK_SKILL_URL = new URL(
  "../../../../skills/a1-yandex-kit-launch-check/SKILL.md",
  import.meta.url,
);
const CATEGORY_ID = "00000000-0000-4000-8000-000000000001";
const WAREHOUSE_ID = "00000000-0000-4000-8000-000000000002";
const PRODUCT_ID = "00000000-0000-4000-8000-000000000003";
const VARIANT_ID = "00000000-0000-4000-8000-000000000004";
const NOW = new Date("2026-07-30T09:00:00Z");

function store(overrides: Partial<PromoStore> = {}): PromoStore {
  return {
    id: "store-1",
    slug: "healthy-store",
    b2c_url: "https://healthy-store.example",
    ...overrides,
  };
}

function category(overrides: Partial<PromoCategory> = {}): PromoCategory {
  return {
    id: CATEGORY_ID,
    title: "Категория",
    status: "ACTIVE",
    ...overrides,
  };
}

function warehouse(overrides: Partial<PromoWarehouse> = {}): PromoWarehouse {
  return {
    id: WAREHOUSE_ID,
    title: "Основной склад",
    status: "ACTIVE",
    ...overrides,
  };
}

function product(overrides: Partial<OperatorProduct> = {}): OperatorProduct {
  return {
    id: PRODUCT_ID,
    category_ids: [CATEGORY_ID],
    ...overrides,
  };
}

function variant(overrides: Partial<OperatorVariant> = {}): OperatorVariant {
  return {
    id: VARIANT_ID,
    sku: "READY-1",
    name: "Готовый товар",
    status: "PUBLISHED",
    product_id: PRODUCT_ID,
    pricing: { price: "1000.00" },
    stocks: [{ warehouse_id: WAREHOUSE_ID, quantity: 3, reserved: 0 }],
    media: [{ type: "IMAGE", image_id: "image-1", display_sequence: 1 }],
    ...overrides,
  };
}

function discount(overrides: Partial<OperatorDiscount> = {}): OperatorDiscount {
  return {
    id: "discount-1",
    title: "Летняя скидка",
    status: "ACTIVE",
    discount_value: { type: "PERCENT", value: "10.00" },
    discount_dates: {
      start_date: "2026-07-01T00:00:00.000Z",
      end_date: "2026-07-15T00:00:00.000Z",
    },
    binding_mode: "SELECTED_VARIANTS",
    ...overrides,
  };
}

function promocode(overrides: Partial<OperatorPromocode> = {}): OperatorPromocode {
  return {
    id: "promocode-1",
    code: "LAUNCH10",
    title: "Старт",
    status: "ACTIVE",
    type: "PRODUCTS",
    binding_mode: "SELECTED_VARIANTS",
    usage_count: 10,
    max_usage: 10,
    promocode_dates: {
      start_date: "2026-07-01T00:00:00.000Z",
      end_date: "2026-07-15T00:00:00.000Z",
    },
    ...overrides,
  };
}

function gift(index: number, overrides: Partial<PromoGift> = {}): PromoGift {
  return {
    id: `gift-${index}`,
    title: `Подарок ${index}`,
    min_cart_total: "1000.00",
    status: "ACTIVE",
    default_sort: "POPULARITY",
    ...overrides,
  };
}

function webhook(overrides: Partial<OperatorWebhook> = {}): OperatorWebhook {
  return {
    id: "webhook-1",
    url: "https://hooks.example/orders",
    status: "ACTIVE",
    events: [
      "ORDER_STATUS_CHANGED",
      "ORDER_PAYMENT_STATUS_CHANGED",
      "ORDER_DELIVERY_STATUS_CHANGED",
    ],
    ...overrides,
  };
}

function assertConditionallyReady(result: LaunchCheckResult): void {
  assert.equal(result.status, "CONDITIONALLY_READY");
  assert.equal(result.blockers.length, 0);
  assert.match(result.report, /условно готов/iu);
}

test("a healthy API slice is conditionally ready, fully covered, and read-only", async () => {
  const skill = await readFile(LAUNCH_CHECK_SKILL_URL, "utf8");
  assert.match(skill, /^---\nname: a1-yandex-kit-launch-check\n/m);
  for (const trigger of ["Можно запускать?", "Проверь готовность", "Что мешает открытию?"]) {
    assert.match(skill, new RegExp(trigger.replace(/[?]/g, "\\?")));
  }

  const mcp = new FakeP1Mcp({
    store: store(),
    products: [product()],
    variants: [variant()],
    categories: [category()],
    warehouses: [warehouse()],
  });
  const result = await runLaunchCheckScenario({
    request: "Можно запускать магазин?",
    now: NOW,
    externalOrderProcessing: false,
    mcp,
  });

  assertConditionallyReady(result);
  assert.equal(result.coverage.complete, true);
  assert.deepEqual(result.coverage.counts, {
    stores: 1,
    products: 1,
    variants: 1,
    categories: 1,
    warehouses: 1,
    discounts: 0,
    promocodes: 0,
    gifts: 0,
    webhooks: 0,
    orders: 0,
  });
  assert.equal(mcp.writeCalls.length, 0);
  assert.match(result.report, /Блокеры \(0\)/u);
  assert.match(result.report, /Риски \(0\)/u);
  assert.match(result.report, /Не проверено/u);
  assert.match(result.report, /витрин/u);
  assert.match(result.report, /оплат/u);
  assert.match(result.report, /достав/u);
  assert.match(result.report, /checkout/u);
  assert.match(result.report, /Следующие действия/u);
  assert.doesNotMatch(result.report, /нет заказов.*ошиб/iu);
});

test("proven first-sale catalog blockers produce NOT_READY with exact object evidence", async () => {
  const mcp = new FakeP1Mcp({
    store: store(),
    products: [product()],
    variants: [
      variant({
        pricing: {},
        stocks: [{ warehouse_id: WAREHOUSE_ID, quantity: 1, reserved: 2 }],
        media: [],
      }),
    ],
    categories: [category({ status: "ARCHIVED" })],
    warehouses: [warehouse({ status: "ARCHIVED" })],
  });
  const result = await runLaunchCheckScenario({
    request: "Что мешает открытию?",
    now: NOW,
    externalOrderProcessing: false,
    mcp,
  });

  assert.equal(result.status, "NOT_READY");
  assert.match(result.report, /не готов/iu);
  for (const fact of [
    "положительная цена",
    "резерв 2 больше количества 1",
    "архивный склад",
    "доступного остатка",
    "отсутствует изображение",
    "нет активной категории",
  ]) {
    assert.match(result.report, new RegExp(fact, "iu"));
  }
  assert.match(result.report, new RegExp(VARIANT_ID));
  assert.equal(mcp.writeCalls.length, 0);
});

test("one fully sellable published SKU keeps defects in other SKUs from blocking launch", async () => {
  const brokenProductId = "00000000-0000-4000-8000-000000000013";
  const brokenVariantId = "00000000-0000-4000-8000-000000000014";
  const mcp = new FakeP1Mcp({
    store: store(),
    products: [product(), product({ id: brokenProductId })],
    variants: [
      variant(),
      variant({
        id: brokenVariantId,
        sku: "BROKEN-2",
        product_id: brokenProductId,
        pricing: {},
        stocks: [{ warehouse_id: WAREHOUSE_ID, quantity: 0, reserved: 0 }],
        media: [],
      }),
    ],
    categories: [category()],
    warehouses: [warehouse()],
  });
  const result = await runLaunchCheckScenario({
    request: "Можно запускать хотя бы с одним готовым товаром?",
    now: NOW,
    externalOrderProcessing: false,
    mcp,
  });

  assertConditionallyReady(result);
  assert.equal(result.blockers.length, 0);
  assert.match(result.risks.join("\n"), new RegExp(brokenVariantId));
  assert.match(result.risks.join("\n"), /положительная цена/iu);
  assert.match(result.risks.join("\n"), /доступного остатка/iu);
  assert.match(result.risks.join("\n"), /изображение/iu);
  assert.equal(mcp.writeCalls.length, 0);
});

test("launch check follows every catalog page and reports the complete coverage", async () => {
  const secondProductId = "00000000-0000-4000-8000-000000000013";
  const secondVariantId = "00000000-0000-4000-8000-000000000014";
  const mcp = new FakeP1Mcp({
    store: store(),
    products: [product(), product({ id: secondProductId })],
    variants: [
      variant(),
      variant({
        id: secondVariantId,
        sku: "READY-2",
        product_id: secondProductId,
      }),
    ],
    categories: [category()],
    warehouses: [warehouse()],
    pageSize: 1,
  });
  const result = await runLaunchCheckScenario({
    request: "Проверь готовность",
    now: NOW,
    externalOrderProcessing: false,
    mcp,
  });

  assertConditionallyReady(result);
  assert.equal(result.coverage.complete, true);
  assert.equal(result.coverage.counts.products, 2);
  assert.equal(result.coverage.counts.variants, 2);
  assert.deepEqual(
    mcp.calls
      .filter((call) => call.name === "list_variants")
      .map((call) => call.arguments.page),
    [1, 2],
  );
  assert.deepEqual(
    mcp.calls
      .filter((call) => call.name === "list_products")
      .map((call) => call.arguments.page),
    [1, 2],
  );
  assert.match(result.report, /products=2|products=2/iu);
  assert.equal(mcp.writeCalls.length, 0);
});

test("an interrupted catalog page stays visible and can never produce full readiness", async () => {
  const secondProductId = "00000000-0000-4000-8000-000000000013";
  const mcp = new FakeP1Mcp({
    store: store(),
    products: [product(), product({ id: secondProductId })],
    variants: [
      variant(),
      variant({
        id: "00000000-0000-4000-8000-000000000014",
        sku: "UNREAD-2",
        product_id: secondProductId,
      }),
    ],
    categories: [category()],
    warehouses: [warehouse()],
    pageSize: 1,
    readErrors: { "list_variants:2": new Error("page unavailable") },
  });
  const result = await runLaunchCheckScenario({
    request: "Можно вести покупателей?",
    now: NOW,
    externalOrderProcessing: false,
    mcp,
  });

  assert.equal(result.status, "CONDITIONALLY_READY");
  assert.equal(result.coverage.complete, false);
  assert.match(result.report, /variants: покрытие неполное/iu);
  assert.match(result.report, /page unavailable/u);
  assert.notEqual(result.status, "READY");
  assert.equal(mcp.writeCalls.length, 0);
});

test("expired, exhausted, and empty selected promotions remain factual launch risks", async () => {
  const mcp = new FakeP1Mcp({
    store: store(),
    products: [product()],
    variants: [variant()],
    categories: [category()],
    warehouses: [warehouse()],
    discounts: [discount()],
    promocodes: [promocode()],
    gifts: [gift(1)],
  });
  const result = await runLaunchCheckScenario({
    request: "Проверь промо перед открытием",
    now: NOW,
    externalOrderProcessing: false,
    mcp,
  });

  assertConditionallyReady(result);
  for (const fact of [
    "Скидка Летняя скидка",
    "активна после окончания",
    "Скидка discount-1: выбранный режим не содержит объектов",
    "Промокод LAUNCH10",
    "лимит исчерпан 10/10",
    "Промокод promocode-1: выбранный режим не содержит объектов",
    "Подарок Подарок 1",
    "активен без товаров",
  ]) {
    assert.match(result.report, new RegExp(fact, "iu"));
  }
  assert.equal(mcp.writeCalls.length, 0);
});

test("webhooks block only when external order processing explicitly requires them", async () => {
  const baseFixture = {
    store: store(),
    products: [product()],
    variants: [variant()],
    categories: [category()],
    warehouses: [warehouse()],
  };
  const missing = await runLaunchCheckScenario({
    request: "Можно запускать с внешней обработкой заказов?",
    now: NOW,
    externalOrderProcessing: true,
    mcp: new FakeP1Mcp(baseFixture),
  });
  const optionalMcp = new FakeP1Mcp(baseFixture);
  const optional = await runLaunchCheckScenario({
    request: "Можно запускать без внешней обработки заказов?",
    now: NOW,
    externalOrderProcessing: false,
    mcp: optionalMcp,
  });
  const coveredMcp = new FakeP1Mcp({ ...baseFixture, webhooks: [webhook()] });
  const covered = await runLaunchCheckScenario({
    request: "Можно запускать с внешней обработкой заказов?",
    now: NOW,
    externalOrderProcessing: true,
    mcp: coveredMcp,
  });

  assert.equal(missing.status, "NOT_READY");
  assert.match(missing.report, /нет активного webhook-покрытия/iu);
  assertConditionallyReady(optional);
  assert.doesNotMatch(optional.report, /нет активного webhook-покрытия/iu);
  assertConditionallyReady(covered);
  assert.equal(optionalMcp.writeCalls.length, 0);
  assert.equal(coveredMcp.writeCalls.length, 0);
});

test("active gifts use nested query pagination and preserve complete coverage", async () => {
  const gifts = [gift(1), gift(2)];
  const mcp = new FakeP1Mcp({
    store: store(),
    products: [product()],
    variants: [variant()],
    categories: [category()],
    warehouses: [warehouse()],
    gifts,
    bindings: {
      "GetGiftVariants:gift-1": [VARIANT_ID],
      "GetGiftVariants:gift-2": [VARIANT_ID],
    },
    pageSize: { gifts: 1 },
  });
  const result = await runLaunchCheckScenario({
    request: "Проверь готовность",
    now: NOW,
    externalOrderProcessing: false,
    mcp,
  });

  assertConditionallyReady(result);
  assert.equal(result.coverage.counts.gifts, 2);
  assert.equal(result.coverage.pages.gifts, 2);
  assert.deepEqual(
    mcp.calls
      .filter(
        (call) =>
          call.name === "kit_request" && call.arguments.operation_id === "GetGifts",
      )
      .map(
        (call) =>
          (call.arguments.query as Record<string, unknown> | undefined)?.page,
      ),
    [1, 2],
  );
  assert.equal(mcp.writeCalls.length, 0);
});

test("a critical store read failure is a blocker but does not stop independent sections", async () => {
  const mcp = new FakeP1Mcp({
    products: [product()],
    variants: [variant()],
    categories: [category()],
    warehouses: [warehouse()],
    readErrors: { get_store: new Error("KIT API unavailable") },
  });
  const result = await runLaunchCheckScenario({
    request: "Что мешает открытию?",
    now: NOW,
    externalOrderProcessing: false,
    mcp,
  });

  assert.equal(result.status, "NOT_READY");
  assert.match(result.report, /Доступ к KIT API не подтверждён: KIT API unavailable/u);
  for (const tool of [
    "list_variants",
    "list_products",
    "list_categories",
    "list_warehouses",
    "list_discounts",
    "list_promocodes",
    "list_webhooks",
    "list_orders",
  ]) {
    assert.ok(mcp.calls.some((call) => call.name === tool), `${tool} was not attempted`);
  }
  assert.equal(mcp.writeCalls.length, 0);
});
