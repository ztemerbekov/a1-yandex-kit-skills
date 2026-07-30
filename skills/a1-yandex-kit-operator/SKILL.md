---
name: a1-yandex-kit-operator
description: "Use for an operational review or an exact owner-authorized change in a Yandex KIT store: «Как дела в магазине?», «Что срочного?», «Подтверди заказ 123», «Поставь цену 4 990 для SKU-42» or another command with an unambiguous target, action and value. Treat short «Как дела?» as a store request only when Yandex KIT context is already established."
metadata:
  author: gistrec
  version: "0.1.0"
---

# A1 Yandex KIT Operator

Give a store owner a grounded operating report and perform only exact changes the owner
has already specified. Find current order, storefront, promotion and integration risks;
state the evidence and consequence; and never invent a business decision or value. This
is an orchestration skill; use the domain skills for API contracts and `a1-yandex-kit`
for auth, pagination, rate limits and error behaviour.

Requires the `a1-yandex-kit` MCP server and Node.js 20 or newer.

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

## Intent and write boundary

Requests such as «проверь», «покажи», «разбери», «найди», «как дела» and «что срочного»
are always read-only. An explicit imperative such as «подтверди», «отмени», «поставь»,
«установи», «измени» or «активируй» authorises exactly the stated write when the target,
operation and every required business value are unambiguous. Do not add another
confirmation, diff, backup, snapshot or rollback.

If the target, operation or value is missing, ask one concrete question about that gap
and call no write tool. For example, «Обработай заказы» requires «Подтвердить или
отменить?», while «Исправь цену SKU-42» requires the exact new price. Never derive a
price, stock quantity, category, image, promotion rule, webhook URL/event or any other
business value from a guess.

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
   needs action → risk of lost sale → money → reputation → storefront quality.
6. Run a **quick critical storefront slice**, not a catalog audit:
   - read all `PUBLISHED` SKUs with `list_variants`, and their parent products with
     `list_products`;
   - flag a published SKU with no positive `pricing.price`, zero available stock
     (`quantity - reserved` across all warehouses), no `IMAGE` media, or a parent product
     with no active `category_ids`;
   - if a parent product could not be read, report that as missing data rather than a
     missing-category defect;
   - send structural checks, chosen categories, images, prices and stock corrections to
     `a1-yandex-kit-catalog-doctor`. Do not turn this fast slice into a deep audit.
7. Read all active discounts (`list_discounts`) and promocodes (`list_promocodes`). Flag
   an active item whose `end_date` is past; flag a promocode where `usage_count` has
   reached `max_usage`; and for `SELECTED_VARIANTS` or
   `SELECTED_CATEGORIES_COLLECTIONS`, read its object IDs through read-only
   `kit_request` calls (`GetDiscount…IDs` / `GetPromocode…IDs`). An empty selected set is
   a confirmed problem. When an active all-variant discount and an active all-variant
   promocode may overlap, label it **«Требует проверки»**: do not call it an error unless
   the owner supplied the conflict rule.
8. Read `list_webhooks`. Flag each `INACTIVE` webhook. Also check coverage of
   `ORDER_STATUS_CHANGED`, `ORDER_PAYMENT_STATUS_CHANGED` and
   `ORDER_DELIVERY_STATUS_CHANGED` across active webhooks. Missing coverage is
   **«Требует проверки»**, not automatically an error: an integration may not be needed.

## Exact write workflow

For every object, including every member of a batch:

1. Resolve one exact object. If a displayed order number, SKU or promotion code matches
   zero or multiple objects, ask for an exact ID and do not write. When the owner
   supplies an ID that itself matches one object, prefer that ID over any coincidentally
   equal displayed number, SKU, title or code. A truncated or failed list read cannot
   prove an alternate key unique: do not write from a displayed number/SKU/title/code
   until the full lookup succeeds. An explicit ID may still proceed through its detail
   read.
2. Read the exact current object with `get_order`, `get_variant`, `get_discount`,
   `get_promocode` or `get_webhook`. Check the relevant precondition against that read.
3. Call exactly one write tool. Client retry safety guarantees that POST/PATCH/PUT/DELETE
   are not automatically retried; never issue a second mutation after timeout, abort or
   network failure.
4. Re-read the same object and compare the requested field or state. A successful tool
   response without a matching re-read is not a verified success.
5. Classify the result as completed, failed or ambiguous. HTTP 408,
   timeout/network/5xx failure, or a failed verification after a possible write, is
   ambiguous: say «результат неизвестен, нужна проверка». Do not label it failed and do
   not retry blindly.

Use these operation-specific rules:

- Orders: `WAIT_FOR_CONFIRMATION` may use `confirm_order`; exact cancellation may use
  `cancel_order`. A reason is optional context, not a prerequisite for cancellation.
  The KIT cancellation endpoint accepts only the order ID, while the MCP tool has an
  optional log-only `reason` argument. If the owner supplied a reason, call
  `cancel_order { id, reason }` so it remains in the MCP tool log, and explicitly say in
  the report that the KIT API does not store it. Without a reason call
  `cancel_order { id }`. A plural exact command may cancel several orders with one shared
  optional reason; keep a separate outcome for every order and continue after a local
  error.
- Price and stock: resolve the exact SKU, call `get_variant`, then `update_variant` with
  only the stated pricing change or with the full preserved `stocks` array when changing
  one warehouse. Re-read and compare the entire expected `stocks` array, including every
  sibling warehouse and untouched `reserved`, not just the changed quantity. Never
  invent a warehouse or quantity.
- Promotions: resolve one exact discount/promocode, read it, update only the explicitly
  stated status/value/limit or exact bindings, then re-read. Do not invent eligibility,
  dates, limits, values or conflict rules.
- Webhooks: read the exact webhook before `validate_webhook`, `update_webhook` or another
  explicit action. «Проверь и активируй вебхук <id>» may call
  `validate_webhook { id, activate: true }`; do not invent a URL or event set.

For a batch, continue after an individual failure, keep calls within the MCP/API rate
limit, retain each object's outcome and never let one ambiguous result trigger a retry.

Do not promise unsupported actions: creating or arbitrarily editing orders, manually
setting arbitrary order/payment/delivery/refund statuses, issuing refunds, or contacting
the client are outside the available KIT API operations.

## Report format

Start with either **«Текущий операционный статус»** or **«Срочный операционный срез»**.
State coverage: orders read, pages read, time slice, and any unavailable detail. Add a
compact summary count for orders, catalog, promotions and webhooks.

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

For a write request, use three explicit sections even when a count is zero:

```text
Выполнено (<count>)
Не выполнено (<count>)
Неоднозначно (<count>)
```

List every target with the requested action, observed result and error/reason where
applicable.

## Scenario evaluation contract

`packages/mcp/src/scenarios/operator-skill-scenario.ts` is a deterministic reference model and
reusable fake MCP for regression tests; it does not execute this Markdown skill through
an LLM host. It accepts prepared orders, SKUs, products, promotions and webhooks;
supports pagination, selected-promotion bindings and prepared write failures; records
tool names and arguments; mutates prepared state; and retains the final report. Its tests
cover read-only reviews, partial reads, exact confirmation/cancellation/price/stock
changes, duplicate targets, batch cancellation, exact promocode
limit/status/binding and discount-value changes, webhook activation, ambiguous commands,
timeouts/5xx and a mismatching verification read. Compare calls and final state, not an
exact word-for-word report. Run the manual real-skill acceptance cases in
`docs/OPERATOR-VERIFICATION.md` before claiming end-to-end host conformance.
