---
name: a1-yandex-kit-catalog-doctor
description: "Audit and exactly repair a Yandex KIT catalog. Use for Russian requests such as «Проверь каталог», «Проведи глубокий аудит», «Проверь группировку, карточки, медиа или коллекции», «Поставь цену 4 990 для SKU-42», «Исправь остатки по этому файлу» and exact single or bulk catalog fixes. Audits are read-only; writes require an explicit command with an exact target, operation and owner value or named authoritative source. Use a1-yandex-kit-operator instead for a fast current store signal."
---

# A1 Yandex KIT Catalog Doctor

Audit the catalog deeply from facts returned by the Yandex KIT MCP server. Read every
page, state exact coverage, separate confirmed blockers from risks and recommendations,
and never write or invent a corrective business value.

## Mode boundary

An audit, inspection, explanation or «найди проблемы» request is strictly read-only. Use:

- `list_products` and `get_product`;
- `list_variants` and `get_variant`;
- `list_categories` and `get_category`;
- `list_warehouses` and `get_warehouse`;
- `list_collections` and `get_collection`;
- read-only `kit_request` operations when a relationship cannot be inspected through a
  curated read tool.

Never call create, update, archive, unarchive, delete, upload or action tools during an
audit. A request to fix is a separate exact-write mode described below; do not silently
turn audit findings or recommendations into mutations.

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
   lookup as missing evidence and a risk unless it is a confirmed 404; only a confirmed
   404 is a broken/stale reference. Treat an `ARCHIVED` result as a point-in-time archive
   transition. The API omits archived bindings from `Product.category_ids`; when that
   array is empty, report no active category but do not claim that no archived binding
   exists.
4. Read every active warehouse page with
   `status: ["ACTIVE"], page: <N>, per_page: 100`. For every warehouse ID
   used by a checked variant but absent from that set, call `get_warehouse`: include an
   archived used warehouse; only a confirmed 404 proves a broken reference.
   Timeout/network or another unreadable detail is incomplete coverage and a risk.
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
- Flag a stock that references a confirmed-missing or `ARCHIVED` warehouse. An
  unreadable warehouse lookup is a risk plus incomplete coverage, not a confirmed
  blocker. Do not invent a warehouse or quantity.
- Flag no usable `IMAGE` (`type: IMAGE` with an `image_id`).
- Compare checked variants by normalized exact `slug` and exact `name`; report duplicate
  groups with every ID/SKU.
- Flag a missing `product_id` target and an absent `product_card_id`. Do not infer a
  product/card relation from the variant name.

For every product used by those variants:

- Flag no active category and confirmed-missing category IDs. An unreadable category
  lookup is a risk plus incomplete coverage, not a confirmed blocker. State that the
  read-only API cannot distinguish “no category bindings” from “only archived
  bindings”, because both produce an empty `Product.category_ids`.
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

## Exact fix mode

An explicit write command is authorization for that exact mutation. Do not ask for an
extra confirmation, diff, backup, snapshot or rollback. Authorization does not broaden
the target, operation or value.

### Accepted value sources

A business value is writable only when it comes from:

1. the owner's command, with an exact object and value;
2. an owner-named authoritative source such as a specific ERP/WMS export, approved
   spreadsheet or exact ID mapping, where target-to-value mapping is deterministic;
3. the current API object only to preserve untouched fields and verify preconditions.

Audit recommendations, product names, neighboring SKUs, averages, model inference,
industry conventions and “what looks right” are never value sources. Never invent a
price, quantity, category, characteristic value, image/file ID, grouping rule, badge,
collection relation or deletion target.

If a field lacks a source, ask one grouped concrete question for that field and source.
Example: «Для остатков нужен источник правильных количеств: какой WMS/ERP-файл
использовать и какие колонки содержат SKU, warehouse_id и quantity?» Do not call any
write tool first.

«Исправь всё» means:

- execute only objects whose exact action and correct value are already determined;
- group every remaining gap by field and required source;
- never propagate one known value to objects whose values remain unknown.

### Per-object write protocol

For every object, including every item in a bulk request:

1. Resolve exactly one target. Use exact ID when supplied; for SKU/code search, reject
   zero or multiple exact matches.
2. Read the exact current object with its detail tool. Check status and operation
   preconditions.
3. Build one minimal mutation. When an API field replaces an array or object, copy the
   current value and change only the owner-selected element.
4. Call exactly one write operation. POST/PATCH/PUT/DELETE are not retried by the client;
   never issue another mutation after timeout, abort or network failure.
5. Re-read the same object. For permanent deletion, a confirmed not-found is the
   successful verification state.
6. Classify the object:
   - **Исправлено** only when the re-read matches;
   - **Не исправлено** for a confirmed precondition/validation/local API failure;
   - **Неоднозначно** for timeout/network failure or mismatching/unreadable verification:
     say «результат неизвестен, нужна проверка».

A successful mutation response without a matching re-read is not success.
Timeout/network/5xx classification takes priority over the verification result: even if
the re-read happens to match afterward, report **Неоднозначно** because the mutation
call did not produce a reliable acknowledgement. Never retry it.

### Whole-value preservation

These fields replace their whole collection and must be reconstructed from the detail
read before changing one element:

- `Variant.stocks`: preserve every other warehouse and each untouched `reserved`;
- `Variant.media`: preserve every other IMAGE/VIDEO/OTHER and display sequence;
- `Variant.characteristics`: preserve every other characteristic and multi-value;
- `Product.category_ids`: preserve every category except the exact requested
  add/remove/replace target;
- `Product.settings`: preserve both grouping and splitting arrays while changing one ID;
- static collection cards and badge/context/similar relations: read current relation IDs,
  apply the exact delta and preserve the rest when the operation replaces the set.

Never treat a list response missing a required projection as an empty array; detail-read
the object first.

`Product.category_ids` exposes only active bindings. Because the API cannot enumerate
hidden archived bindings, the detail response alone can never prove that the returned
array is complete. For every exact add/remove/replace of product category bindings,
require an owner-named authoritative complete category-ID set that includes archived
bindings. Without it, report that preservation cannot be proven and leave the product
unchanged.

### Operation distinctions

- Price: `get_variant` → `update_variant` with only
  `{pricing: {price: <owner value>}}` (and exact manual discount only when stated) →
  `get_variant`. `UpdateVariant` uses `application/merge-patch+json`, so omitted
  `pricing` members are preserved recursively; `promotion_price` and `final_price` are
  calculated response fields and are not accepted in `VariantPricingRequest`.
- One stock/media/characteristic change: `get_variant` → `update_variant` with the full
  preserved target array → `get_variant`.
- Categories or grouping settings: `get_product` → `update_product` with the full
  preserved `category_ids` or `settings` value → `get_product`.
- Category metadata/state:
  `GetCategoryById(path_params: {id})` → exactly one of
  `UpdateCategory(path_params: {id}, body: <only exact changed merge-patch fields>)`,
  `ArchiveCategory(path_params: {id}, query: {archive_variants: <owner choice>})`
  or `UnarchiveCategory(path_params: {id})` → `GetCategoryById`. Never infer
  `archive_variants: true`; if dependent active variants make that choice material and
  the owner did not state it, leave the category unchanged and ask. To prove that there
  are no dependent active variants, call
  `GetProducts(query: {page: <N>, per_page: 100})` from page 1 through the reported
  `total_count`, select products whose active `category_ids` contain the target
  category, then call
  `GetVariants(query: {page: <N>, per_page: 100, product_id,
  status: ["PUBLISHED", "HIDDEN"]})` through each reported `total_count`. Only when every
  required page succeeds and every variant result is empty may an unstated
  `archive_variants` be handled by omitting `query` and using the documented API default
  `false`; incomplete coverage is not proof and requires the owner's choice.
- Characteristic metadata:
  `GetCharacteristicById(path_params: {id})` → exactly one of
  `UpdateCharacteristic(path_params: {id}, body: <only exact changed merge-patch fields>)`,
  `ArchiveCharacteristic(path_params: {id})` or
  `UnarchiveCharacteristic(path_params: {id})` → `GetCharacteristicById`.
  `UpdateCharacteristic` is `application/merge-patch+json`; do not send untouched
  metadata fields.
- Collections: `get_collection` before `update_collection`, `manage_collection_cards`
  or exact `delete_collection`; re-read afterward. A confirmed not-found verifies exact
  deletion.
- Badge membership: read all pages with exactly one operation matching `binding_mode` —
  `GetBadgeVariantIDs`, `GetBadgeCategoryIDs` or `GetBadgeCollectionIDs`, each with
  `path_params: {badge_id}`. Apply the exact delta with
  `AddBadgeObjects` or `RemoveBadgeObjects`, `path_params: {badge_id}`, and a body
  containing only the applicable `product_variant_ids`, `category_ids` or
  `collection_ids`; then re-read all pages with the same read operation.
- Similar cards: read all pages with
  `GetSimilarProductCardIDs(path_params: {product_card_id})`; apply the exact delta with
  `AddSimilarProductCards` or `DeleteSimilarProductCards`, the same path params and
  `body: {similar_card_ids: [...]}`; then re-read all pages. Validate the request against
  the current operation schema rather than inventing a client-side item limit.
- Context collections:
  `GetContextCollectionById(path_params: {id})` → one
  `UpdateContextCollection(path_params: {id}, body: <only exact changed fields>)` →
  `GetContextCollectionById`. If changing `conditions`, preserve the complete conditions
  array from the detail read. Use `DeleteContextCollection` only for an exact delete
  command and verify not-found.
- Archiving, unarchiving, permanent deletion and ordinary update are different actions.
  Do not substitute one for another. Permanent SKU deletion uses
  `kit_request(operation_id: DeleteVariant, path_params: {id})`, only after an exact
  permanent-delete verb and a detail read confirming `ARCHIVED`. The API has no permanent
  category-delete operation; do not promise one.

An image addition requires an exact existing `image_id` or a separately authorized
upload source. Treat file upload and variant linking as two explicit write objects, each
with its own verification; if only linking was authorized, require an existing
`image_id`. Do not choose a replacement image or invent a file source.

### Bulk execution and report

Split resolved targets into local chunks of at most 100 while still performing the
per-object protocol. Send mutations sequentially through the MCP client; its configured
token bucket (default 3 requests/second) enforces request rate. Continue after a local
failure or ambiguous item and retain every outcome.

Report exact counts and IDs:

```text
Исправлено (<count>)
- <object ID/SKU>: <verified result>.

Не исправлено (<count>)
- <object ID/SKU>: <confirmed reason>.

Неоднозначно (<count>)
- <object ID/SKU or field group>: <reason / missing source>.
```

For missing inputs, group unresolved objects by field and required source rather than
asking one question per object.

## Scenario evaluation contract

`packages/mcp/src/scenarios/catalog-doctor-skill-scenario.ts` contains a deterministic
reference model, fake MCP and tracer; it does not execute this Markdown skill through an
LLM host. Its tests cover multi-page and interrupted audits, unread reference fallbacks,
grouping and media defects, collection relations, completeness levels, a healthy catalog
and owner-requested merchandising relations. Validate observable tool calls, arguments,
coverage, classification and the absence of writes rather than exact prose.

`packages/mcp/src/scenarios/catalog-doctor-skill-fix-scenario.ts` covers exact-write behavior.
Its tests prove exact price read/write/re-read, a grouped missing-stock-source question
with zero writes, preservation of sibling stocks and media, permanent deletion with an
exact verb, complete batch outcomes, detail-read array preservation, and ambiguous
timeout/5xx results without a second mutation. Run the manual real-skill acceptance cases
in `docs/CATALOG-DOCTOR-SKILL-VERIFICATION.md` before claiming end-to-end host
conformance.
