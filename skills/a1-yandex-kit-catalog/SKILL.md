---
name: a1-yandex-kit-catalog
description: "Manage the Yandex KIT store catalog over its REST API: products, variants (SKUs, prices, stocks), categories, characteristics, collections, context collections and badges. Use when creating, updating, archiving or querying catalog entities in a Yandex KIT store."
compatibility: "Requires Node.js >= 20"
metadata:
  author: gistrec
  version: "0.1.0"
---

# A1 Yandex KIT — Catalog

Covers the catalog domain of the Yandex KIT e-commerce API — tags: Товары,
Категории товаров, Характеристики товаров, Коллекции, Контекстные коллекции, Бейджи.
In KIT's model the variant (`/v1/variants`) is the sellable unit carrying SKU, prices
and per-warehouse stocks, and a product (`/v1/products`) groups variants, so most
«товар» operations act on variants. A variant carries two **distinct** identifiers:
`product_id` and `product_card_id` (карточка товара) — the card-scoped endpoints
(`/v1/products/cards/{product_card_id}/similar...` and collection card management,
«Добавление/Удаление карточек») take `product_card_id`, never a product id; read it
from the variant first. Mind the content types: `UpdateVariant`, `UpdateCategory` and
`UpdateCharacteristic` use JSON Merge Patch (`application/merge-patch+json` — send
only the fields to change; `null` clears only the fields the schema marks nullable,
see the `a1-yandex-kit` skill), while the other updates are plain `application/json`.

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

## Endpoints (57 operations)

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

### Коллекции

| Method | Path | OperationId | Summary (RU) |
| --- | --- | --- | --- |
| GET | `/v1/collections/{collection_id}` | `GetCollectionById` | Получение коллекции по ID |
| PATCH | `/v1/collections/{collection_id}` | `UpdateCollection` | Обновление коллекции |
| DELETE | `/v1/collections/{collection_id}` | `DeleteCollectionById` | Удаление коллекции |
| POST | `/v1/collections/{collection_id}/cards/add` | `AddCardsToCollection` | Добавление карточек в статическую коллекцию |
| POST | `/v1/collections/{collection_id}/cards/remove` | `RemoveCardsFromCollection` | Удаление карточек из статической коллекции |
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
133 operations):

- `list_products` — List products of the store (paginated).
- `get_product` — Get a single product by its ID, including its category bindings.
- `create_product` — Create a new product.
- `update_product` — Update an existing product (plain JSON PATCH, not merge-patch).
- `list_variants` — List variants (sellable items / SKUs) of the store, with optional filters (paginated).
- `get_variant` — Get a single variant by its ID (name, SKU, pricing, stocks, media, status).
- `create_variant` — Create a new variant (sellable item) under an existing product.
- `update_variant` — Update an existing variant via JSON Merge Patch: send only the fields to change (e.g. pricing or stocks); set a field to null to remove it.
- `variant_action` — Archive a variant (soft delete: status becomes ARCHIVED, item is hidden from the storefront but restorable) or unarchive it (status becomes HIDDEN; publish it afterwards via update_variant).
- `list_categories` — List product categories of the store (paginated).
- `get_category` — Get a single product category by its ID.
- `create_category` — Create a new product category.
- `update_category` — Update an existing category via JSON Merge Patch: send only the fields to change; set a field to null to remove it (e.g. parent_id: null makes the category top-level).
- `category_action` — Archive a category (soft delete: hidden from the storefront, restorable) or unarchive it.
- `list_collections` — List collections of the store (paginated).
- `get_collection` — Get a single collection by its ID (title, slug, status, type, SEO fields).
- `create_collection` — Create a new collection.
- `update_collection` — Update an existing collection (plain JSON PATCH; only the provided fields are changed).
- `delete_collection` — Permanently delete a collection by its ID.
- `manage_collection_cards` — Add product cards to a STATIC collection or remove them from it.

Характеристики товаров, Контекстные коллекции and Бейджи have no dedicated tools — reach them through `search_operations` + `kit_request`.
