import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import {
  FakeP1Mcp,
  runPromoLauncherScenario,
  type PromoCategory,
} from "./promo-launcher-skill-scenario.js";

const NOW = new Date("2026-07-29T12:00:00Z");
const CATEGORY_ID = "00000000-0000-4000-8000-000000000001";
const PROMO_LAUNCHER_SKILL_URL = new URL(
  "../../../../skills/a1-yandex-kit-promo-launcher/SKILL.md",
  import.meta.url,
);

function category(overrides: Partial<PromoCategory> = {}): PromoCategory {
  return {
    id: CATEGORY_ID,
    title: "Летняя коллекция",
    status: "ACTIVE",
    ...overrides,
  };
}

test("an exact category discount reads the target, writes once per step, and re-reads the result", async () => {
  const skill = await readFile(PROMO_LAUNCHER_SKILL_URL, "utf8");
  assert.match(skill, /^---\nname: a1-yandex-kit-promo-launcher\n/m);
  assert.match(skill, /Запусти скидку/u);

  const mcp = new FakeP1Mcp({ categories: [category()] });
  const result = await runPromoLauncherScenario({
    request:
      `Запусти скидку «Лето» 15% на категорию ${CATEGORY_ID} ` +
      "с завтра 10:00 до воскресенья 23:59 по Москве",
    now: NOW,
    mcp,
  });

  assert.deepEqual(
    mcp.calls.map((call) => call.name),
    [
      "get_category",
      "list_discounts",
      "create_discount",
      "manage_discount_objects",
      "get_discount",
      "kit_request",
    ],
  );
  assert.deepEqual(mcp.calls[2]?.arguments, {
    discount: {
      title: "Лето",
      discount_value: { value: "15.00", type: "PERCENT" },
      discount_dates: {
        start_date: "2026-07-30T07:00:00.000Z",
        end_date: "2026-08-02T20:59:00.000Z",
      },
      status: "ACTIVE",
      binding_mode: "SELECTED_VARIANTS",
    },
  });
  assert.deepEqual(mcp.calls[3]?.arguments, {
    id: "discount-1",
    action: "add",
    objects: { category_ids: [CATEGORY_ID] },
  });
  assert.equal(mcp.writeCalls.length, 2);
  assert.equal(result.kind, "completed");
  assert.match(result.report, /discount-1/);
  assert.match(result.report, /ACTIVE/);
  assert.match(result.report, /15\.00 PERCENT/);
  assert.match(result.report, /объектов: 1/u);
  assert.doesNotMatch(result.report, /подтверд/u);
});

test("an exact perpetual all-catalog discount needs no binding write", async () => {
  const mcp = new FakeP1Mcp();
  const result = await runPromoLauncherScenario({
    request:
      "Создай неактивную скидку «Весь каталог» 500 рублей на весь каталог " +
      "с 1 августа 2026 00:00 по Москве бессрочно",
    now: NOW,
    mcp,
  });

  assert.deepEqual(
    mcp.calls.map((call) => call.name),
    ["list_discounts", "create_discount", "get_discount"],
  );
  assert.deepEqual(mcp.calls[1]?.arguments, {
    discount: {
      title: "Весь каталог",
      discount_value: { value: "500.00", type: "VALUE" },
      discount_dates: { start_date: "2026-07-31T21:00:00.000Z" },
      status: "INACTIVE",
      binding_mode: "ALL_VARIANTS",
    },
  });
  assert.equal(result.kind, "completed");
  assert.match(result.report, /бессрочно/u);
  assert.match(result.report, /весь каталог/u);
});

test("an ambiguous promotion asks one grouped question and performs no write", async () => {
  const mcp = new FakeP1Mcp();
  const result = await runPromoLauncherScenario({
    request: "Запусти акцию 15%",
    now: NOW,
    mcp,
  });

  assert.equal(result.kind, "needs_input");
  assert.match(result.report, /механизм/u);
  assert.match(result.report, /область/u);
  assert.match(result.report, /дату начала/u);
  assert.match(result.report, /дату окончания.*бессрочно/u);
  assert.equal((result.report.match(/\?/gu) ?? []).length, 0);
  assert.equal(mcp.calls.length, 0);
  assert.equal(mcp.writeCalls.length, 0);
});

test("relative dates without a known time zone stop before target reads or writes", async () => {
  const mcp = new FakeP1Mcp({ categories: [category()] });
  const result = await runPromoLauncherScenario({
    request:
      `Запусти скидку «Лето» 15% на категорию ${CATEGORY_ID} ` +
      "с завтра 10:00 до воскресенья 23:59",
    now: NOW,
    mcp,
  });

  assert.equal(result.kind, "needs_input");
  assert.match(result.report, /часовой пояс/u);
  assert.equal(mcp.calls.length, 0);
});

test("an omitted end date is never interpreted as perpetual", async () => {
  const mcp = new FakeP1Mcp({ categories: [category()] });
  const result = await runPromoLauncherScenario({
    request:
      `Запусти скидку «Лето» 15% на категорию ${CATEGORY_ID} ` +
      "с завтра 10:00 по Москве",
    now: NOW,
    mcp,
  });

  assert.equal(result.kind, "needs_input");
  assert.match(result.report, /дату окончания.*бессрочно/u);
  assert.equal(mcp.writeCalls.length, 0);
});

test("an archived target is read and rejected before duplicate checks or writes", async () => {
  const mcp = new FakeP1Mcp({ categories: [category({ status: "ARCHIVED" })] });
  const result = await runPromoLauncherScenario({
    request:
      `Запусти скидку «Лето» 15% на категорию ${CATEGORY_ID} ` +
      "с завтра 10:00 до воскресенья 23:59 по Москве",
    now: NOW,
    mcp,
  });

  assert.equal(result.kind, "failed");
  assert.match(result.report, new RegExp(CATEGORY_ID));
  assert.match(result.report, /архив/u);
  assert.deepEqual(mcp.calls.map((call) => call.name), ["get_category"]);
  assert.equal(mcp.writeCalls.length, 0);
});

test("an equivalent discount is returned instead of duplicated", async () => {
  const mcp = new FakeP1Mcp({
    categories: [category()],
    discounts: [
      {
        id: "existing-discount",
        title: "Лето",
        discount_value: { value: "15.00", type: "PERCENT" },
        discount_dates: {
          start_date: "2026-07-30T07:00:00.000Z",
          end_date: "2026-08-02T20:59:00.000Z",
        },
        status: "ACTIVE",
        binding_mode: "SELECTED_CATEGORIES_COLLECTIONS",
      },
    ],
    bindings: { [`GetDiscountCategoryIDs:existing-discount`]: [CATEGORY_ID] },
  });
  const result = await runPromoLauncherScenario({
    request:
      `Запусти скидку «Лето» 15% на категорию ${CATEGORY_ID} ` +
      "с завтра 10:00 до воскресенья 23:59 по Москве",
    now: NOW,
    mcp,
  });

  assert.equal(result.kind, "completed");
  assert.equal(result.promotionId, "existing-discount");
  assert.match(result.report, /дубль не создан/u);
  assert.deepEqual(
    mcp.calls.map((call) => call.name),
    ["get_category", "list_discounts", "kit_request"],
  );
  assert.equal(mcp.writeCalls.length, 0);
});

test("an overlap is reported as a risk but does not block an exact command", async () => {
  const mcp = new FakeP1Mcp({
    categories: [category()],
    discounts: [
      {
        id: "active-storewide",
        title: "Другая скидка",
        discount_value: { value: "5.00", type: "PERCENT" },
        discount_dates: { start_date: "2026-07-01T00:00:00.000Z" },
        status: "ACTIVE",
        binding_mode: "ALL_VARIANTS",
      },
    ],
  });
  const result = await runPromoLauncherScenario({
    request:
      `Запусти скидку «Лето» 15% на категорию ${CATEGORY_ID} ` +
      "с завтра 10:00 до воскресенья 23:59 по Москве",
    now: NOW,
    mcp,
  });

  assert.equal(result.kind, "completed");
  assert.match(result.report, /Риск:.*активное промо/u);
  assert.equal(mcp.calls.filter((call) => call.name === "create_discount").length, 1);
});

test("a create timeout is attempted once and remains ambiguous", async () => {
  const timeout = new Error("network timeout");
  timeout.name = "TimeoutError";
  const mcp = new FakeP1Mcp({
    categories: [category()],
    writeErrors: { create_discount: timeout },
  });
  const result = await runPromoLauncherScenario({
    request:
      `Запусти скидку «Лето» 15% на категорию ${CATEGORY_ID} ` +
      "с завтра 10:00 до воскресенья 23:59 по Москве",
    now: NOW,
    mcp,
  });

  assert.equal(result.kind, "ambiguous");
  assert.match(result.report, /результат неизвестен/u);
  assert.equal(mcp.calls.filter((call) => call.name === "create_discount").length, 1);
  assert.equal(mcp.calls.filter((call) => call.name === "manage_discount_objects").length, 0);
});

test("an exact limited ORDER promocode is created, activated once, and re-read", async () => {
  const mcp = new FakeP1Mcp();
  const result = await runPromoLauncherScenario({
    request:
      "Запусти промокод WELCOME10 «Первый заказ» 10% на заказ " +
      "с 1 августа 2026 00:00 до 31 августа 2026 23:59 по Москве, " +
      "лимит 100, минимальная сумма заказа 1000 рублей, максимальная скидка 500 рублей, " +
      "только первый заказ, одно использование",
    now: NOW,
    mcp,
  });

  assert.deepEqual(
    mcp.calls.map((call) => call.name),
    [
      "list_promocodes",
      "list_promocodes",
      "create_promocode",
      "get_promocode",
      "update_promocode",
      "get_promocode",
    ],
  );
  assert.deepEqual(mcp.calls[2]?.arguments, {
    promocode: {
      code: "WELCOME10",
      title: "Первый заказ",
      discount_value: { value: "10.00", type: "PERCENT" },
      promocode_dates: {
        start_date: "2026-07-31T21:00:00.000Z",
        end_date: "2026-08-31T20:59:00.000Z",
      },
      type: "ORDER",
      minimum_order_amount: "1000.00",
      max_usage: 100,
      max_discount_amount: "500.00",
      one_time_use: true,
      first_order_only: true,
      show_in_pdp: false,
    },
  });
  assert.deepEqual(mcp.calls[4]?.arguments, {
    id: "promocode-1",
    promocode: { status: "ACTIVE" },
  });
  assert.equal(mcp.calls.some((call) => call.name === "manage_promocode_objects"), false);
  assert.equal(result.kind, "completed");
  assert.match(result.report, /WELCOME10/);
  assert.match(result.report, /ACTIVE/);
  assert.match(result.report, /лимит 100/u);
});

test("a PRODUCTS promocode validates and binds a category without an activation write", async () => {
  const mcp = new FakeP1Mcp({ categories: [category()] });
  const result = await runPromoLauncherScenario({
    request:
      `Создай неактивный промокод SUMMER «Лето» 500 рублей на категорию ${CATEGORY_ID} ` +
      "с 1 августа 2026 00:00 по Москве бессрочно, лимит 50, " +
      "показывать на странице товара",
    now: NOW,
    mcp,
  });

  assert.deepEqual(
    mcp.calls.map((call) => call.name),
    [
      "get_category",
      "list_promocodes",
      "list_promocodes",
      "create_promocode",
      "manage_promocode_objects",
      "get_promocode",
      "kit_request",
    ],
  );
  assert.deepEqual(mcp.calls[3]?.arguments, {
    promocode: {
      code: "SUMMER",
      title: "Лето",
      discount_value: { value: "500.00", type: "VALUE" },
      promocode_dates: { start_date: "2026-07-31T21:00:00.000Z" },
      type: "PRODUCTS",
      binding_mode: "SELECTED_CATEGORIES_COLLECTIONS",
      minimum_order_amount: "0.00",
      max_usage: 50,
      one_time_use: false,
      first_order_only: false,
      show_in_pdp: true,
    },
  });
  assert.deepEqual(mcp.calls[4]?.arguments, {
    id: "promocode-1",
    action: "add",
    objects: { category_ids: [CATEGORY_ID] },
  });
  assert.equal(mcp.calls.some((call) => call.name === "update_promocode"), false);
  assert.equal(result.kind, "completed");
  assert.match(result.report, /show_in_pdp=true/u);
  assert.match(result.report, /1 объектов/u);
});

test("a promocode without a usage limit or explicit unlimited choice performs no read or write", async () => {
  const mcp = new FakeP1Mcp();
  const result = await runPromoLauncherScenario({
    request:
      "Запусти промокод WELCOME10 «Первый заказ» 10% на заказ " +
      "с 1 августа 2026 00:00 до 31 августа 2026 23:59 по Москве",
    now: NOW,
    mcp,
  });

  assert.equal(result.kind, "needs_input");
  assert.match(result.report, /лимит использований.*без лимита/u);
  assert.equal(mcp.calls.length, 0);
  assert.equal(mcp.writeCalls.length, 0);
});

test("a conflicting existing code asks whether to update or choose a new code", async () => {
  const mcp = new FakeP1Mcp({
    promocodes: [
      {
        id: "existing-code",
        code: "WELCOME10",
        title: "Старые условия",
        discount_value: { value: "5.00", type: "PERCENT" },
        status: "ACTIVE",
        type: "ORDER",
        usage_count: 3,
        max_usage: 10,
        one_time_use: false,
        first_order_only: false,
        show_in_pdp: false,
        promocode_dates: {
          start_date: "2026-07-01T00:00:00.000Z",
          end_date: "2026-07-31T00:00:00.000Z",
        },
      },
    ],
  });
  const result = await runPromoLauncherScenario({
    request:
      "Запусти промокод WELCOME10 «Первый заказ» 10% на заказ " +
      "с 1 августа 2026 00:00 до 31 августа 2026 23:59 по Москве, лимит 100",
    now: NOW,
    mcp,
  });

  assert.equal(result.kind, "needs_input");
  assert.match(result.report, /Изменить существующий или использовать новый код/u);
  assert.deepEqual(
    mcp.calls.map((call) => call.name),
    ["list_promocodes", "list_promocodes"],
  );
  assert.equal(mcp.writeCalls.length, 0);
});

test("an equivalent promocode command returns the existing code without a duplicate", async () => {
  const mcp = new FakeP1Mcp({
    promocodes: [
      {
        id: "existing-code",
        code: "WELCOME10",
        title: "Первый заказ",
        discount_value: { value: "10.00", type: "PERCENT" },
        minimum_order_amount: "0.00",
        status: "ACTIVE",
        type: "ORDER",
        usage_count: 0,
        max_usage: 100,
        one_time_use: false,
        first_order_only: false,
        show_in_pdp: false,
        promocode_dates: {
          start_date: "2026-07-31T21:00:00.000Z",
          end_date: "2026-08-31T20:59:00.000Z",
        },
      },
    ],
  });
  const result = await runPromoLauncherScenario({
    request:
      "Запусти промокод WELCOME10 «Первый заказ» 10% на заказ " +
      "с 1 августа 2026 00:00 до 31 августа 2026 23:59 по Москве, лимит 100",
    now: NOW,
    mcp,
  });

  assert.equal(result.kind, "completed");
  assert.equal(result.promotionId, "existing-code");
  assert.match(result.report, /дубль не создан/u);
  assert.equal(mcp.writeCalls.length, 0);
});

test("a promocode create timeout is never retried", async () => {
  const timeout = new Error("fetch failed after timeout");
  timeout.name = "TimeoutError";
  const mcp = new FakeP1Mcp({ writeErrors: { create_promocode: timeout } });
  const result = await runPromoLauncherScenario({
    request:
      "Запусти промокод WELCOME10 «Первый заказ» 10% на заказ " +
      "с 1 августа 2026 00:00 до 31 августа 2026 23:59 по Москве, без лимита",
    now: NOW,
    mcp,
  });

  assert.equal(result.kind, "ambiguous");
  assert.match(result.report, /результат неизвестен/u);
  assert.equal(mcp.calls.filter((call) => call.name === "create_promocode").length, 1);
  assert.equal(mcp.calls.filter((call) => call.name === "update_promocode").length, 0);
});
