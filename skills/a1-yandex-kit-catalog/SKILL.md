---
name: a1-yandex-kit-catalog
description: "Manage the Yandex KIT store catalog over its REST API: products, variants (SKUs, prices, stocks), bulk price/stock sync, variant documents (attachments), categories, characteristics (including groups and colors), product videos, collections, context collections and badges. Use when creating, updating, archiving or querying catalog entities in a Yandex KIT store."
compatibility: "Requires Node.js >= 20"
metadata:
  author: Aleksandr Kovalko
  version: "1.3.0"
---

# A1 Yandex KIT — Catalog

## Communication

Before producing any user-facing message, read and apply
[`../a1-yandex-kit/references/merchant-communication.md`](../a1-yandex-kit/references/merchant-communication.md)
completely.

Covers the catalog domain of the Yandex KIT e-commerce API — tags: Товары,
Категории товаров, Характеристики товаров, Видео, Коллекции, Контекстные коллекции, Бейджи.
In KIT's model the variant (`/v1/variants`) is the sellable unit carrying SKU, prices
and per-warehouse stocks, and a product (`/v1/products`) groups variants, so most
«товар» operations act on variants. A variant carries two **distinct** identifiers:
`product_id` and `product_card_id` (карточка товара) — the card-scoped endpoints
(`/v1/products/cards/{product_card_id}/similar...` and collection card management,
«Добавление/Удаление карточек») take `product_card_id`, never a product id; read it
from the variant first. Variant documents (инструкции, сертификаты, паспорта) live under
`/v1/variants/{id}/attachments`: upload the file via `POST /v1/files` first, then
attach it by `file_id`; the title must not contain `:` or `/`, and
`display_sequence` must be unique per variant (an occupied value returns 409 — nothing
is reordered automatically). Mind the content types: `UpdateVariant`, `UpdateCategory`,
`UpdateCharacteristic` and `UpdateVariantAttachment` use JSON Merge Patch
(`application/merge-patch+json` — send only the fields to change; `null` clears only
the fields the schema marks nullable, see the `a1-yandex-kit` skill), while the other
updates are plain `application/json`.

For catalog-wide syncs prefer the bulk endpoints over per-variant PATCHes:
`POST /v1/variants/prices/bulk_update` and `POST /v1/variants/stocks/bulk_update` take
up to **5000 items** each and are synchronous and **atomic** — one invalid item (unknown or
archived variant, a variant repeated in the batch, a malformed price) rejects the whole
request with 400 and applies nothing, listing every offender in `errors`. In a price item
both fields are optional: omit a key to keep the current value, send `null` to reset it
(resetting `price` works only on unpublished variants).

Product videos are a separate tag: upload via `POST /v1/videos`
(`multipart/form-data`, max 100 MB, mp4/mov/webm/avi/flv, deduplicated by content), then
poll `GET /v1/videos/{video_id}` — `UPLOADED` → `PROCESSING` → `READY` (poll at most
once every 5 seconds) — and attach the ready video to a variant through `media` in
`CreateVariant`/`UpdateVariant`. Characteristics carry two extras beyond the values
themselves: groups (`/v1/characteristics/groups`, ordered by `display_sequence`) and
colors (`/v1/characteristics/colors`), where `UpdateCharacteristicColor` recolors an
**existing** value addressed by the value itself — there is no id — accepting a hex code or
the special `multicoloured` / `transparent`.

For authentication (`Authorization: Bearer <token>`), the base URL (`https://api.kit.yandex.net`, all paths under `/v1/`), the 3 rps rate limit and the `{code, message, trace_id}` error contract, see the `a1-yandex-kit` skill.

## Workflow

Run the bundled scripts from this skill's directory — they are self-contained
(Node.js >= 20, builtins + a vendored validator, no `npm install`, no network).

1. **Search** for the operation you need:

   ```bash
   node scripts/search_docs.mjs "<query>" [--tag "<Тег>"] [--limit N]
   ```

   Matches operation ids, paths, tags and the Russian summaries/descriptions,
   e.g. `node scripts/search_docs.mjs "создать товар"`.

2. **Inspect** the full contract of one operation — path/query parameters plus the fully
   dereferenced request/response schemas:

   ```bash
   node scripts/search_docs.mjs --operation CreateProduct
   ```

3. **Validate** a drafted request body offline before sending anything:

   ```bash
   node scripts/validate.mjs --operation CreateProduct --body '<json>'
   # or: node scripts/validate.mjs --operation CreateProduct --body-file body.json
   ```

   Prints `VALID` (exit 0) or the list of schema violations (exit 1).

4. **Execute** the operation:

   - prefer the matching `mcp-yandex-kit` MCP tool from «Related MCP tools» below (e.g. `create_product`, `update_variant`);
   - any operation without a dedicated tool: the `kit_request` MCP tool — it validates
     the body against the same schema before sending;
   - or plain HTTP:
     `curl -H "Authorization: Bearer $YANDEX_KIT_TOKEN" https://api.kit.yandex.net/v1/...`
     (mind the 3 rps limit).

## Endpoints (70 operations)

### Товары

| Method | Path | OperationId | Summary (RU) |
| --- | --- | --- | --- |
| GET | `/v1/products` | `GetProducts` | Получение списка продуктов |
| POST | `/v1/products` | `CreateProduct` | Создание нового продукта |
| GET | `/v1/products/{id}` | `GetProductById` | Получение продукта по ID |
| PATCH | `/v1/products/{id}` | `UpdateProduct` | Обновление продукта |
| GET | `/v1/products/cards/{product_card_id}/similar` | `GetSimilarProductCardIDs` | Получение списка похожих карточек товара. |
| POST | `/v1/products/cards/{product_card_id}/similar/add` | `AddSimilarProductCards` | Добавление похожих карточек товара |
| POST | `/v1/products/cards/{product_card_id}/similar/remove` | `DeleteSimilarProductCards` | Удаление похожих карточек товара |
| GET | `/v1/variants` | `GetVariants` | Получение списка товаров |
| POST | `/v1/variants` | `CreateVariant` | Создание нового товара |
| GET | `/v1/variants/{id}` | `GetVariantById` | Получение товара по ID |
| PATCH | `/v1/variants/{id}` | `UpdateVariant` | Обновление товара |
| DELETE | `/v1/variants/{id}` | `DeleteVariant` | Безвозвратное удаление архивного товара |
| POST | `/v1/variants/{id}/archive` | `ArchiveVariant` | Архивирование товара |
| POST | `/v1/variants/{id}/unarchive` | `UnarchiveVariant` | Восстановление товара из архива |
| GET | `/v1/variants/{id}/external_ids` | `GetVariantExternalIDs` | Получение внешних идентификаторов товара |
| PUT | `/v1/variants/{id}/external_ids/{system_type}` | `SetVariantExternalID` | Установка внешнего идентификатора |
| DELETE | `/v1/variants/{id}/external_ids/{system_type}` | `DeleteVariantExternalID` | Удаление внешнего идентификатора |
| GET | `/v1/variants/{id}/attachments` | `GetVariantAttachments` | Получение документов товара |
| POST | `/v1/variants/{id}/attachments` | `CreateVariantAttachment` | Прикрепление документа к товару |
| PATCH | `/v1/variants/{id}/attachments/{file_id}` | `UpdateVariantAttachment` | Обновление документа товара |
| DELETE | `/v1/variants/{id}/attachments/{file_id}` | `DeleteVariantAttachment` | Открепление документа от товара |
| POST | `/v1/variants/stocks/bulk_update` | `BulkUpdateStocks` | Массовое обновление остатков |
| POST | `/v1/variants/prices/bulk_update` | `BulkUpdatePrices` | Массовое обновление цен |

### Категории товаров

| Method | Path | OperationId | Summary (RU) |
| --- | --- | --- | --- |
| GET | `/v1/categories` | `GetCategories` | Получение списка категорий |
| POST | `/v1/categories` | `CreateCategory` | Создание новой категории |
| GET | `/v1/categories/{id}` | `GetCategoryById` | Получение категории по ID |
| PATCH | `/v1/categories/{id}` | `UpdateCategory` | Обновление категории |
| POST | `/v1/categories/{id}/archive` | `ArchiveCategory` | Архивирование категории |
| POST | `/v1/categories/{id}/unarchive` | `UnarchiveCategory` | Восстановление категории из архива |

### Характеристики товаров

| Method | Path | OperationId | Summary (RU) |
| --- | --- | --- | --- |
| GET | `/v1/characteristics` | `GetCharacteristics` | Получение списка характеристик |
| POST | `/v1/characteristics` | `CreateCharacteristic` | Создание новой характеристики |
| GET | `/v1/characteristics/{id}` | `GetCharacteristicById` | Получение характеристики по ID |
| PATCH | `/v1/characteristics/{id}` | `UpdateCharacteristic` | Обновление характеристики |
| POST | `/v1/characteristics/{id}/archive` | `ArchiveCharacteristic` | Архивирование характеристики |
| POST | `/v1/characteristics/{id}/unarchive` | `UnarchiveCharacteristic` | Восстановление характеристики из архива |
| GET | `/v1/characteristics/groups` | `GetCharacteristicGroups` | Получение списка групп характеристик |
| POST | `/v1/characteristics/groups` | `CreateCharacteristicGroup` | Создание группы характеристик |
| GET | `/v1/characteristics/groups/{id}` | `GetCharacteristicGroupById` | Получение группы характеристик по ID |
| PATCH | `/v1/characteristics/groups/{id}` | `UpdateCharacteristicGroup` | Обновление группы характеристик |
| DELETE | `/v1/characteristics/groups/{id}` | `DeleteCharacteristicGroup` | Удаление группы характеристик |
| GET | `/v1/characteristics/colors` | `GetCharacteristicColors` | Получение списка цветов |
| PATCH | `/v1/characteristics/colors` | `UpdateCharacteristicColor` | Обновление hex-кода для значения цветовой характеристики |

### Видео

| Method | Path | OperationId | Summary (RU) |
| --- | --- | --- | --- |
| GET | `/v1/videos` | `GetVideos` | Получение списка видео |
| POST | `/v1/videos` | `UploadVideo` | Загрузка видео |
| GET | `/v1/videos/{video_id}` | `GetVideoById` | Получение видео по идентификатору |

### Коллекции

| Method | Path | OperationId | Summary (RU) |
| --- | --- | --- | --- |
| GET | `/v1/collections/{collection_id}` | `GetCollectionById` | Получение коллекции по ID |
| PATCH | `/v1/collections/{collection_id}` | `UpdateCollection` | Обновление коллекции |
| DELETE | `/v1/collections/{collection_id}` | `DeleteCollectionById` | Удаление коллекции |
| POST | `/v1/collections/{collection_id}/cards/add` | `AddCardsToCollection` | Добавление карточек в статическую коллекцию |
| POST | `/v1/collections/{collection_id}/cards/remove` | `RemoveCardsFromCollection` | Удаление карточек из статической коллекции |
| GET | `/v1/collections/{collection_id}/cards/manual-order` | `GetCollectionCardsManualOrder` | Получение ручного порядка карточек коллекции |
| POST | `/v1/collections/{collection_id}/cards/move` | `MoveCollectionCards` | Перемещение карточек в статической коллекции |
| GET | `/v1/collections` | `GetCollections` | Получение списка коллекций |
| POST | `/v1/collections` | `CreateCollection` | Создание коллекции |
| GET | `/v1/collections/{collection_id}/variants` | `GetVariantsByCollectionId` | Получение ID товаров коллекции по ID |

### Контекстные коллекции

| Method | Path | OperationId | Summary (RU) |
| --- | --- | --- | --- |
| GET | `/v1/context-collections` | `GetContextCollections` | Получение списка контекстных коллекций |
| POST | `/v1/context-collections` | `CreateContextCollection` | Создание контекстной коллекции |
| GET | `/v1/context-collections/{id}` | `GetContextCollectionById` | Получение контекстной коллекции по ID |
| PATCH | `/v1/context-collections/{id}` | `UpdateContextCollection` | Обновление контекстной коллекции |
| DELETE | `/v1/context-collections/{id}` | `DeleteContextCollection` | Удаление контекстной коллекции |

### Бейджи

| Method | Path | OperationId | Summary (RU) |
| --- | --- | --- | --- |
| GET | `/v1/badges/{badge_id}` | `GetBadgeById` | Получение бейджа по уникальному идентификатору |
| PATCH | `/v1/badges/{badge_id}` | `UpdateBadge` | Обновление бейджа |
| DELETE | `/v1/badges/{badge_id}` | `DeleteBadgeById` | Удаление бейджа |
| GET | `/v1/badges` | `GetBadges` | Получение списка бейджей |
| POST | `/v1/badges` | `CreateBadge` | Создание бейджа |
| GET | `/v1/badges/{badge_id}/variants` | `GetBadgeVariantIDs` | Получение уникальных идентификаторов товаров бейджа |
| GET | `/v1/badges/{badge_id}/categories` | `GetBadgeCategoryIDs` | Получение идентификаторов категорий бейджа |
| GET | `/v1/badges/{badge_id}/collections` | `GetBadgeCollectionIDs` | Получение идентификаторов коллекций бейджа |
| POST | `/v1/badges/{badge_id}/objects/add` | `AddBadgeObjects` | Добавление объектов в бейдж |
| POST | `/v1/badges/{badge_id}/objects/remove` | `RemoveBadgeObjects` | Удаление объектов из бейджа |

## Related MCP tools

Curated `mcp-yandex-kit` tools for these tags (the server also exposes the meta trio —
`search_operations`, `get_operation_schema`, `kit_request` — reaching all
160 operations):

- `list_products` — List products of the store (paginated).
- `get_product` — Get a single product by its ID, including its category bindings.
- `create_product` — Create a new product.
- `update_product` — Update an existing product (plain JSON PATCH, not merge-patch).
- `list_variants` — List variants (sellable items / SKUs) of the store, with optional filters (paginated).
- `get_variant` — Get a single variant by its ID (name, SKU, pricing, stocks, media, status).
- `create_variant` — Create a new variant (sellable item) under an existing product.
- `update_variant` — Update an existing variant via JSON Merge Patch: send only the fields to change (e.g. pricing or stocks).
- `bulk_update_prices` — Update prices of up to 5000 variants in one synchronous, atomic request — the fast path for syncing a whole catalog instead of calling update_variant per item.
- `variant_action` — Archive a variant (soft delete: status becomes ARCHIVED, item is hidden from the storefront but restorable) or unarchive it (status becomes HIDDEN; publish it afterwards via update_variant).
- `list_categories` — List product categories of the store (paginated).
- `get_category` — Get a single product category by its ID.
- `create_category` — Create a new product category.
- `update_category` — Update an existing category via JSON Merge Patch: send only the fields to change.
- `category_action` — Archive a category (soft delete: hidden from the storefront, restorable) or unarchive it.
- `list_characteristic_colors` — List the color values of the store's characteristics with their hex codes (paginated).
- `update_characteristic_color` — Set the hex code of a color characteristic value.
- `list_videos` — List product videos of the store (paginated), oldest upload first.
- `get_video` — Get a single video by its ID with the current processing status.
- `upload_video` — Upload a product video via multipart/form-data and queue it for processing.
- `list_collections` — List collections of the store (paginated).
- `get_collection` — Get a single collection by its ID (title, slug, status, type, SEO fields).
- `create_collection` — Create a new collection.
- `update_collection` — Update an existing collection (plain JSON PATCH; only the provided fields are changed).
- `delete_collection` — Permanently delete a collection by its ID.
- `manage_collection_cards` — Add product cards to a STATIC collection or remove them from it.

Характеристики товаров beyond the color tools, Контекстные коллекции and Бейджи have no dedicated tools — reach them through `search_operations` + `kit_request`.
