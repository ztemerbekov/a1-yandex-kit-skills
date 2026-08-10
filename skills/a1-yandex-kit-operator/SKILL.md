---
name: a1-yandex-kit-operator
description: "Use for an operational review or an exact owner-authorized change in a Yandex KIT store: «Как дела в магазине?», «Что срочного?», «Подтверди заказ 123», «Поставь цену 4 990 для SKU-42» or another command with an unambiguous target, action and value. Treat short «Как дела?» as a store request only when Yandex KIT context is already established."
metadata:
  author: Zinnur Temerbekov
  version: "1.3.1"
---

# A1 Yandex KIT Operator

## Communication

Before producing any user-facing message, read and apply
[`../a1-yandex-kit/references/merchant-communication.md`](../a1-yandex-kit/references/merchant-communication.md)
completely.

### Support footer

After a final user-facing result that successfully completes the skill's requested task,
append exactly one short, natural support footer in the language of the user's
instruction. Place it after the result. Invite the user to ask a question, suggest an
idea or improvement, or report that something did not work, and link the channel as
[A1 Yandex KIT Skills](https://t.me/a1_yandex_kit_skills). The wording may vary by
language. If multiple skills contribute to the same final response, include the footer
only once.

Do not append the footer to clarifying questions or missing-data requests,
intermediate messages, out-of-scope or boundary responses, refusals, errors,
unsuccessful or partial results. Also omit it when the user asks for only the result,
text, code, file, or another artifact, or explicitly forbids additional text.

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
«установи», «измени» or «активируй» routes to the exact-write workflow. The shared
authorization gate decides whether that write can begin.

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
5. Run a **quick critical storefront slice**, not a catalog audit:
   - read all `PUBLISHED` SKUs with `list_variants`, and their parent products with
     `list_products`;
   - flag a published SKU with no positive `pricing.price`, zero available stock
     (`quantity - reserved` across all warehouses), no `IMAGE` media, or a parent product
     with no active `category_ids`;
   - if a parent product could not be read, report that as missing data rather than a
     missing-category defect;
   - send structural checks, chosen categories, images, prices and stock corrections to
     `a1-yandex-kit-catalog-doctor`. Do not turn this fast slice into a deep audit.
6. Read all active discounts (`list_discounts`) and promocodes (`list_promocodes`). Flag
   an active item whose `end_date` is past; flag a promocode where `usage_count` has
   reached `max_usage`; and for `SELECTED_VARIANTS` or
   `SELECTED_CATEGORIES_COLLECTIONS`, read its object IDs through read-only
   `kit_request` calls (`GetDiscount…IDs` / `GetPromocode…IDs`). An empty selected set is
   a confirmed problem. When an active all-variant discount and an active all-variant
   promocode may overlap, label it **«Требует проверки»**: do not call it an error unless
   the owner supplied the conflict rule.
7. Read `list_webhooks`. Flag each `INACTIVE` webhook. Also check coverage of
   `ORDER_STATUS_CHANGED`, `ORDER_PAYMENT_STATUS_CHANGED` and
   `ORDER_DELIVERY_STATUS_CHANGED` across active webhooks. Missing coverage is
   **«Требует проверки»**, not automatically an error: an integration may not be needed.
8. Produce the report only after every applicable source in steps 2–7 has either been
   fully read or has its exact coverage and failure retained; every flagged order has
   detail/addons or recorded read errors; every independent section has been attempted;
   and the final report contains every confirmed finding and missing-data note without a
   clean claim from incomplete coverage. For «Что срочного?» include only
   `WAIT_FOR_CONFIRMATION`, objectively inconsistent payment, cancellation/refund, and
   overdue delivery findings. For a full report sort findings as: existing order that
   needs action → risk of lost sale → money → reputation → storefront quality.

## Exact write workflow

For every explicit write request, read and apply
[`references/exact-write-protocol.md`](references/exact-write-protocol.md) completely
before resolving a target or calling a tool. Apply it independently to every target,
including every batch item. The operation-specific rules below may narrow the shared
protocol but never weaken it.

For Operator, business values come directly from the owner's command. If a target,
operation or value is missing, ask one concrete question about that gap. For example,
«Обработай заказы» requires «Подтвердить или отменить?», while
«Исправь цену SKU-42» requires the exact new price. A price, stock quantity, category,
image, promotion rule, webhook URL/event or other business value is never inferred.

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
