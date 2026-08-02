# Catalog audit protocol

Read this reference completely before every Catalog Doctor audit. Apply it
together with every scope reference selected in `SKILL.md`.

## Contents

- [Coverage workflow](#coverage-workflow)
- [Classification](#classification)
- [Report and completion](#report-and-completion)

## Coverage workflow

An audit is read-only. Use:

- `list_products` and `get_product`;
- `list_variants` and `get_variant`;
- `list_categories` and `get_category`;
- `list_warehouses` and `get_warehouse`;
- `list_collections` and `get_collection`;
- read-only `kit_request` operations when a relationship has no curated read
  tool.

Read the base catalog in this order:

1. Read variants with `status: ["PUBLISHED", "HIDDEN"]`, `page: 1`,
   `per_page: 100`. Increment `page` explicitly until the received count reaches
   `total_count`. Do not use `all: true`: its convenience cap can hide entities.
2. Read every product page with `page` and `per_page: 100`. If the response has
   no total count, continue until an empty page. Count the non-empty entities
   actually received. After interrupted product pagination, call `get_product`
   for every checked variant's `product_id` absent from the received pages. A
   successful detail read restores that relation; a confirmed 404 is a broken
   relation; timeout/network or another unreadable detail is missing evidence
   and a risk, not a blocker.
3. Read every active category page with
   `status: ["ACTIVE"], page: <N>, per_page: 100`. For every returned
   `Product.category_ids` value absent from that set, call `get_category`. A
   failed lookup is missing evidence and a risk unless it is a confirmed 404;
   only a confirmed 404 is a broken/stale reference. Treat an `ARCHIVED` result
   as a point-in-time archive transition. The API omits archived bindings from
   `Product.category_ids`; when that array is empty, report no active category
   without claiming that no archived binding exists.
4. Read every active warehouse page with
   `status: ["ACTIVE"], page: <N>, per_page: 100`. For every warehouse ID used
   by a checked variant but absent from that set, call `get_warehouse`. Include
   an archived used warehouse; only a confirmed 404 proves a broken reference.
   Timeout/network or another unreadable detail is incomplete coverage and a
   risk.
5. Treat «целиком» / “complete catalog” as the complete active-catalog scope
   above. Include archived variants/categories/warehouses beyond referenced
   entities only when the owner explicitly says «включая архив» or otherwise
   asks for an archive audit. Archived categories and warehouses are
   enumerable with `status: ["ARCHIVED"]`. Archived variants are NOT: the API
   silently strips `ARCHIVED` from the `GetVariants` status filter (known
   defect, issue #54), and `list_variants`/`kit_request` fail with
   `STATUS_FILTER_IGNORED` or `ARCHIVE_READ_UNSUPPORTED` instead of returning
   the default listing. Treat those failures — and any list response
   containing statuses outside the requested filter — as an unreadable
   archive: report the variant archive as not enumerable via the API
   (unsupported), never as empty and never as proof that no archived variant
   exists. Archived variants can be read only by ID with `get_variant`.
6. Continue every independent scope after another scope fails. Record the tool,
   page, received count, expected count when known and the error. Every
   paginated operation uses the same termination rule: continue until the
   received count reaches `total_count`; if no total is returned, continue until
   an empty page.

Coverage is complete only when every applicable read reaches its termination
rule. After an interruption, preserve exact partial coverage and never describe
the whole catalog as healthy.

## Classification

- **Блокер**: an observed fact prevents or can directly prevent a published SKU
  from being sold, priced, found through an active category, stocked or
  displayed.
- **Риск**: the catalog is usable now but has an inconsistent relation, invalid
  reserve, discount anomaly, duplicate navigation identity, hidden-SKU defect
  or archive hazard.
- **Рекомендация**: the next read/check or owner decision needed. An invented
  price, stock, category, image or deletion is never a recommendation.

When evidence is insufficient, classify it as a risk or coverage limitation
rather than a blocker.

`Variant.status` is the OpenAPI enum `PUBLISHED | HIDDEN | ARCHIVED`; no fourth
status is part of this audit contract.

## Report and completion

Use this structure for a general or deep audit. For a narrower request, report
the same coverage and classification fields for every loaded scope and identify
unrequested scopes as not checked.

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

Say the catalog is healthy only when every required read completed and no
loaded rule produced a blocker or risk. Otherwise limit the conclusion to the
data actually read. Close by stating that the audit called no writes.
