---
name: a1-yandex-kit-promo-launcher
description: "Launch and manage Yandex KIT promotions. Use when the user asks «Запусти скидку», «Создай промокод» or «Добавь подарок»; wants to inspect promotions («Покажи акции»); or change dates, conditions, bindings or status («Продли акцию», «Останови промо»)."
metadata:
  author: Zinnur Temerbekov
  version: "1.3.1"
---

# A1 Yandex KIT Promo Launcher

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

Launch and manage promotions without inventing a discount, scope, duration, limit or
activation state. This scenario skill orchestrates `a1-yandex-kit-promotions`, the
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
before resolving a target or calling a tool. Treat an existing-promotion change as a
one-stage plan. Treat create, bind and activate as dependent stages when the requested
outcome needs them; run a dependent stage only after the previous stage is verified.

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

Create `ALL_VARIANTS` directly. For a selected scope that must end `ACTIVE`, first
create the discount `INACTIVE` and verify it. For selected variants, then attach
`product_variant_ids`; for categories or collections, attach category/collection
objects so KIT changes the factual mode to `SELECTED_CATEGORIES_COLLECTIONS`. Never mix
variants with categories/collections in one object request. Verify the exact discount
and the relevant `GetDiscountVariantIDs`, `GetDiscountCategoryIDs` or
`GetDiscountCollectionIDs` relation before activating it.

Call each required write at most once and verify it before the next dependent write.
Report the factual ID, status, value, UTC dates, binding mode, bound-object count,
overlap risks and every completed, blocked or skipped stage of a partial result.

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

Create the entity once and read the exact promocode before any dependent write. KIT
creates a promocode inactive. When a product scope applies, attach it once and verify
the exact object relation. Only after creation and binding are confirmed may an exact
«запусти» plan perform one `update_promocode` to `ACTIVE` and read it again. Report ID,
code, factual status, type, value, UTC dates, usage and discount limits, all documented
boolean defaults, factual coverage and every partial stage outcome.

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
an `INACTIVE` gift. Verify it with `GetGiftById` and verify its complete composition
with `GetGiftVariants`. Only then may an exact «запусти» plan call `UpdateGift` to
`ACTIVE` once and read it again. Report ID, minimum cart, factual status, default sort,
the factual gift-item count and every partial stage outcome.

## Existing-promotion lifecycle

For «покажи», «какие активны» and other inspection requests, read active and inactive
discounts, promocodes and gifts, plus archived discounts. Show factual values, dates,
limits, statuses and bindings without a write.

An exact lifecycle command must name the promotion unambiguously. Before each change,
read that exact object; call the required write once; then read the object and affected
bindings again. Send only fields the owner named and preserve every other condition.
For natural dates, require a known time zone and retain the existing start date when
only the end date changes.

- Stop a discount with `update_discount` status `INACTIVE`. Use `discount_action
  archive` only for an explicit archive command and `discount_action unarchive` only
  for explicit restoration from the archive.
- Stop or restart a promocode with `update_promocode` status `INACTIVE` or `ACTIVE`.
  Promocodes have no archive action.
- Stop or restart a gift with `UpdateGift` status `INACTIVE` or `ACTIVE`. Permanently
  call `DeleteGift` only for the exact phrase «удали навсегда»; ordinary «останови»
  never deletes.
- Add or remove discount/promocode variants, categories and collections only inside
  the compatible binding family. Gifts accept variants only, through
  `AddGiftVariants` and `RemoveGiftVariants`. Validate a newly added target first and
  verify the factual relation afterward.

Continue a batch after a local object failure. Separate successful, failed and
ambiguous IDs. Re-check active peers after an activation or material change and report
possible overlap as a risk; an exact owner command remains authorized unless the owner
provided an incompatibility rule.

## Safety boundaries

- Never infer «бессрочно», «без лимита», a time zone, a target or a business value.
- Continue independent batch items after a local failure and report every result.
- Never retry a mutation after timeout, network failure or 5xx. Read the object if
  possible and report an ambiguous result.
- Do not create backups, snapshots, rollback promises or a second permission interface.
