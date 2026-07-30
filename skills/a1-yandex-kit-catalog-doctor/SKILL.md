---
name: a1-yandex-kit-catalog-doctor
description: "Run a complete read-only audit of a Yandex KIT catalog for sales blockers, structural defects, risks and recommendations. Use for Russian requests such as «Проверь каталог», «Проведи глубокий аудит каталога», «Почему товары не продаются?», «Проверь группировку, карточки, медиа или коллекции» and requests to verify catalog health or coverage. Use a1-yandex-kit-operator instead for a fast current store signal."
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
- `list_collections` and `get_collection`;
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
3. Read every active category page with
   `status: ["ACTIVE"], page: <N>, per_page: 100`. For every returned
   `Product.category_ids` value absent from that set, call `get_category`: retain a failed
   lookup as a broken/stale reference and an `ARCHIVED` result as a point-in-time archive
   transition. The API omits archived bindings from `Product.category_ids`; when that
   array is empty, report no active category but do not claim that no archived binding
   exists.
4. Read every active warehouse page with
   `status: ["ACTIVE"], page: <N>, per_page: 100`. For every warehouse ID
   used by a checked variant but absent from that set, call `get_warehouse`: include an
   archived used warehouse and retain a failed lookup as a broken reference.
5. Treat «целиком» / “complete catalog” as the complete active-catalog scope above.
   Include archived variants/categories/warehouses beyond referenced entities only when
   the owner explicitly says «включая архив» or otherwise asks for an archive audit.
6. Continue independent collection reads after one collection fails. Record the tool,
   page, received count, expected count when known and the error. Never describe coverage
   as complete after an interruption.
7. The list responses contain the full OpenAPI `Product` and `Variant` objects, including
   `Product.settings` and `Variant.characteristics` / `media`. If a returned object lacks
   one of those required projections, call `get_product` or `get_variant`; do not treat an
   absent projection as an empty value.
8. Read characteristics with `kit_request`:
   `operation_id: GetCharacteristics`,
   `query: {status: ["ACTIVE", "ARCHIVED"], page: <N>, per_page: 100}`.
   On interrupted pagination, detail-read every referenced definition absent from the
   received pages with `GetCharacteristicById` and `path_params: {id: <id>}`. A 404
   confirms a broken reference; another read failure is missing evidence and a risk.
9. Read collections with
   `list_collections(status: ["ACTIVE"], page: <N>, per_page: 100)`. For each one,
   paginate `GetVariantsByCollectionId` with
   `path_params: {collection_id: <id>}` and
   `query: {page: <N>, per_page: 100}`. If a returned variant ID is outside the
   PUBLISHED/HIDDEN list, call `get_variant`: an ARCHIVED result is an archive risk, 404
   is a broken relation and another failure is missing evidence.
10. Only when the owner asks, expand the structural scope. A general request to check
   «мерчандайзинг» means all four scopes below; a narrower request means only the named
   scopes:
   - dynamic filters: inspect `Collection.dynamic_filter`;
   - badge bindings: paginate `GetBadges` with
     `query: {page: <N>, per_page: 100}`. For `SELECTED_VARIANTS`, paginate
     `GetBadgeVariantIDs` with `path_params: {badge_id: <id>}`. For
     `SELECTED_CATEGORIES_COLLECTIONS`, paginate both `GetBadgeCategoryIDs` and
     `GetBadgeCollectionIDs` with the same path parameter. Every badge-binding list also
     uses `query: {page: <N>, per_page: 100}`;
   - context collections: paginate `GetContextCollections` with
     `query: {page: <N>, per_page: 100}`;
   - similar cards: paginate `GetSimilarProductCardIDs` for every checked card with
     `path_params: {product_card_id: <id>}` and
     `query: {page: <N>, per_page: 100}`.
   A dynamic-filter audit also reads `GetBadges` because `badge_slugs` cannot be validated
   without it.
   Absence of any optional merchandising entity is not a defect.
11. Every operation above uses the same termination rule: continue until received count
   reaches `total_count`; if no total is returned, continue until an empty page. Record
   partial coverage and the exact operation/page after any interruption.

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

## Structural rules

### Grouping and characteristics

- Use only `Product.settings.grouping_characteristic_ids` and
  `Variant.characteristics`. Never derive a characteristic or its value from the product
  name unless the owner gives an explicit rule that authorizes that derivation.
- Read splitting IDs from `Product.settings.splitting_characteristic_ids`.
- Normalize grouping values by trimming surrounding whitespace, dropping empty values,
  sorting multi-values inside one characteristic, and preserving case. Compare only
  complete combinations; separately report every missing grouping value.
- Flag a checked variant missing a value for any grouping characteristic.
- Compare complete grouping-value combinations inside one product and flag duplicates.
  Flag a grouping characteristic that has only one populated value across several
  variants because it does not separate them.
- Flag splitting characteristic IDs that are not also grouping characteristic IDs.
- Flag every characteristic reference absent from the full active-and-archived
  characteristic read. Flag an active product that groups by an archived characteristic.

### Card completeness and media

- An explicit owner rule such as `Обязательные поля владельца: бренд, описание` makes
  those fields required; a missing value is a blocker for a published SKU and a risk for
  a hidden SKU.
- A blank API-required display field such as `name` or `slug` is an incompleteness risk.
  An explicitly empty `brand` or `description` that the owner did not make required is
  only an optional recommendation. An omitted optional field is not an API error.
- For each media item, require `image_id` for `IMAGE` and `video_id` for `VIDEO`; `OTHER`
  has no such identifier requirement. Flag
  duplicate `(type, id)` pairs, duplicate display sequences and a usable image set with
  no image at `display_sequence: 1`.
- `display_sequence` is required and numeric in the response schema. Compare the returned
  numeric positions; do not turn omitted projections into repeated `null` positions.
- Never choose a replacement image, invent a media source or infer an identifier.

### Collections and requested merchandising

- Flag an active collection with `cards_count: 0`, an active collection with
  `hidden_cards_count > 0`, and collection variant relations that do not resolve in the
  checked variant scope.
- On an explicit dynamic-filter request, validate category slugs, characteristic slugs
  and badge slugs against the entities actually read.
- On an explicit badge request, validate the relation kind required by `binding_mode`
  and report unresolved variant/category/collection IDs.
- On an explicit context-collection request, validate characteristic conditions against
  the characteristic slugs actually read.
- On an explicit similar-card request, validate returned card IDs against checked
  `product_card_id` values.
- No collection, badge, context collection or similar-card relation is required merely
  because the API supports it. Report only a broken fact in the requested scope.

## Classification

- **Блокер**: an observed fact prevents or can directly prevent a published SKU from
  being sold, priced, found through an active category, stocked or displayed.
- **Риск**: the catalog is usable now but has an inconsistent relation, invalid reserve,
  discount anomaly, duplicate navigation identity, hidden-SKU defect or archive hazard.
- **Рекомендация**: the next read/check or owner decision needed. Never put an invented
  price, stock, category, image or deletion into a recommendation.

When evidence is insufficient, prefer a risk or a coverage limitation over a blocker.

Structural severity is deterministic:

- missing grouping value, archived grouping characteristic or confirmed broken
  characteristic reference: blocker for a PUBLISHED SKU/product, risk for HIDDEN;
- duplicate grouping combination, grouping that does not separate variants, invalid
  splitting subset, duplicate media/order, no main image, empty active collection,
  hidden card, archived collection relation or broken optional relation: risk;
- an IMAGE/VIDEO without its required identifier: risk when another usable image remains;
  if no usable image remains, the existing missing-image rule determines blocker/risk by
  SKU status;
- missing owner-required field: blocker for PUBLISHED, risk for HIDDEN;
- empty API-required `name` / `slug`: risk;
- empty non-required `brand` / `description`: optional recommendation only;
- an unread definition/relation after fallback: risk plus incomplete coverage, never a
  confirmed blocker.

`Variant.status` is the OpenAPI enum `PUBLISHED | HIDDEN | ARCHIVED`; no fourth status is
part of this audit contract.

## Report

Use this structure:

```text
Глубокий аудит каталога

Покрытие: продукты <checked>/<expected>, варианты <checked>/<expected>,
категории <checked>/<expected>, склады <checked>/<expected>.
Страниц: ...
Структурное покрытие: характеристики <checked>/<expected>,
коллекции <checked>/<expected>[, requested optional scopes].
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
MCP and tracer. Its tests cover multi-page and interrupted audits, grouping and media
defects, collection relations, completeness levels, a healthy catalog and owner-requested
merchandising relations. Validate observable tool calls, arguments, coverage,
classification and the absence of writes rather than exact prose.
