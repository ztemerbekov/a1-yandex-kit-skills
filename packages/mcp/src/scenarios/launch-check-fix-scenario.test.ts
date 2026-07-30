import assert from "node:assert/strict";
import { test } from "node:test";

import {
  runLaunchCheckFixScenario,
  type KnownLaunchFix,
  type LaunchCheckFixResult,
} from "./launch-check-fix-scenario.js";
import {
  FakeP1Mcp,
  type PromoCategory,
  type PromoStore,
  type PromoWarehouse,
} from "./promo-launcher-skill-scenario.js";
import type {
  OperatorProduct,
  OperatorPromocode,
  OperatorVariant,
} from "./operator-skill-scenario.js";

const NOW = new Date("2026-07-30T09:00:00Z");
const CATEGORY_ID = "00000000-0000-4000-8000-000000000001";
const WAREHOUSE_ID = "00000000-0000-4000-8000-000000000002";
const SECOND_WAREHOUSE_ID = "00000000-0000-4000-8000-000000000012";
const PRODUCT_ID = "00000000-0000-4000-8000-000000000003";
const VARIANT_ID = "00000000-0000-4000-8000-000000000004";

function store(): PromoStore {
  return {
    id: "store-1",
    slug: "launch-store",
    b2c_url: "https://launch-store.example",
  };
}

function category(): PromoCategory {
  return { id: CATEGORY_ID, title: "Категория", status: "ACTIVE" };
}

function warehouses(): PromoWarehouse[] {
  return [
    { id: WAREHOUSE_ID, title: "Основной", status: "ACTIVE" },
    { id: SECOND_WAREHOUSE_ID, title: "Резервный", status: "ACTIVE" },
  ];
}

function product(
  id = PRODUCT_ID,
  overrides: Partial<OperatorProduct> = {},
): OperatorProduct {
  return { id, category_ids: [CATEGORY_ID], ...overrides };
}

function variant(
  overrides: Partial<OperatorVariant> = {},
): OperatorVariant {
  return {
    id: VARIANT_ID,
    sku: "SKU-1",
    name: "Товар",
    status: "PUBLISHED",
    product_id: PRODUCT_ID,
    pricing: { price: "1000.00" },
    stocks: [
      { warehouse_id: WAREHOUSE_ID, quantity: 3, reserved: 0 },
      { warehouse_id: SECOND_WAREHOUSE_ID, quantity: 7, reserved: 1 },
    ],
    media: [{ type: "IMAGE", image_id: "image-1", display_sequence: 1 }],
    characteristics: [
      {
        characteristic_id: "characteristic-1",
        value: "Синий",
        values: ["Синий"],
      },
    ],
    ...overrides,
  };
}

function promocode(
  overrides: Partial<OperatorPromocode> = {},
): OperatorPromocode {
  return {
    id: "promocode-1",
    code: "OLD10",
    title: "Истёкший код",
    status: "ACTIVE",
    type: "ORDER",
    usage_count: 10,
    max_usage: 10,
    promocode_dates: {
      start_date: "2026-07-01T00:00:00.000Z",
      end_date: "2026-07-15T00:00:00.000Z",
    },
    ...overrides,
  };
}

function healthyFixture(overrides: {
  variants?: OperatorVariant[];
  products?: OperatorProduct[];
  promocodes?: OperatorPromocode[];
  writeErrors?: Record<string, Error>;
} = {}) {
  return {
    store: store(),
    products: overrides.products ?? [product()],
    variants: overrides.variants ?? [variant()],
    categories: [category()],
    warehouses: warehouses(),
    promocodes: overrides.promocodes ?? [],
    writeErrors: overrides.writeErrors,
  };
}

function assertNoBackupTools(mcp: FakeP1Mcp): void {
  for (const call of mcp.calls) {
    assert.doesNotMatch(
      `${call.name} ${String(call.arguments.operation_id ?? "")}`,
      /backup|snapshot|restore|rollback/iu,
    );
  }
}

function assertConditionallyReady(result: LaunchCheckFixResult): void {
  assert.equal(result.launch.status, "CONDITIONALLY_READY");
  assert.equal(result.launch.blockers.length, 0);
}

test("ordinary launch-check requests stay read-only through the fix-capable skill", async () => {
  const mcp = new FakeP1Mcp(healthyFixture());
  const result = await runLaunchCheckFixScenario({
    request: "Проверь готовность и покажи, что мешает",
    now: NOW,
    externalOrderProcessing: false,
    mcp,
  });

  assertConditionallyReady(result);
  assert.equal(result.kind, "completed");
  assert.equal(mcp.writeCalls.length, 0);
  assert.match(result.report, /Не проверено/iu);
});

test("an exact stock fix preserves sibling arrays and recomputes launch readiness", async () => {
  const initial = variant({
    stocks: [
      { warehouse_id: WAREHOUSE_ID, quantity: 0, reserved: 0 },
      { warehouse_id: SECOND_WAREHOUSE_ID, quantity: 7, reserved: 1 },
    ],
  });
  const mcp = new FakeP1Mcp(healthyFixture({ variants: [initial] }));
  const result = await runLaunchCheckFixScenario({
    request: `Поставь остаток 5 для ${VARIANT_ID} на складе ${WAREHOUSE_ID}`,
    now: NOW,
    externalOrderProcessing: false,
    mcp,
  });

  assertConditionallyReady(result);
  assert.deepEqual(
    mcp.calls.slice(0, 3).map((call) => call.name),
    ["get_variant", "update_variant", "get_variant"],
  );
  assert.equal(mcp.writeCalls.length, 1);
  assert.deepEqual(mcp.calls[1]?.arguments.variant, {
    stocks: [
      { warehouse_id: WAREHOUSE_ID, quantity: 5, reserved: 0 },
      { warehouse_id: SECOND_WAREHOUSE_ID, quantity: 7, reserved: 1 },
    ],
  });
  const actual = (await mcp.call("get_variant", {
    id: VARIANT_ID,
  })) as OperatorVariant;
  assert.deepEqual(actual.media, initial.media);
  assert.deepEqual(actual.characteristics, initial.characteristics);
  assert.equal(
    mcp.calls.some((call) => call.name === "update_product"),
    false,
  );
  assert.match(result.report, /остаток.*установлен 5/iu);
  assert.match(result.report, /оплат/iu);
  assert.match(result.report, /checkout/iu);
  assertNoBackupTools(mcp);
});

test("an exact promotion fix reuses lifecycle semantics and removes the factual risk", async () => {
  const mcp = new FakeP1Mcp(
    healthyFixture({ promocodes: [promocode()] }),
  );
  const result = await runLaunchCheckFixScenario({
    request: "Останови промокод promocode-1 и заново проверь запуск",
    now: NOW,
    externalOrderProcessing: false,
    mcp,
  });

  assertConditionallyReady(result);
  assert.deepEqual(
    mcp.calls.slice(0, 3).map((call) => call.name),
    ["get_promocode", "update_promocode", "get_promocode"],
  );
  assert.equal(mcp.writeCalls.length, 1);
  assert.doesNotMatch(result.launch.risks.join("\n"), /OLD10|лимит исчерпан/iu);
  assertNoBackupTools(mcp);
});

test("an unknown price becomes one concrete question and never authorizes a write", async () => {
  const mcp = new FakeP1Mcp(
    healthyFixture({ variants: [variant({ pricing: {} })] }),
  );
  const result = await runLaunchCheckFixScenario({
    request: `Исправь цену для ${VARIANT_ID}`,
    now: NOW,
    externalOrderProcessing: false,
    mcp,
  });

  assert.equal(result.kind, "needs_input");
  assert.equal(result.launch.status, "NOT_READY");
  assert.equal(mcp.writeCalls.length, 0);
  assert.match(result.report, /одним сообщением/iu);
  assert.match(result.report, new RegExp(VARIANT_ID));
  assert.match(result.report, /точную цену/iu);
});

test("'Исправь всё' applies known fixes, groups unknown decisions, and reruns the check", async () => {
  const mcp = new FakeP1Mcp(
    healthyFixture({
      variants: [
        variant({
          pricing: {},
          stocks: [
            { warehouse_id: WAREHOUSE_ID, quantity: 0, reserved: 0 },
            { warehouse_id: SECOND_WAREHOUSE_ID, quantity: 7, reserved: 1 },
          ],
        }),
      ],
      promocodes: [promocode()],
    }),
  );
  const knownFixes: KnownLaunchFix[] = [
    {
      kind: "stock",
      variantId: VARIANT_ID,
      warehouseId: WAREHOUSE_ID,
      quantity: 5,
    },
    { kind: "promocode_status", id: "promocode-1", status: "INACTIVE" },
    {
      kind: "unknown",
      objectId: VARIANT_ID,
      field: "price",
      question: `точную цену для ${VARIANT_ID}`,
    },
    {
      kind: "unknown",
      objectId: PRODUCT_ID,
      field: "category",
      question: `правильную категорию для ${PRODUCT_ID}`,
    },
  ];
  const result = await runLaunchCheckFixScenario({
    request: "Исправь всё",
    now: NOW,
    externalOrderProcessing: false,
    knownFixes,
    mcp,
  });

  assert.equal(result.kind, "partial");
  assert.equal(result.launch.status, "NOT_READY");
  assert.deepEqual(result.succeeded, [VARIANT_ID, "promocode-1"]);
  assert.equal(mcp.writeCalls.length, 2);
  assert.match(result.report, /одним сообщением/iu);
  assert.match(result.report, /точную цену/iu);
  assert.match(result.report, /правильную категорию/iu);
  assert.equal(
    mcp.writeCalls.some(
      (call) =>
        call.name === "update_variant" &&
        (call.arguments.variant as Record<string, unknown>).pricing !== undefined,
    ),
    false,
  );
});

test("a batch continues after failure and timeout and keeps every outcome visible", async () => {
  const variant2Id = "00000000-0000-4000-8000-000000000014";
  const variant3Id = "00000000-0000-4000-8000-000000000024";
  const product2Id = "00000000-0000-4000-8000-000000000013";
  const product3Id = "00000000-0000-4000-8000-000000000023";
  const broken = (
    id: string,
    sku: string,
    productId: string,
  ): OperatorVariant =>
    variant({
      id,
      sku,
      product_id: productId,
      stocks: [
        { warehouse_id: WAREHOUSE_ID, quantity: 0, reserved: 0 },
        { warehouse_id: SECOND_WAREHOUSE_ID, quantity: 0, reserved: 0 },
      ],
    });
  const mcp = new FakeP1Mcp(
    healthyFixture({
      variants: [
        broken(VARIANT_ID, "SKU-1", PRODUCT_ID),
        broken(variant2Id, "SKU-2", product2Id),
        broken(variant3Id, "SKU-3", product3Id),
      ],
      products: [product(), product(product2Id), product(product3Id)],
      writeErrors: {
        [`update_variant:${variant2Id}`]: new Error("validation failed"),
        [`update_variant:${variant3Id}`]: new Error("timeout after send"),
      },
    }),
  );
  const knownFixes: KnownLaunchFix[] = [
    {
      kind: "stock",
      variantId: VARIANT_ID,
      warehouseId: WAREHOUSE_ID,
      quantity: 5,
    },
    {
      kind: "stock",
      variantId: variant2Id,
      warehouseId: WAREHOUSE_ID,
      quantity: 5,
    },
    {
      kind: "stock",
      variantId: variant3Id,
      warehouseId: WAREHOUSE_ID,
      quantity: 5,
    },
  ];
  const result = await runLaunchCheckFixScenario({
    request: "Исправь всё",
    now: NOW,
    externalOrderProcessing: false,
    knownFixes,
    mcp,
  });

  assert.equal(result.kind, "partial");
  assert.deepEqual(result.succeeded, [VARIANT_ID]);
  assert.deepEqual(result.failed, [variant2Id]);
  assert.deepEqual(result.ambiguous, [variant3Id]);
  assert.equal(result.launch.status, "NOT_READY");
  assert.equal(
    mcp.calls.filter((call) => call.name === "update_variant").length,
    3,
  );
  for (const id of [VARIANT_ID, variant2Id, variant3Id]) {
    assert.ok(
      mcp.calls.filter(
        (call) => call.name === "get_variant" && call.arguments.id === id,
      ).length >= 2,
    );
  }
  assert.match(result.report, /Успешно \(1\)/u);
  assert.match(result.report, /Неуспешно \(1\)/u);
  assert.match(result.report, /Неоднозначно \(1\)/u);
  assertNoBackupTools(mcp);
});
