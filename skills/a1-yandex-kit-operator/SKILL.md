---
name: a1-yandex-kit-operator
description: "Use for a read-only operational review of a Yandex KIT store: «Как дела в магазине?», «Дай статус по магазину», «Проведи разбор», «Всё ли нормально?», «Что срочного?» or «Что требует внимания?». Treat short «Как дела?» as a store request only when Yandex KIT context is already established."
compatibility: "Requires the a1-yandex-kit MCP server and Node.js >= 20"
metadata:
  author: gistrec
  version: "0.1.0"
---

# A1 Yandex KIT Operator

Give a store owner a grounded, read-only operating report: find current orders that
need attention, state the evidence and consequence, and name the available next action
without inventing a business decision. This is an orchestration skill; use the
`a1-yandex-kit-orders` skill for API contracts and the `a1-yandex-kit` skill for auth,
pagination and error behaviour.

## When to act

Recognise these requests by meaning, not only exact punctuation:

- «Как дела в магазине?», «Дай статус по магазину», «Проведи разбор», «Всё ли нормально?»,
  «Что требует внимания?» — full current status;
- «Что срочного?» — critical findings only;
- a request with «сегодня», «утром», «за день» or «за неделю» — apply that time slice to
  routine findings, while retaining every unresolved current threat.

The short phrase «Как дела?» is ambiguous. Treat it as an operator request only if this
conversation already concerns a Yandex KIT store (for example, the KIT MCP server or a
KIT order was used earlier). Otherwise ask one short question: «О чём речь? Я могу
разобрать магазин Яндекс KIT, если это нужно.» Do not call a tool in that case.

## Read-only boundary

This slice is strictly read-only. Never call `confirm_order`, `cancel_order`,
`kit_request` for a write operation, or any other write tool — even when a finding says
that confirmation or cancellation is an available next action. A request to perform an
operation belongs to the appropriate order-management workflow after the owner states
the exact action.

Do not promise to find «непросмотренные заказы»: the KIT API exposes no read/unread
field. Say this explicitly in the coverage note when relevant.

## Review workflow

1. Determine the current time in UTC. For an explicit period, use it only for ordinary
   new/awaiting orders. Continue to show unresolved delivery, payment, cancellation and
   refund threats regardless of when the order was created.
2. Read **every** order page with `list_orders`, starting at `{ page: 1, per_page: 100 }`
   and incrementing `page` until the number received reaches `total_count`. If a page
   fails, report the exact coverage reached; never say the store or all orders are fine.
3. Inspect the returned facts for every order:
   - `NEW` and `WAIT_FOR_CONFIRMATION`: list them as orders needing attention. A
     `WAIT_FOR_CONFIRMATION` order is critical because the seller has a stated next
     step; a fresh `NEW` order is not automatically critical solely from its status.
   - cancellation/refund statuses (`CANCELLATION_IN_PROGRESS`, `DELIVERY_CANCELLED`,
     `FULL_REFUND`, `PARTIAL_REFUND`): flag the money/fulfilment consequence, without
     guessing the reason.
   - payment: flag `PAYMENT_REFUNDED`, or `PAYMENT_PENDING_OR_UNPAID` when the order is
     already in delivery/finalisation/completion, as a factual status mismatch. Do not
     call a normal pending payment suspicious merely because it is pending.
   - delivery: flag any delivery chunk whose `interval.to` is in the past while
     `delivered_at` is absent and the order is not `DELIVERED`, `CANCELLED` or
     `COMPLETED`.
4. For each flagged order, call `get_order` and `get_order_addons` once to obtain its
   current line items, client, delivery, payment and attached-service facts. If either
   read fails, preserve the error as missing data instead of filling it in.
5. Produce the report from the facts actually read. For «Что срочного?» include only
   `WAIT_FOR_CONFIRMATION`, objectively inconsistent payment, cancellation/refund, and
   overdue delivery findings. For a full report sort findings as: existing order that
   needs action → risk of lost sale → money → reputation.

## Report format

Start with either **«Текущий операционный статус»** or **«Срочный операционный срез»**.
State coverage: orders read, pages read, time slice, and any unavailable detail.

For every finding provide one compact item:

```text
- Заказ #<order_number> (<id>): <observed status, payment/delivery fact and relevant detail>.
  Возможное последствие: <loss of order, money, or reputation — proportional to the fact>.
  Доступное действие: <specific read/check or explicitly requested next operation>.
  Недостающие данные: <only if the API response lacks what is needed>.
```

Close with: «API не содержит признака просмотра заказа, поэтому выводов о
непросмотренных заказах нет.» Do not claim that an order is safe, paid, delivered, or
cancelled beyond the observed API status.

## Scenario evaluation contract

`packages/mcp/src/scenarios/operator-scenario.ts` provides the reusable fake MCP for
this slice. It accepts prepared orders (including payment and delivery facts), supports
pagination, records tool names and arguments, and retains the final report. Its tests
check full review, urgent-only output, a requested period, the contextual «Как дела?»
filter, and the absence of write calls. Compare calls and final state, not an exact
word-for-word report.
