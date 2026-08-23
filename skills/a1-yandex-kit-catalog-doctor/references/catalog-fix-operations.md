# Catalog exact-fix operations

Read this reference completely with `exact-write-protocol.md` before every
explicit Catalog Doctor write. The shared protocol governs authorization,
target resolution, mutation count, verification, ambiguity and batch
completion; this file defines Catalog Doctor's accepted sources and
operation-specific rules.

## Contents

- [Accepted value sources](#accepted-value-sources)
- [Whole-value preservation](#whole-value-preservation)
- [Operation distinctions](#operation-distinctions)
- [Bulk report](#bulk-report)

## Accepted value sources

A business value is writable only when it comes from:

1. the owner's command, with an exact object and value;
2. an owner-named authoritative source such as a specific ERP/WMS export,
   approved spreadsheet or exact ID mapping, where target-to-value mapping is
   deterministic;
3. the current API object only to preserve untouched fields and verify
   preconditions.

Audit recommendations, product names, neighboring SKUs, averages, model
inference, industry conventions and “what looks right” are never value sources.
Never invent a price, quantity, category, characteristic value, image/file ID,
grouping rule, badge, collection relation or deletion target.

If a field lacks a source, ask one grouped concrete question for that field and
source. Example: «Для остатков нужен источник правильных количеств: какой
WMS/ERP-файл использовать и какие колонки содержат SKU, warehouse_id и
quantity?» Call no write tool first.

«Исправь всё» means:

- execute only objects whose exact action and correct value are already
  determined;
- group every remaining gap by field and required source;
- never propagate one known value to objects whose values remain unknown.

## Whole-value preservation

These fields replace their whole collection and must be reconstructed from the
detail read before changing one element:

- `Variant.stocks`: preserve every other warehouse and each untouched
  `reserved`;
- `Variant.media`: preserve every other IMAGE/VIDEO/OTHER and display sequence;
- `Variant.characteristics`: preserve every other characteristic and
  multi-value;
- `Product.category_ids`: preserve every category except the exact requested
  add/remove/replace target;
- `Product.settings`: preserve both grouping and splitting arrays while
  changing one ID;
- static collection cards and badge/context/similar relations: read current
  relation IDs, apply the exact delta and preserve the rest when the operation
  replaces the set.

A list response missing a required projection is not an empty array. Detail-read
the object before reconstructing a whole value.

`Product.category_ids` exposes only active bindings. Because the API cannot
enumerate hidden archived bindings, the detail response alone can never prove
that the returned array is complete. Every exact add/remove/replace of product
category bindings requires an owner-named authoritative complete category-ID
set that includes archived bindings. Without it, report that preservation
cannot be proven and leave the product unchanged.

## Operation distinctions

- **Price:** `get_variant` → `update_variant` with only
  `{pricing: {price: <owner value>}}` (and exact manual discount only when
  stated) → `get_variant`. `UpdateVariant` uses
  `application/merge-patch+json`, so omitted `pricing` members are preserved
  recursively; `promotion_price` and `final_price` are calculated response
  fields and are not accepted in `VariantPricingRequest`.
- **One stock/media/characteristic change:** `get_variant` →
  `update_variant` with the full preserved target array → `get_variant`.
- **Categories or grouping settings:** `get_product` → `update_product` with
  the full preserved `category_ids` or `settings` value → `get_product`.
- **Category metadata/state:**
  `GetCategoryById(path_params: {id})` → exactly one of
  `UpdateCategory(path_params: {id}, body: <only exact changed merge-patch fields>)`,
  `ArchiveCategory(path_params: {id}, query: {archive_variants: <owner choice>})`
  or `UnarchiveCategory(path_params: {id})` → `GetCategoryById`. Never infer
  `archive_variants: true`; if dependent active variants make that choice
  material and the owner did not state it, leave the category unchanged and
  ask. To prove that there are no dependent active variants, call
  `GetProducts(query: {page: <N>, per_page: 100})` from page 1 through the
  reported `total_count`, select products whose active `category_ids` contain
  the target category, then call
  `GetVariants(query: {page: <N>, per_page: 100, product_id,
  status: ["PUBLISHED", "HIDDEN"]})` through each reported `total_count`. Only
  when every required page succeeds and every variant result is empty may an
  unstated `archive_variants` be handled by omitting `query` and using the
  documented API default `false`; incomplete coverage is not proof and requires
  the owner's choice.
- **Characteristic metadata:**
  `GetCharacteristicById(path_params: {id})` → exactly one of
  `UpdateCharacteristic(path_params: {id}, body: <only exact changed merge-patch fields>)`,
  `ArchiveCharacteristic(path_params: {id})` or
  `UnarchiveCharacteristic(path_params: {id})` →
  `GetCharacteristicById`. `UpdateCharacteristic` is
  `application/merge-patch+json`; send only exact changed fields.
- **Collections:** `get_collection` before `update_collection`,
  `manage_collection_cards` or exact `delete_collection`; re-read afterward. A
  confirmed not-found verifies exact deletion.
- **Badge membership:** read all pages with exactly one operation matching
  `binding_mode` — `GetBadgeVariantIDs`, `GetBadgeCategoryIDs` or
  `GetBadgeCollectionIDs`, each with `path_params: {badge_id}`. Apply the exact
  delta with `AddBadgeObjects` or `RemoveBadgeObjects`,
  `path_params: {badge_id}`, and a body containing only the applicable
  `product_variant_ids`, `category_ids` or `collection_ids`; then re-read all
  pages with the same read operation.
- **Similar cards:** read all pages with
  `GetSimilarProductCardIDs(path_params: {product_card_id})`; apply the exact
  delta with `AddSimilarProductCards` or `DeleteSimilarProductCards`, the same
  path params and `body: {similar_card_ids: [...]}`; then re-read all pages.
  Validate the request against the current operation schema rather than
  inventing a client-side item limit.
- **Context collections:**
  `GetContextCollectionById(path_params: {id})` → one
  `UpdateContextCollection(path_params: {id}, body: <only exact changed fields>)`
  → `GetContextCollectionById`. If changing `conditions`, preserve the complete
  conditions array from the detail read. Use `DeleteContextCollection` only for
  an exact delete command and verify not-found.
- **Archiving, unarchiving, permanent deletion and ordinary update are different
  actions.** Never substitute one for another. Permanent SKU deletion uses
  `kit_request(operation_id: DeleteVariant, path_params: {id})`, only after an
  exact permanent-delete verb and a detail read confirming `ARCHIVED`. The API
  has no permanent category-delete operation; never promise one. A bulk
  command over the archive as a set («удали все карточки из архива») cannot be
  resolved to targets: the API cannot enumerate archived variants (`ARCHIVED`
  is silently stripped from the `GetVariants` status filter — known defect,
  issue #54), and `list_variants` fails with
  `STATUS_FILTER_IGNORED`/`ARCHIVE_READ_UNSUPPORTED`. Report enumeration as
  unsupported, ask the owner for the exact variant IDs (for example from
  creation logs), and never derive targets from the default listing or report
  the archive as empty.

An image addition requires an exact existing `image_id` or a separately
authorized upload source. Treat file upload and variant linking as two explicit
write objects, each with its own verification. If only linking was authorized,
require an existing `image_id`. Never choose a replacement image or invent a
file source.

A public-link video addition requires an exact variant, public URL and free
`display_sequence`. Read the variant before upload and require at least one
usable image in its current `media`. An add command preserves an existing video;
replacement or removal requires an explicit owner command. Call
`upload_video_from_url` once, then poll `get_video` at intervals of at least five
seconds for at most 60 reads. `READY` verifies the upload and permits one
`update_variant` with the complete preserved `media` list plus the new video.
`ERROR`, a failed status read or the exhausted poll bound leaves `Variant.media`
unchanged and reports the uploaded video separately. Re-read the variant and
compare the complete `media` list after linking. Treat video upload and variant
linking as separate write objects, each with its own verification evidence.

An explicit video-removal command maps to one `update_variant` whose `media` is
rebuilt from the immediately preceding detail read: drop only entries with
`type: "VIDEO"` and keep every other entry unchanged — same `image_id`, same
`type`, same `display_sequence` and every other field. The confirmed detail
read is what proves the sent list is complete, not its length: when the card
holds exactly one image and one video, the correct request carries that single
image and must not be blocked as a possibly incomplete list. Never rebuild
`media` from a list projection or an older read, and change no other variant
field in the same mutation. If the detail read contains no `VIDEO` entry,
report that there is nothing to remove and make zero writes. After the write,
re-read the variant and compare the complete expected `media` list.

## Bulk report

Split resolved targets into local chunks of at most 100 while still applying the
shared per-object protocol. Send mutations sequentially through the MCP client;
its configured token bucket (default 3 requests/second) enforces request rate.

Use exact counts and IDs:

```text
Исправлено (<count>)
- <object ID/SKU>: <verified result>.

Не исправлено (<count>)
- <object ID/SKU>: <confirmed reason>.

Неоднозначно (<count>)
- <object ID/SKU or field group>: <reason / missing source>.
```

Group missing inputs by field and required source rather than asking one
question per object. The fix is complete only when these outcomes and grouped
source questions account for the whole requested set.
