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
