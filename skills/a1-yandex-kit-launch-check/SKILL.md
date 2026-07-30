---
name: a1-yandex-kit-launch-check
description: "Use for a Yandex KIT store launch-readiness review: «Можно запускать?», «Проверь готовность», «Что мешает открытию?», «Можно вести покупателей?». Model-invoked; the default workflow is fully read-only and distinguishes proven blockers, risks and unverified checkout links."
metadata:
  author: ztemerbekov
  version: "0.1.0"
---

# A1 Yandex KIT Launch Check

Check the minimum Critical Chain of Jobs for a first sale without claiming that an API
snapshot proves checkout. This scenario skill orchestrates `a1-yandex-kit-operator`,
`a1-yandex-kit-catalog-doctor`, `a1-yandex-kit-promo-launcher` and the domain skills.
Use those skills for exact API contracts and deeper diagnosis.

Requires the `a1-yandex-kit` MCP server and Node.js 20 or newer.

## Intent and status boundary

Recognise requests by meaning, including «Можно запускать?», «Проверь готовность»,
«Что мешает открытию?» and «Можно вести покупателей?».

The default check is read-only. Never call a create, update, archive, delete, confirm or
other write tool for «проверь», «покажи», «что мешает» or «можно запускать».

Return exactly one machine status with its Russian label:

- `NOT_READY` / «не готов» only for a proven critical blocker;
- `CONDITIONALLY_READY` / «условно готов» when the automatic slice has no blocker but
  a critical link is incomplete or unverified;
- never return `READY` from the API-only workflow in this version: public storefront,
  payment, delivery and checkout evidence are handled by the next workflow.

## API-readiness workflow

1. Read the current store and retain its `b2c_url`. The URL's presence is not proof that
   the storefront opens.
2. Follow every page explicitly (100 per page) for published variants, their products,
   active/archived categories and warehouses, active discounts, active promocodes,
   active gifts and orders. Report entity and page counts. A failed or stopped page
   makes coverage incomplete and forbids a clean conclusion.
3. For every published variant, prove a positive price, available stock
   (`quantity - reserved > 0`) on an active warehouse, an image, a readable parent
   product and at least one active category. Name exact IDs for reserve greater than
   quantity and missing/archived warehouse references. Send deeper structural defects
   to `a1-yandex-kit-catalog-doctor`.
4. Inspect active promotions. Report expired active entities, exhausted promocode
   limits and selected modes with no factual bindings. No promotions at all is valid
   and never blocks launch.
5. Read webhooks. They are a launch requirement only when the owner says external order
   processing is used. If applicability is unknown, put it under «Не проверено».
6. Read the order history. No orders means no checkout evidence; it is not a store
   error. Existing orders are signals, not sufficient proof by themselves.
7. Attempt every independent section even after a local read failure. Produce the
   result only after each source is complete or its exact partial coverage is retained.

## Report

Always include:

- factual coverage with counts, pages and complete/incomplete state;
- `Блокеры`, `Риски`, `Не проверено`, `Рекомендации` and `Следующие действия`;
- the exact objects and facts behind every finding;
- an explicit statement that KIT API does not expose payment/delivery settings and
  does not create or pay a test order.

Empty optional SEO fields are recommendations, not blockers of a first sale. Never turn
an unknown fact into a clean result and never invent a price, category, stock or other
business value.
