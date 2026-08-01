---
name: a1-yandex-kit-promotions
description: "Manage promotions in a Yandex KIT store over its REST API: discounts, promo codes and gifts. Use when creating or updating discounts, promocodes or gifts, or when binding them to products, categories or collections."
compatibility: "Requires Node.js >= 20"
metadata:
  author: gistrec
  version: "0.1.0"
---

# A1 Yandex KIT — Promotions

Covers the promotions domain of the Yandex KIT e-commerce API — tags: Скидки,
Промокоды, Подарки. All three promotion kinds are created first and then bound to
objects: discounts and promocodes to variants, categories or collections via the
`.../objects/add` and `.../objects/remove` endpoints, gifts to variants via
`POST`/`DELETE /v1/gifts/{id}/variants`. End-of-life differs per kind — **only
discounts can be archived** (`ArchiveDiscount`/`UnarchiveDiscount`, status
`ACTIVE`/`INACTIVE`/`ARCHIVED`; archived discounts stop applying but stay
restorable). Promocodes and gifts have no archive endpoints and only two statuses,
`ACTIVE`/`INACTIVE` — pause them by PATCHing `status` to `INACTIVE` via
`UpdatePromocode`/`UpdateGift`. `DeleteGift` removes a gift **permanently**, with
no restore — prefer deactivation.

For authentication (`Authorization: Bearer <token>`), the base URL (`https://api.kit.yandex.net`, all paths under `/v1/`), the 3 rps rate limit and the `{code, message, trace_id}` error contract, see the `a1-yandex-kit` skill.

## Workflow

Run the bundled scripts from this skill's directory — they are self-contained
(Node.js >= 20, builtins + a vendored validator, no `npm install`, no network).

1. **Search** for the operation you need:

   ```bash
   node scripts/search_docs.mjs "<query>" [--tag "<Тег>"] [--limit N]
   ```

   Matches operation ids, paths, tags and the Russian summaries/descriptions,
   e.g. `node scripts/search_docs.mjs "создать скидку"`.

2. **Inspect** the full contract of one operation — path/query parameters plus the fully
   dereferenced request/response schemas:

   ```bash
   node scripts/search_docs.mjs --operation CreateDiscount
   ```

3. **Validate** a drafted request body offline before sending anything:

   ```bash
   node scripts/validate.mjs --operation CreateDiscount --body '<json>'
   # or: node scripts/validate.mjs --operation CreateDiscount --body-file body.json
   ```

   Prints `VALID` (exit 0) or the list of schema violations (exit 1).

4. **Execute** the operation:

   - prefer the matching `mcp-yandex-kit` MCP tool from «Related MCP tools» below (e.g. `create_discount`, `manage_promocode_objects`);
   - any operation without a dedicated tool: the `kit_request` MCP tool — it validates
     the body against the same schema before sending;
   - or plain HTTP:
     `curl -H "Authorization: Bearer $YANDEX_KIT_TOKEN" https://api.kit.yandex.net/v1/...`
     (mind the 3 rps limit).

## Endpoints (28 operations)

### Скидки

| Method | Path | OperationId | Summary (RU) |
| --- | --- | --- | --- |
| GET | `/v1/discounts` | `GetDiscounts` | Получение списка скидок |
| POST | `/v1/discounts` | `CreateDiscount` | Создание скидки |
| GET | `/v1/discounts/{id}` | `GetDiscountById` | Получение скидки по ID |
| PATCH | `/v1/discounts/{id}` | `UpdateDiscount` | Обновление скидки |
| GET | `/v1/discounts/{id}/categories` | `GetDiscountCategoryIDs` | Получение идентификаторов категорий для которых применяется скидка |
| GET | `/v1/discounts/{id}/collections` | `GetDiscountCollectionIDs` | Получение идентификаторов коллекций, к которым применяется скидка. |
| GET | `/v1/discounts/{id}/variants` | `GetDiscountVariantIDs` | Получение уникальных идентификаторов товаров скидки |
| POST | `/v1/discounts/{id}/archive` | `ArchiveDiscount` | Архивация скидки |
| POST | `/v1/discounts/{id}/unarchive` | `UnarchiveDiscount` | Разархивация скидки |
| POST | `/v1/discounts/{id}/objects/add` | `AddDiscountObjects` | Добавление объектов в скидку |
| POST | `/v1/discounts/{id}/objects/remove` | `RemoveDiscountObjects` | Удаление объектов из скидки |

### Промокоды

| Method | Path | OperationId | Summary (RU) |
| --- | --- | --- | --- |
| GET | `/v1/promocodes/{id}` | `GetPromocodeById` | Получение промокода по уникальному идентификатору |
| PATCH | `/v1/promocodes/{id}` | `UpdatePromocode` | Обновление промокода |
| GET | `/v1/promocodes` | `GetPromocodes` | Получение списка промокодов |
| POST | `/v1/promocodes` | `CreatePromocode` | Создание промокода |
| GET | `/v1/promocodes/{id}/categories` | `GetPromocodeCategoryIDs` | Получение идентификаторов категорий |
| GET | `/v1/promocodes/{id}/collections` | `GetPromocodeCollectionIDs` | Получение идентификаторов коллекций, к которым применяется промокод |
| GET | `/v1/promocodes/{id}/variants` | `GetPromocodeVariantIDs` | Получение уникальных идентификаторов товаров промокода |
| POST | `/v1/promocodes/{id}/objects/add` | `AddPromocodeObjects` | Добавление объектов в промокод |
| POST | `/v1/promocodes/{id}/objects/remove` | `RemovePromocodeObjects` | Удаление объектов из промокода |

### Подарки

| Method | Path | OperationId | Summary (RU) |
| --- | --- | --- | --- |
| GET | `/v1/gifts` | `GetGifts` | Получение списка подарков |
| POST | `/v1/gifts` | `CreateGift` | Создание подарка |
| GET | `/v1/gifts/{id}` | `GetGiftById` | Получение подарка по ID |
| PATCH | `/v1/gifts/{id}` | `UpdateGift` | Обновление подарка |
| DELETE | `/v1/gifts/{id}` | `DeleteGift` | Удаление подарка |
| GET | `/v1/gifts/{id}/variants` | `GetGiftVariants` | Получение идентификаторов товаров подарка |
| POST | `/v1/gifts/{id}/variants` | `AddGiftVariants` | Добавление товаров в подарок |
| DELETE | `/v1/gifts/{id}/variants` | `RemoveGiftVariants` | Удаление товаров из подарка |

## Related MCP tools

Curated `mcp-yandex-kit` tools for these tags (the server also exposes the meta trio —
`search_operations`, `get_operation_schema`, `kit_request` — reaching all
133 operations):

- `list_discounts` — List discounts of the store filtered by status (paginated).
- `get_discount` — Get a single discount by its ID (title, value, dates, status, binding mode).
- `create_discount` — Create a new discount.
- `update_discount` — Update an existing discount (plain application/json PATCH): send only the fields to change (title, discount_value, discount_dates, status, binding_mode).
- `discount_action` — Archive a discount (soft delete: status becomes ARCHIVED, the discount stops applying but stays restorable) or unarchive it (returns it to a non-archived status).
- `manage_discount_objects` — Attach objects to a discount or detach them.
- `list_promocodes` — List promocodes of the store filtered by status (paginated).
- `get_promocode` — Get a single promocode by its ID (code, title, discount value, dates, type, usage limits).
- `create_promocode` — Create a new promocode.
- `update_promocode` — Update an existing promocode (plain application/json PATCH): send only the fields to change (code, title, discount_value, promocode_dates, status, binding_mode, limits).
- `manage_promocode_objects` — Attach objects to a promocode or detach them.

Подарки (gifts) have no dedicated tools — manage them through `search_operations` + `kit_request`.
