---
name: a1-yandex-kit-launch-check
description: "Use for a Yandex KIT store launch-readiness review: «Можно запускать?», «Проверь готовность», «Что мешает открытию?», «Можно вести покупателей?». Model-invoked; the default workflow is fully read-only and distinguishes proven blockers, risks and unverified checkout links."
metadata:
  author: Zinnur Temerbekov
  version: "1.3.0"
---

# A1 Yandex KIT Launch Check

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
- never return `READY` from the API-only workflow;
- `READY` / «готов» only when API coverage is complete, the public storefront is
  factually reachable and sufficient checkout evidence is present.

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

## Public storefront and checkout evidence

When the host exposes a browser or HTTP capability, use it through a small web-adapter
boundary and request the factual `b2c_url`. Follow the adapter's redirect result and
record the HTTP outcome. For `AVAILABLE`, require 2xx/3xx from the entry point and at
least one same-origin public page discovered from factual storefront evidence. Check
up to three discovered pages. A failed request or 4xx/5xx is a blocker; a reachable
entry point with no discoverable public page remains «проверено не полностью» and caps
the result at `CONDITIONALLY_READY`. If no web tool exists, say «витрина не проверена».
Do not claim that the URL's API presence proves availability, and do not invent
undiscoverable product-page URLs.

Checkout evidence has two supported sources:

1. For an owner-provided test order ID, call `get_order` and report the factual order,
   payment and delivery statuses. Treat it as sufficient only when the order has moved
   past initial confirmation, payment is paid and a delivery status is present.
2. For an explicit owner statement that a manual checkout completed, retain the exact
   statement as «предоставлено владельцем» and say that it is not an API verification.

Never create, confirm or pay a test order. KIT API still does not expose payment and
delivery settings; keep that limitation visible even when checkout evidence is
sufficient. Show separate sections for automatic API checks, the web check, checkout
evidence and remaining unknowns.

## Exact fixes after a check

The default launch check remains read-only. A finding, recommendation or «покажи»
request never authorizes a mutation. For an explicit fix command, read and apply
[`references/exact-write-protocol.md`](references/exact-write-protocol.md) completely,
then route the exact object to the existing mechanism:

- operator/catalog-doctor semantics for an exact price, stock, media, category or
  characteristic change;
- promo-launcher lifecycle semantics for an exact discount, promocode or gift change.

Before every write, read the exact object; call the mutation once; read the object and
affected relation again. When changing one array element, send the complete preserved
array and verify it afterward. Never invent a missing price, quantity, category,
characteristic, image, promotion term or webhook requirement.

«Исправь всё» means only: apply findings whose correct action and value are already
unambiguous in the retained report or owner-provided source. Group every unknown
decision into one concrete question and perform no write for those fields. Continue
independent known items after a local failure and separate successful, failed and
ambiguous IDs.

After all attempted fixes, rerun the affected reads and the full launch check. Payment,
delivery, storefront and checkout gaps remain under «Не проверено» until factual
evidence exists. Retain and pass any already collected web and checkout evidence into
that rerun; a catalog or promotion fix must not erase it. Do not create backups,
snapshots, restore/rollback flows or a second confirmation for an exact command.
