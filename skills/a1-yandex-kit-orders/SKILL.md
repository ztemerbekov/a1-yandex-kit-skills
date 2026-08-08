---
name: a1-yandex-kit-orders
description: "Manage orders in a Yandex KIT store over its REST API: orders and their statuses, customers, gift cards and additional services (addons). Use when listing, confirming or cancelling KIT orders, or when looking up customers, their orders or gift cards."
compatibility: "Requires Node.js >= 20"
metadata:
  author: Aleksandr Kovalko
  version: "1.3.0"
---

# A1 Yandex KIT — Orders

## Communication

Before producing any user-facing message, read and apply
[`../a1-yandex-kit/references/merchant-communication.md`](../a1-yandex-kit/references/merchant-communication.md)
completely.

Covers the order-management domain of the Yandex KIT e-commerce API — tags: Заказы,
Клиенты, Подарочные карты, Услуги. Orders are created by buyers on the storefront;
through the API you list and inspect them, confirm or cancel them, close out their delivery
(`POST /v1/orders/{id}/delivery/complete` — for pickup and the store's own delivery when
delivery automation is off), and read the attached additional services (addons), customer
records and gift cards. A customer record also carries the marketing-consent pair
`agreement_for_promo` + `agreement_at` — read it before adding anyone to a mailing list
and mirror it into your CRM. All datetimes are UTC, and list endpoints paginate with
`page`/`per_page` (max 100).

For authentication (`Authorization: Bearer <token>`), the base URL (`https://api.kit.yandex.net`, all paths under `/v1/`), the 3 rps rate limit and the `{code, message, trace_id}` error contract, see the `a1-yandex-kit` skill.

## Workflow

Run the bundled scripts from this skill's directory — they are self-contained
(Node.js >= 20, builtins + a vendored validator, no `npm install`, no network).

1. **Search** for the operation you need:

   ```bash
   node scripts/search_docs.mjs "<query>" [--tag "<Тег>"] [--limit N]
   ```

   Matches operation ids, paths, tags and the Russian summaries/descriptions,
   e.g. `node scripts/search_docs.mjs "подтвердить заказ"`.

2. **Inspect** the full contract of one operation — path/query parameters plus the fully
   dereferenced request/response schemas:

   ```bash
   node scripts/search_docs.mjs --operation ConfirmOrder
   ```

3. **Validate** a drafted request body offline before sending anything:

   ```bash
   node scripts/validate.mjs --operation ConfirmOrder --body '<json>'
   # or: node scripts/validate.mjs --operation ConfirmOrder --body-file body.json
   ```

   Prints `VALID` (exit 0) or the list of schema violations (exit 1).

4. **Execute** the operation:

   - prefer the matching `mcp-yandex-kit` MCP tool from «Related MCP tools» below (e.g. `list_orders`, `confirm_order`);
   - any operation without a dedicated tool: the `kit_request` MCP tool — it validates
     the body against the same schema before sending;
   - or plain HTTP:
     `curl -H "Authorization: Bearer $YANDEX_KIT_TOKEN" https://api.kit.yandex.net/v1/...`
     (mind the 3 rps limit).

## Endpoints (22 operations)

### Заказы

| Method | Path | OperationId | Summary (RU) |
| --- | --- | --- | --- |
| GET | `/v1/customers/{customer_id}/orders` | `GetOrdersByCustomerId` | Получение списка заказов по ID клиента |
| GET | `/v1/orders` | `GetOrders` | Получение списка заказов |
| GET | `/v1/orders/{id}` | `GetOrderById` | Получение заказа по ID |
| GET | `/v1/orders/{id}/addons` | `GetOrderAddons` | Получение списка услуг заказа |
| POST | `/v1/orders/{id}/confirm` | `ConfirmOrder` | Подтверждение заказа |
| POST | `/v1/orders/{id}/cancel` | `CancelOrder` | Отмена заказа |
| POST | `/v1/orders/{id}/delivery/complete` | `CompleteOrderDelivery` | Завершение доставки заказа |

### Клиенты

| Method | Path | OperationId | Summary (RU) |
| --- | --- | --- | --- |
| GET | `/v1/customers` | `GetCustomers` | Получение списка клиентов |
| GET | `/v1/customers/{customer_id}` | `GetCustomerById` | Получение клиента по ID |
| PATCH | `/v1/customers/{customer_id}` | `UpdateCustomer` | Обновление клиента |

### Подарочные карты

| Method | Path | OperationId | Summary (RU) |
| --- | --- | --- | --- |
| GET | `/v1/gift_cards` | `GetGiftCards` | Получение списка подарочных карт |
| GET | `/v1/gift_cards/{gift_card_id}` | `GetGiftCardById` | Получение подарочной карты по ID |

### Услуги

| Method | Path | OperationId | Summary (RU) |
| --- | --- | --- | --- |
| GET | `/v1/addons` | `GetAddons` | Получение списка услуг |
| POST | `/v1/addons` | `CreateAddon` | Создание услуги |
| GET | `/v1/addons/{id}` | `GetAddonById` | Получение услуги по ID |
| PATCH | `/v1/addons/{id}` | `UpdateAddon` | Обновление услуги |
| DELETE | `/v1/addons/{id}` | `DeleteAddon` | Удаление услуги |
| GET | `/v1/addons/{id}/variants` | `GetAddonVariantIDs` | Получение уникальных идентификаторов товаров услуги |
| GET | `/v1/addons/{id}/categories` | `GetAddonCategoryIDs` | Получение идентификаторов категорий услуги |
| GET | `/v1/addons/{id}/collections` | `GetAddonCollectionIDs` | Получение идентификаторов коллекций услуги. |
| POST | `/v1/addons/{id}/objects/add` | `AddAddonObjects` | Добавление объектов в услугу |
| POST | `/v1/addons/{id}/objects/remove` | `RemoveAddonObjects` | Удаление объектов из услуги |

## Related MCP tools

Curated `mcp-yandex-kit` tools for these tags (the server also exposes the meta trio —
`search_operations`, `get_operation_schema`, `kit_request` — reaching all
160 operations):

- `list_orders` — List orders of the store (paginated), newest first.
- `get_order` — Get a single order by its ID, including line items, delivery chunks, payment and status.
- `confirm_order` — Confirm an order.
- `cancel_order` — Cancel an order.
- `complete_order_delivery` — Mark the delivery of an order as fully completed.
- `get_order_addons` — List additional services (addons) attached to an order by the order ID.
- `list_customers` — List customers of the store (paginated).
- `get_customer` — Get a single customer by their ID.
- `update_customer` — Update a customer (plain JSON PATCH).
- `get_customer_orders` — List order IDs of a customer by their customer ID (paginated).
- `list_gift_cards` — List gift cards of the store (paginated), with optional status and purchase-date filters.
- `get_gift_card` — Get a single gift card by its ID, including status, balance and purchase info.

Услуги (addons) beyond `get_order_addons` have no dedicated tools — manage them through `search_operations` + `kit_request`.
