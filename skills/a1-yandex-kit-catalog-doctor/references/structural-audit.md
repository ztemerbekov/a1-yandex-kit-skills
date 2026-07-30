# Structural catalog audit

Read this reference completely for general/deep audits and for requests about
grouping, characteristics, card completeness, media or collections. It extends
`audit-protocol.md` and `core-catalog-audit.md`.

## Contents

- [Structural coverage](#structural-coverage)
- [Grouping and characteristics](#grouping-and-characteristics)
- [Card completeness and media](#card-completeness-and-media)
- [Collections](#collections)
- [Structural severity](#structural-severity)

## Structural coverage

1. The list responses contain the full OpenAPI `Product` and `Variant` objects,
   including `Product.settings` and `Variant.characteristics` / `media`. If a
   returned object lacks one of those required projections, call `get_product`
   or `get_variant`; an absent projection is not an empty value.
2. Read characteristics with `kit_request`:
   `operation_id: GetCharacteristics`,
   `query: {status: ["ACTIVE", "ARCHIVED"], page: <N>, per_page: 100}`.
   On interrupted pagination, detail-read every referenced definition absent
   from the received pages with `GetCharacteristicById` and
   `path_params: {id: <id>}`. A 404 confirms a broken reference; another read
   failure is missing evidence and a risk.
3. Read collections with
   `list_collections(status: ["ACTIVE"], page: <N>, per_page: 100)`. For each,
   paginate `GetVariantsByCollectionId` with
   `path_params: {collection_id: <id>}` and
   `query: {page: <N>, per_page: 100}`. If a returned variant ID is outside the
   PUBLISHED/HIDDEN list, call `get_variant`: an `ARCHIVED` result is an archive
   risk, 404 is a broken relation and another failure is missing evidence.

Use the pagination and interruption rules from `audit-protocol.md` for every
structural read.

## Grouping and characteristics

- Use only `Product.settings.grouping_characteristic_ids` and
  `Variant.characteristics`. Never derive a characteristic or its value from
  the product name unless the owner gives an explicit rule authorizing that
  derivation.
- Read splitting IDs from `Product.settings.splitting_characteristic_ids`.
- Normalize grouping values by trimming surrounding whitespace, dropping empty
  values, sorting multi-values inside one characteristic, and preserving case.
  Compare only complete combinations; separately report every missing grouping
  value.
- Flag a checked variant missing a value for any grouping characteristic.
- Compare complete grouping-value combinations inside one product and flag
  duplicates. Flag a grouping characteristic with only one populated value
  across several variants because it does not separate them.
- Flag splitting characteristic IDs that are not also grouping characteristic
  IDs.
- Flag every characteristic reference absent from the full
  active-and-archived characteristic read. Flag an active product that groups
  by an archived characteristic.

## Card completeness and media

- An explicit owner rule such as `Обязательные поля владельца: бренд, описание`
  makes those fields required; a missing value is a blocker for a published SKU
  and a risk for a hidden SKU.
- A blank API-required display field such as `name` or `slug` is an
  incompleteness risk. An explicitly empty `brand` or `description` that the
  owner did not make required is only an optional recommendation. An omitted
  optional field is not an API error.
- For each media item, require `image_id` for `IMAGE` and `video_id` for
  `VIDEO`; `OTHER` has no such identifier requirement. Flag duplicate
  `(type, id)` pairs, duplicate display sequences and a usable image set with no
  image at `display_sequence: 1`.
- `display_sequence` is required and numeric in the response schema. Compare
  returned numeric positions; never turn omitted projections into repeated
  `null` positions.
- Never choose a replacement image, invent a media source or infer an
  identifier.

## Collections

- Flag an active collection with `cards_count: 0`, an active collection with
  `hidden_cards_count > 0`, and collection variant relations that do not resolve
  in the checked variant scope.
- A collection relation to an `ARCHIVED` variant is an archive risk; a confirmed
  404 is broken; another failed detail read is missing evidence.

## Structural severity

- Missing grouping value, archived grouping characteristic or confirmed broken
  characteristic reference: blocker for a PUBLISHED SKU/product, risk for
  HIDDEN.
- Duplicate grouping combination, grouping that does not separate variants,
  invalid splitting subset, duplicate media/order, no main image, empty active
  collection, hidden card, archived collection relation or broken optional
  relation: risk.
- An IMAGE/VIDEO without its required identifier: risk when another usable
  image remains; if no usable image remains, the core missing-image rule
  determines blocker/risk by SKU status.
- Missing owner-required field: blocker for PUBLISHED, risk for HIDDEN.
- Empty API-required `name` / `slug`: risk.
- Empty non-required `brand` / `description`: optional recommendation only.
- An unread definition/relation after fallback: risk plus incomplete coverage,
  never a confirmed blocker.

This scope is complete only when every structural collection reaches its
termination rule or records exact partial coverage, and every relevant object
has been checked against every structural rule above.
