---
name: a1-yandex-kit-catalog-doctor
description: "Run a complete read-only audit of a Yandex KIT catalog for sales blockers, risks and recommendations. Use for Russian requests such as «Проверь каталог», «Проведи глубокий аудит каталога», «Почему товары не продаются?», «Найди проблемы с ценами, остатками, категориями или изображениями» and requests to verify catalog health or coverage. Use a1-yandex-kit-operator instead for a fast current store signal."
---

# A1 Yandex KIT Catalog Doctor

Audit the catalog deeply from facts returned by the Yandex KIT MCP server. Read every
page, state exact coverage, separate confirmed blockers from risks and recommendations,
and never write or invent a corrective business value.

## Read-only boundary

Use only:

- `list_products` and `get_product`;
- `list_variants` and `get_variant`;
- `list_categories` and `get_category`;
- `list_warehouses` and `get_warehouse`;
- read-only `kit_request` operations when a relationship cannot be inspected through a
  curated read tool.

Never call create, update, archive, unarchive, delete, upload or action tools. A request
to fix findings belongs to the explicit-write workflow added in the later catalog-doctor
slice; do not silently turn an audit into a mutation.

## Coverage workflow

1. Read variants with `status: ["PUBLISHED", "HIDDEN"]`, `page: 1`,
   `per_page: 100`. Increment `page` explicitly until the received count reaches
   `total_count`. Do not use `all: true`: its convenience cap can hide entities.
2. Read every product page with `page` and `per_page: 100`. If the response has no total
   count, continue until an empty page. Count the non-empty entities actually received.
   After an interrupted product pagination, call `get_product` for every checked
   variant's `product_id` that is absent from the received pages. A successful detail
   read restores that relation; a confirmed 404 is a broken relation; timeout/network or
   another unreadable detail remains missing evidence and a risk, not a blocker.
3. Read every active category page with `status: ["ACTIVE"]`. For every returned
   `Product.category_ids` value absent from that set, call `get_category`: retain a failed
   lookup as a broken/stale reference and an `ARCHIVED` result as a point-in-time archive
   transition. The API omits archived bindings from `Product.category_ids`; when that
   array is empty, report no active category but do not claim that no archived binding
   exists.
4. Read every active warehouse page with `status: ["ACTIVE"]`. For every warehouse ID
   used by a checked variant but absent from that set, call `get_warehouse`: include an
   archived used warehouse and retain a failed lookup as a broken reference.
5. Treat «целиком» / “complete catalog” as the complete active-catalog scope above.
   Include archived variants/categories/warehouses beyond referenced entities only when
   the owner explicitly says «включая архив» or otherwise asks for an archive audit.
6. Continue independent collection reads after one collection fails. Record the tool,
   page, received count, expected count when known and the error. Never describe coverage
   as complete after an interruption.

## Audit rules

For every checked `PUBLISHED` or `HIDDEN` variant:

- Flag an absent, unparsable or non-positive `pricing.price`.
- Flag an absent, unparsable or non-positive `pricing.final_price`.
- Flag `manual_discount_price > price`. State the observed values; do not calculate a
  replacement price.
- Sum `quantity - reserved` across stocks and flag a zero or negative available balance.
- Flag each stock where `reserved > quantity`.
- Flag a stock that references a missing or `ARCHIVED` warehouse. Do not invent a
  warehouse or quantity.
- Flag no usable `IMAGE` (`type: IMAGE` with an `image_id`).
- Compare checked variants by normalized exact `slug` and exact `name`; report duplicate
  groups with every ID/SKU.
- Flag a missing `product_id` target and an absent `product_card_id`. Do not infer a
  product/card relation from the variant name.

For every product used by those variants:

- Flag no active category and category IDs that cannot be read. State that the read-only
  API cannot distinguish “no category bindings” from “only archived bindings”, because
  both produce an empty `Product.category_ids`.
- Compare active categories by normalized exact `slug` and exact `title`; report
  duplicate groups with every ID.
- Treat a product with one active category as an archive risk: archiving that category
  can remove the only observed active path. Treat every used archived warehouse as a
  risk or blocker according to the variant status.

Do not label an omitted optional field as an API error. Report only the consequence tied
to the checked rule. A missing optional manual discount, category cover, SEO field or
warehouse metadata is not itself a defect in this slice.

## Classification

- **Блокер**: an observed fact prevents or can directly prevent a published SKU from
  being sold, priced, found through an active category, stocked or displayed.
- **Риск**: the catalog is usable now but has an inconsistent relation, invalid reserve,
  discount anomaly, duplicate navigation identity, hidden-SKU defect or archive hazard.
- **Рекомендация**: the next read/check or owner decision needed. Never put an invented
  price, stock, category, image or deletion into a recommendation.

When evidence is insufficient, prefer a risk or a coverage limitation over a blocker.

## Report

Use this structure:

```text
Глубокий аудит каталога

Покрытие: продукты <checked>/<expected>, варианты <checked>/<expected>,
категории <checked>/<expected>, склады <checked>/<expected>.
Страниц: ...
Покрытие полное ... | Покрытие неполное: <tool/page/error>.

Блокеры (<count>)
- <object ID/SKU>: <observed fact>.

Риски (<count>)
- <object ID/SKU>: <observed fact>.

Рекомендации (<count>)
- <next evidence or owner decision>.
```

Say the catalog is healthy only when all required reads completed and there are no
blockers or risks under the checked rules. Otherwise state that the conclusion is limited
to read data. Close by stating that the audit called no writes.

## Scenario evaluation contract

`packages/mcp/src/scenarios/catalog-doctor-scenario.ts` contains the deterministic fake
MCP and tracer. Its tests cover a multi-page catalog, a healthy catalog and interrupted
pagination, plus an explicit archive audit. Validate observable tool calls, arguments,
coverage, classification and the absence of writes rather than exact prose.
