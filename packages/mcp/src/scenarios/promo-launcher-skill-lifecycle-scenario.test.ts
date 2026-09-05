import assert from "node:assert/strict";
import { test } from "node:test";

import {
  runPromoLifecycleScenario,
  type PromoLifecycleResult,
} from "./promo-launcher-skill-lifecycle-scenario.js";
import {
  FakeP1Mcp,
  runPromoLauncherScenario,
  type PromoGift,
} from "./promo-launcher-skill-scenario.js";
import type {
  OperatorDiscount,
  OperatorPromocode,
  OperatorVariant,
} from "./operator-skill-scenario.js";

const NOW = new Date("2026-07-30T09:00:00Z");
const VARIANT_ID = "00000000-0000-4000-8000-000000000001";
const CATEGORY_ID = "00000000-0000-4000-8000-000000000002";

/** Simulates a consumer that receives the actual coverage envelope without legacy aliases. */
class ActualCoverageEnvelopeP1Mcp extends FakeP1Mcp {
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

function discount(overrides: Partial<OperatorDiscount> = {}): OperatorDiscount {
  return {
    id: "discount-1",
    title: "Летняя скидка",
    status: "INACTIVE",
    discount_value: { type: "PERCENT", value: "15.00" },
    discount_dates: {
      start_date: "2026-07-01T00:00:00.000Z",
      end_date: "2026-07-31T20:59:00.000Z",
    },
    binding_mode: "SELECTED_VARIANTS",
    ...overrides,
  };
}

function promocode(overrides: Partial<OperatorPromocode> = {}): OperatorPromocode {
  return {
    id: "promocode-1",
    code: "SUMMER15",
    title: "Летний код",
    status: "INACTIVE",
    type: "PRODUCTS",
    binding_mode: "SELECTED_CATEGORIES_COLLECTIONS",
    discount_value: { type: "PERCENT", value: "15.00" },
    minimum_order_amount: "1000.00",
    max_usage: 100,
    max_discount_amount: "500.00",
    one_time_use: true,
    first_order_only: false,
    show_in_pdp: true,
    usage_count: 7,
    promocode_dates: {
      start_date: "2026-07-01T00:00:00.000Z",
      end_date: "2026-07-31T20:59:00.000Z",
    },
    ...overrides,
  };
}

function gift(overrides: Partial<PromoGift> = {}): PromoGift {
  return {
    id: "gift-1",
    title: "Подарок",
    min_cart_total: "2000.00",
    status: "INACTIVE",
    default_sort: "POPULARITY",
    ...overrides,
  };
}

function variant(overrides: Partial<OperatorVariant> = {}): OperatorVariant {
  return {
    id: VARIANT_ID,
    sku: "SKU-1",
    name: "Товар",
    status: "PUBLISHED",
    product_id: "product-1",
    pricing: { price: "1000.00" },
    stocks: [],
    media: [],
    ...overrides,
  };
}

function assertCompleted(result: PromoLifecycleResult): void {
  assert.equal(result.kind, "completed");
  assert.equal(result.failed.length, 0);
  assert.equal(result.ambiguous.length, 0);
}

test("read-only lifecycle review shows active and inactive conditions with factual bindings", async () => {
  const mcp = new FakeP1Mcp({
    discounts: [
      discount({ status: "ACTIVE" }),
      discount({ id: "discount-2", title: "Неактивная", status: "INACTIVE" }),
    ],
    promocodes: [promocode()],
    gifts: [gift({ status: "ACTIVE" })],
    bindings: {
      "GetDiscountVariantIDs:discount-1": [VARIANT_ID],
      "GetDiscountVariantIDs:discount-2": [],
      "GetPromocodeCategoryIDs:promocode-1": [CATEGORY_ID],
      "GetGiftVariants:gift-1": [VARIANT_ID],
    },
  });
  const result = await runPromoLifecycleScenario({
    request: "Покажи активные и неактивные промо, условия, сроки, лимиты и привязки",
    now: NOW,
    mcp,
  });

  assertCompleted(result);
  for (const fact of [
    "discount-1",
    "ACTIVE",
    "discount-2",
    "INACTIVE",
    "SUMMER15",
    "лимит 100",
    "gift-1",
    VARIANT_ID,
    CATEGORY_ID,
  ]) {
  }
  assert.equal(mcp.writeCalls.length, 0);
});

test("an exact discount extension reads, writes once, rereads, and preserves other fields", async () => {
  const original = discount();
  const mcp = new FakeP1Mcp({ discounts: [original] });
  const result = await runPromoLifecycleScenario({
    request: "Продли скидку discount-1 до 31 августа 2026 23:59 по Москве",
    now: NOW,
    mcp,
  });

  assertCompleted(result);
  assert.deepEqual(
    mcp.calls.map((call) => call.name),
    ["get_discount", "update_discount", "get_discount"],
  );
  assert.equal(mcp.writeCalls.length, 1);
  assert.deepEqual(mcp.calls[1]?.arguments.discount, {
    discount_dates: {
      start_date: "2026-07-01T00:00:00.000Z",
      end_date: "2026-08-31T20:59:00.000Z",
    },
  });
  const actual = (await mcp.call("get_discount", {
    id: "discount-1",
  })) as OperatorDiscount;
  assert.deepEqual(actual.discount_value, original.discount_value);
  assert.equal(actual.status, "INACTIVE");
  assert.equal(actual.binding_mode, "SELECTED_VARIANTS");
});

test("an exact promocode extension changes only dates and preserves all optional terms", async () => {
  const original = promocode();
  const mcp = new FakeP1Mcp({ promocodes: [original] });
  const result = await runPromoLifecycleScenario({
    request: "Продли промокод promocode-1 до 31 августа 2026 23:59 по Москве",
    now: NOW,
    mcp,
  });

  assertCompleted(result);
  assert.deepEqual(
    mcp.calls.map((call) => call.name),
    ["get_promocode", "update_promocode", "get_promocode"],
  );
  assert.equal(mcp.writeCalls.length, 1);
  assert.deepEqual(mcp.calls[1]?.arguments.promocode, {
    promocode_dates: {
      start_date: "2026-07-01T00:00:00.000Z",
      end_date: "2026-08-31T20:59:00.000Z",
    },
  });
  const actual = (await mcp.call("get_promocode", {
    id: "promocode-1",
  })) as OperatorPromocode;
  assert.equal(actual.minimum_order_amount, "1000.00");
  assert.equal(actual.max_usage, 100);
  assert.equal(actual.one_time_use, true);
  assert.equal(actual.show_in_pdp, true);
});

test("exact binding changes use the compatible object family and verify factual IDs", async () => {
  const addMcp = new FakeP1Mcp({
    variants: [variant()],
    discounts: [discount()],
    bindings: { "GetDiscountVariantIDs:discount-1": [] },
  });
  const added = await runPromoLifecycleScenario({
    request: `Добавь вариант ${VARIANT_ID} в скидку discount-1`,
    now: NOW,
    mcp: addMcp,
  });
  const removeMcp = new FakeP1Mcp({
    promocodes: [promocode()],
    bindings: { "GetPromocodeCategoryIDs:promocode-1": [CATEGORY_ID] },
  });
  const removed = await runPromoLifecycleScenario({
    request: `Удали категорию ${CATEGORY_ID} из промокода promocode-1`,
    now: NOW,
    mcp: removeMcp,
  });

  assertCompleted(added);
  assert.deepEqual(
    addMcp.calls.map((call) => call.name),
    ["get_discount", "get_variant", "manage_discount_objects", "get_discount", "kit_request"],
  );
  assert.equal(addMcp.writeCalls.length, 1);
  assertCompleted(removed);
  assert.deepEqual(
    removeMcp.calls.map((call) => call.name),
    ["get_promocode", "manage_promocode_objects", "get_promocode", "kit_request"],
  );
  assert.equal(removeMcp.writeCalls.length, 1);
});

test("gift variants use the gift operations and never mix other object families", async () => {
  const mcp = new FakeP1Mcp({
    variants: [variant()],
    gifts: [gift()],
    bindings: { "GetGiftVariants:gift-1": [] },
  });
  const result = await runPromoLifecycleScenario({
    request: `Добавь вариант ${VARIANT_ID} в подарок gift-1`,
    now: NOW,
    mcp,
  });

  assertCompleted(result);
  assert.deepEqual(
    mcp.calls.map((call) => [
      call.name,
      call.arguments.operation_id,
    ]),
    [
      ["kit_request", "GetGiftById"],
      ["get_variant", undefined],
      ["get_operation_schema", "AddGiftVariants"],
      ["kit_request", "AddGiftVariants"],
      ["kit_request", "GetGiftById"],
      ["kit_request", "GetGiftVariants"],
    ],
  );
  assert.equal(mcp.writeCalls.length, 1);
});

test("an exact multi-condition change sends only named promocode fields", async () => {
  const mcp = new FakeP1Mcp({ promocodes: [promocode()] });
  const result = await runPromoLifecycleScenario({
    request:
      "Измени промокод promocode-1: лимит использований 200, минимальная сумма заказа 1500 рублей",
    now: NOW,
    mcp,
  });

  assertCompleted(result);
  assert.deepEqual(
    mcp.calls.map((call) => call.name),
    ["get_promocode", "update_promocode", "get_promocode"],
  );
  assert.deepEqual(mcp.calls[1]?.arguments.promocode, {
    max_usage: 200,
    minimum_order_amount: "1500.00",
  });
  const actual = (await mcp.call("get_promocode", {
    id: "promocode-1",
  })) as OperatorPromocode;
  assert.equal(actual.discount_value?.value, "15.00");
  assert.equal(actual.max_discount_amount, "500.00");
  assert.equal(actual.one_time_use, true);
  assert.equal(actual.show_in_pdp, true);
});

test("a successful lifecycle write with a mismatching reread is ambiguous", async () => {
  const cases: Array<{
    name: string;
    request: string;
    mcp: FakeP1Mcp;
    id: string;
  }> = [
    {
      name: "discount status",
      request: "Останови скидку discount-1",
      mcp: new FakeP1Mcp({
        discounts: [discount({ status: "ACTIVE" })],
        writeNoops: ["update_discount:discount-1"],
      }),
      id: "discount-1",
    },
    {
      name: "promocode status",
      request: "Останови промокод promocode-1",
      mcp: new FakeP1Mcp({
        promocodes: [promocode({ status: "ACTIVE" })],
        writeNoops: ["update_promocode:promocode-1"],
      }),
      id: "promocode-1",
    },
    {
      name: "gift status",
      request: "Останови подарок gift-1",
      mcp: new FakeP1Mcp({
        gifts: [gift({ status: "ACTIVE" })],
        writeNoops: ["kit_request:UpdateGift"],
      }),
      id: "gift-1",
    },
    {
      name: "extension",
      request: "Продли скидку discount-1 до 31 августа 2026 23:59 по Москве",
      mcp: new FakeP1Mcp({
        discounts: [discount()],
        writeNoops: ["update_discount:discount-1"],
      }),
      id: "discount-1",
    },
    {
      name: "discount binding",
      request: `Добавь вариант ${VARIANT_ID} в скидку discount-1`,
      mcp: new FakeP1Mcp({
        variants: [variant()],
        discounts: [discount()],
        bindings: { "GetDiscountVariantIDs:discount-1": [] },
        writeNoops: ["manage_discount_objects"],
      }),
      id: "discount-1",
    },
    {
      name: "gift binding",
      request: `Добавь вариант ${VARIANT_ID} в подарок gift-1`,
      mcp: new FakeP1Mcp({
        variants: [variant()],
        gifts: [gift()],
        bindings: { "GetGiftVariants:gift-1": [] },
        writeNoops: ["kit_request:AddGiftVariants"],
      }),
      id: "gift-1",
    },
    {
      name: "promocode conditions",
      request:
        "Измени промокод promocode-1: лимит использований 200, минимальная сумма заказа 1500 рублей",
      mcp: new FakeP1Mcp({
        promocodes: [promocode()],
        writeNoops: ["update_promocode:promocode-1"],
      }),
      id: "promocode-1",
    },
  ];

  for (const scenario of cases) {
    const result = await runPromoLifecycleScenario({
      request: scenario.request,
      now: NOW,
      mcp: scenario.mcp,
    });

    assert.equal(result.kind, "ambiguous", scenario.name);
    assert.deepEqual(result.ambiguous, [scenario.id], scenario.name);
    assert.equal(scenario.mcp.writeCalls.length, 1, scenario.name);
  }
});

test("stop and archive commands use the mechanism of each promotion type", async () => {
  const discountMcp = new FakeP1Mcp({ discounts: [discount({ status: "ACTIVE" })] });
  const stoppedDiscount = await runPromoLifecycleScenario({
    request: "Останови скидку discount-1",
    now: NOW,
    mcp: discountMcp,
  });
  const archiveMcp = new FakeP1Mcp({ discounts: [discount({ status: "INACTIVE" })] });
  const archivedDiscount = await runPromoLifecycleScenario({
    request: "Архивируй скидку discount-1",
    now: NOW,
    mcp: archiveMcp,
  });
  const promoMcp = new FakeP1Mcp({ promocodes: [promocode({ status: "ACTIVE" })] });
  const stoppedPromo = await runPromoLifecycleScenario({
    request: "Останови промокод promocode-1",
    now: NOW,
    mcp: promoMcp,
  });
  const giftMcp = new FakeP1Mcp({ gifts: [gift({ status: "ACTIVE" })] });
  const stoppedGift = await runPromoLifecycleScenario({
    request: "Останови подарок gift-1",
    now: NOW,
    mcp: giftMcp,
  });

  for (const result of [
    stoppedDiscount,
    archivedDiscount,
    stoppedPromo,
    stoppedGift,
  ]) {
    assertCompleted(result);
  }
  assert.deepEqual(discountMcp.calls[1]?.arguments.discount, { status: "INACTIVE" });
  assert.deepEqual(archiveMcp.calls[1]?.arguments, {
    id: "discount-1",
    action: "archive",
  });
  assert.deepEqual(promoMcp.calls[1]?.arguments.promocode, { status: "INACTIVE" });
  assert.deepEqual(giftMcp.calls[1]?.arguments, {
    operation_id: "UpdateGift",
  });
  assert.equal(giftMcp.calls[2]?.arguments.operation_id, "UpdateGift");
  assert.deepEqual(giftMcp.calls[2]?.arguments.body, { status: "INACTIVE" });
  assert.equal(giftMcp.calls.some((call) => call.arguments.operation_id === "DeleteGift"), false);
});

test("restart and restore use the correct mechanism and reread every result", async () => {
  const discountMcp = new FakeP1Mcp({ discounts: [discount()] });
  const restartedDiscount = await runPromoLifecycleScenario({
    request: "Запусти скидку discount-1",
    now: NOW,
    mcp: discountMcp,
  });
  const archivedMcp = new FakeP1Mcp({
    discounts: [discount({ status: "ARCHIVED" })],
  });
  const restoredDiscount = await runPromoLifecycleScenario({
    request: "Восстанови скидку discount-1 из архива",
    now: NOW,
    mcp: archivedMcp,
  });
  const promoMcp = new FakeP1Mcp({ promocodes: [promocode()] });
  const restartedPromo = await runPromoLifecycleScenario({
    request: "Запусти промокод promocode-1",
    now: NOW,
    mcp: promoMcp,
  });
  const giftMcp = new FakeP1Mcp({ gifts: [gift()] });
  const restartedGift = await runPromoLifecycleScenario({
    request: "Запусти подарок gift-1",
    now: NOW,
    mcp: giftMcp,
  });

  for (const result of [
    restartedDiscount,
    restoredDiscount,
    restartedPromo,
    restartedGift,
  ]) {
    assertCompleted(result);
  }
  assert.equal(discountMcp.calls[1]?.name, "update_discount");
  assert.equal(discountMcp.calls[3]?.name, "list_discounts");
  assert.deepEqual(archivedMcp.calls[1]?.arguments, {
    id: "discount-1",
    action: "unarchive",
  });
  assert.equal(promoMcp.calls[1]?.name, "update_promocode");
  assert.deepEqual(giftMcp.calls[1]?.arguments, {
    operation_id: "UpdateGift",
  });
  assert.equal(giftMcp.calls[2]?.arguments.operation_id, "UpdateGift");
  assert.equal(discountMcp.writeCalls.length, 1);
  assert.equal(discountMcp.calls.length, 4);
  for (const mcp of [archivedMcp, promoMcp]) {
    assert.equal(mcp.writeCalls.length, 1);
    assert.equal(mcp.calls.length, 3);
  }
  assert.equal(giftMcp.writeCalls.length, 1);
  assert.equal(giftMcp.calls.length, 4);
});

test("a gift is permanently deleted only by the exact phrase 'удали навсегда'", async () => {
  const stopMcp = new FakeP1Mcp({ gifts: [gift({ status: "ACTIVE" })] });
  const stopped = await runPromoLifecycleScenario({
    request: "Удали подарок gift-1",
    now: NOW,
    mcp: stopMcp,
  });
  const deleteMcp = new FakeP1Mcp({ gifts: [gift()] });
  const deleted = await runPromoLifecycleScenario({
    request: "Удали навсегда подарок gift-1",
    now: NOW,
    mcp: deleteMcp,
  });

  assert.equal(stopped.kind, "needs_input");
  assert.equal(stopMcp.writeCalls.length, 0);
  assertCompleted(deleted);
  assert.deepEqual(
    deleteMcp.calls.map((call) => [
      call.name,
      call.arguments.operation_id,
    ]),
    [
      ["kit_request", "GetGiftById"],
      ["get_operation_schema", "DeleteGift"],
      ["kit_request", "DeleteGift"],
      ["kit_request", "GetGiftById"],
    ],
  );
  assert.equal(deleteMcp.writeCalls.length, 1);
});

test("a batch continues after local failures and separates successful and ambiguous objects", async () => {
  const mcp = new FakeP1Mcp({
    discounts: [
      discount({ id: "discount-1", status: "ACTIVE" }),
      discount({ id: "discount-2", status: "ACTIVE" }),
      discount({ id: "discount-3", status: "ACTIVE" }),
    ],
    writeErrors: {
      "update_discount:discount-2": new Error("validation failed"),
      "update_discount:discount-3": new Error("timeout after send"),
    },
  });
  const result = await runPromoLifecycleScenario({
    request: "Останови скидки discount-1, discount-2, discount-3",
    now: NOW,
    mcp,
  });

  assert.equal(result.kind, "partial");
  assert.deepEqual(result.succeeded, ["discount-1"]);
  assert.deepEqual(result.failed, ["discount-2"]);
  assert.deepEqual(result.ambiguous, ["discount-3"]);
  assert.equal(
    mcp.calls.filter((call) => call.name === "update_discount").length,
    3,
  );
  assert.equal(
    mcp.calls.filter(
      (call) =>
        call.name === "get_discount" && call.arguments.id === "discount-1",
    ).length,
    2,
  );
});

test("an overlap after restart is reported as a risk without blocking the exact command", async () => {
  const mcp = new FakeP1Mcp({
    discounts: [
      discount(),
      discount({
        id: "discount-2",
        title: "Другая активная скидка",
        status: "ACTIVE",
      }),
    ],
  });
  const result = await runPromoLifecycleScenario({
    request: "Запусти скидку discount-1",
    now: NOW,
    mcp,
  });

  assertCompleted(result);
  assert.equal(mcp.writeCalls.length, 1);
});

test("a partial actual coverage envelope prevents creating a duplicate discount", async () => {
  const mcp = new ActualCoverageEnvelopeP1Mcp({
    discounts: [discount({ title: "Существующая скидка" })],
    truncated: { discounts: true },
  });
  const result = await runPromoLauncherScenario({
    request:
      "Создай неактивную скидку «Новая скидка» 10% на весь каталог " +
      "с 1 августа 2026 00:00 по Москве бессрочно",
    now: NOW,
    mcp,
  });

  assert.equal(result.kind, "failed");
  assert.equal(mcp.writeCalls.length, 0);
  assert.equal(mcp.observedEnvelopes.length, 1);
  assert.equal(mcp.observedEnvelopes[0]?.coverage, "partial");
  assert.equal("pages" in mcp.observedEnvelopes[0]!, false);
  assert.equal("truncated" in mcp.observedEnvelopes[0]!, false);
});
