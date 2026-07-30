---
name: a1-yandex-kit-promo-launcher
description: "Use for natural-language creation and lifecycle management of Yandex KIT automatic discounts, promocodes and gifts: «Запусти скидку», «Создай промокод», «Добавь подарок», «Продли акцию», «Останови промо». Model-invoked; exact write commands are authorization, while incomplete business conditions require one grouped question and no write."
metadata:
  author: ztemerbekov
  version: "0.1.0"
---

# A1 Yandex KIT Promo Launcher

Launch and manage promotions without inventing a discount, scope, duration, limit or
activation state. This scenario skill orchestrates `a1-yandex-kit-marketing`, the
catalog skills and the `a1-yandex-kit` MCP server; use those skills for the exact API
contracts instead of copying the API reference here.

Requires the `a1-yandex-kit` MCP server and Node.js 20 or newer.

## Intent and authorization

- Read-only requests such as «покажи акции», «проверь промо» and «какие скидки активны»
  never call write tools.
- A precise imperative such as «Запусти скидку …» authorizes the whole unambiguous
  create → bind → activate → verify sequence. Do not ask for a second confirmation.
- «Запусти акцию 15%» is not precise: ask one grouped question for the promotion
  mechanism, scope, duration and desired status, then stop without a write.
- «Придумай акцию» asks for alternatives only. Do not create anything until the owner
  chooses exact business conditions.

For every write request, read and apply
[`references/exact-write-protocol.md`](references/exact-write-protocol.md) completely
before resolving a target or calling a tool.

## Automatic-discount launch

Require all of these owner decisions before writing:

1. a title and a positive value with type `PERCENT` or `VALUE`; percent must not exceed
   100;
2. a scope: all variants, exact variant IDs/SKUs, exact category IDs or exact collection
   IDs;
3. `start_date`, plus `end_date` or explicit «бессрочно»;
4. the conversation time zone for natural/relative dates;
5. the desired `ACTIVE` or `INACTIVE` state.

Convert local dates to UTC and require start to be earlier than end. Before creation,
read every selected variant, category and collection. Missing, archived or inactive
targets are reported and omitted from writes; if the requested exact scope is therefore
not executable, create nothing.

Read every existing discount status before creation. An exact equivalent with the same
value, dates, status and factual bindings is a duplicate: return its ID and do not
create another. A possible overlap with another active promotion is a risk, not a
blocker unless the owner supplied a compatibility rule.

Create `ALL_VARIANTS` directly. For selected variants create `SELECTED_VARIANTS`, then
attach `product_variant_ids`. For categories or collections, create
`SELECTED_VARIANTS`, then attach category/collection objects so KIT changes the factual
mode to `SELECTED_CATEGORIES_COLLECTIONS`. Never mix variants with
categories/collections in one object request.

Call each required write at most once. Afterward read the exact discount and the
relevant `GetDiscountVariantIDs`, `GetDiscountCategoryIDs` or
`GetDiscountCollectionIDs` relation. Report the factual ID, status, value, UTC dates,
binding mode, bound-object count, overlap risks and any partial or ambiguous result.

## Promocode launch

Treat `ORDER` and `PRODUCTS` as different mechanisms. Before creating either, require:

- exact code, title, positive `PERCENT`/`VALUE`, start, end or explicit «бессрочно»,
  and the time zone for natural dates;
- exact type `ORDER` or `PRODUCTS`;
- an integer usage limit or explicit «без лимита»;
- desired active/inactive state;
- for `PRODUCTS`, an exact scope using the same target checks as discounts.

Optional `minimum_order_amount`, `max_discount_amount`, `first_order_only`,
`one_time_use` and `show_in_pdp` come only from the owner. Where omitted, preserve and
report the documented API defaults (`0.00` and `false`); `show_in_pdp` applies only to
`PRODUCTS`. Never send product bindings for an `ORDER` promocode.

Read both active and inactive promocodes before creation. Compare a matching code
against all material conditions and factual bindings. Return an equivalent existing
promocode without a write. If the same code has different conditions, ask exactly
whether to change the existing promocode or use a new code; do not write until answered.

Create the entity once, attach the validated product scope when applicable, then read
the exact promocode. KIT creates a promocode inactive; when the owner said «запусти»,
perform one `update_promocode` to `ACTIVE` and read it again. Report ID, code, factual
status, type, value, UTC dates, usage and discount limits, all documented boolean
defaults and factual coverage.

## Gift launch

A gift requires an exact title, a positive `min_cart_total`, between 1 and 50 exact
variant IDs, and an active/inactive decision. Read every variant before writing and
reject missing or archived variants. `default_sort` may be `POPULARITY`, `CHEAPEST`,
`EXPENSIVE`, `NEWEST` or `OLDEST`; when omitted, use and report the documented
`POPULARITY` default.

KIT gifts have no action dates. If the owner asks for a dated gift, explain that API
limit and do not pretend to schedule it; ask whether to create it inactive or launch it
now without dates.

Gifts have no dedicated curator tool. Before a gift mutation, use
`get_operation_schema` for the exact operation, validate the body, then call
`kit_request` once. `CreateGift` includes the validated variant IDs and always creates
an `INACTIVE` gift. Read it with `GetGiftById`; for an exact «запусти» command, call
`UpdateGift` to `ACTIVE` once and read it again. Finally read `GetGiftVariants` and
report ID, minimum cart, factual status, default sort and the factual gift-item count.

## Safety boundaries

- Never infer «бессрочно», «без лимита», a time zone, a target or a business value.
- Continue independent batch items after a local failure and report every result.
- Never retry a mutation after timeout, network failure or 5xx. Read the object if
  possible and report an ambiguous result.
- Do not create backups, snapshots, rollback promises or a second permission interface.
