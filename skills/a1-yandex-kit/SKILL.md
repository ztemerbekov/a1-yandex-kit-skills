---
name: a1-yandex-kit
description: "Core guide to the Yandex KIT e-commerce API (kit.yandex.ru store builder): authentication, base URL, rate limits, error contract, pagination and offline spec search/validation scripts. Use when a task involves the Yandex KIT API and no domain skill (catalog, orders, promotions, store, webhooks) clearly fits, or when you need auth, limits or error-handling basics."
compatibility: "Requires Node.js >= 20"
metadata:
  author: Aleksandr Kovalko
  version: "1.3.0"
---

# A1 Yandex KIT Skills

## Communication

Before producing any user-facing message, read and apply
[`references/merchant-communication.md`](references/merchant-communication.md)
completely.

Yandex KIT (kit.yandex.ru, beta) is Yandex's e-commerce store builder — effectively a
Russian Shopify. Its REST API is a server-to-server layer for syncing catalog, stocks and
prices and for managing orders between a merchant's backend and the platform. The official
docs are in Russian; the full OpenAPI spec (160 operations) is bundled with this skill in
`data/kit_v1.json.gz` and searchable offline with the scripts below.

## API essentials

- **Base URL**: `https://api.kit.yandex.net`, every path is prefixed with `/v1/`.
- **Auth**: `Authorization: Bearer <token>` (plain HTTP Bearer, not OAuth). The token is
  generated in the merchant cabinet: **Settings → API → Generate token** — it is shown
  **only once**, store it securely and generate a new one if lost.
- **Rate limit**: 3 requests per second per store, no quota headers. Exceeding it returns
  code `LIMIT_EXCEEDED` with **HTTP 400 (not 429)** — throttle client-side and detect the
  error by its `code`, not by the status.
- **Error contract**: every error is JSON `{"code", "message", "trace_id"}`. Codes:
  `AUTHENTICATION_ERROR` (401), `FORBIDDEN_ERROR` (403), `VALIDATION_ERROR` (400),
  `LIMIT_EXCEEDED` (400), `UNSUPPORTED_MEDIA_TYPE` (415), `NOT_FOUND` (404),
  `CONFLICT` (409), `UNKNOWN_ERROR` (500). Quote `trace_id` when contacting support.
- **Datetimes**: everything is UTC.
- **No sandbox**: production only — prefer read-only calls while exploring and
  double-check every write.
- **Pagination**: list endpoints take `page` + `per_page` (max 100) query parameters.
- **Content types**: request bodies are `application/json`, except the 5 operations
  that use JSON Merge Patch (`application/merge-patch+json`): `UpdateCategory`, `UpdateCharacteristic`, `UpdateVariant`, `UpdateVariantAttachment`, `UpdateWarehouse` — send only the fields to change.
  `null` clears a field only where the schema marks it nullable — of these, that is
  just `parent_id` and `file_id` of `UpdateCategory`; elsewhere `null` fails
  validation (`validate.mjs` below will catch it). `POST /v1/files` (`UploadFile`)
  and `POST /v1/videos` (`UploadVideo`) are `multipart/form-data`.
- **Bulk writes**: `BulkUpdatePrices` and `BulkUpdateStocks` take up to 5000 items per
  request and are atomic — a single invalid item rejects the whole batch (400) and applies
  nothing. Prefer them over per-variant updates for catalog syncs.

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

   - prefer the bundled `mcp-yandex-kit` MCP server: a curated tool when one exists (see the domain skills), otherwise the meta trio below;
   - any operation without a dedicated tool: the `kit_request` MCP tool — it validates
     the body against the same schema before sending;
   - or plain HTTP:
     `curl -H "Authorization: Bearer $YANDEX_KIT_TOKEN" https://api.kit.yandex.net/v1/...`
     (mind the 3 rps limit).

## Domain skills

Prefer the focused skill when the task clearly belongs to one domain — each bundles the
same scripts and data, plus the endpoint tables of its tags:

- `a1-yandex-kit-catalog` — products, variants (SKUs, prices, stocks, bulk price/stock
  sync), categories, characteristics (groups, colors), videos, collections, context
  collections, badges.
- `a1-yandex-kit-orders` — orders, customers, gift cards, additional services (addons).
- `a1-yandex-kit-promotions` — discounts, promo codes, promocode groups, gifts.
- `a1-yandex-kit-store` — store profile, warehouses, users, geo, files, redirects,
  blog/news, alerts.
- `a1-yandex-kit-webhooks` — webhooks: order events, HTTPS callbacks, signing secret.

## Related MCP tools

The bundled `mcp-yandex-kit` MCP server exposes **70 tools**. Curated tools
cover the everyday catalog/orders/promotions/store/webhooks workflows (they are listed
in the domain skills); the meta trio below reaches **all 160 operations**:

- `search_operations` — Search the full catalog of all 160 Yandex KIT API operations by keyword.
- `get_operation_schema` — Get full metadata for one KIT API operation by operationId: HTTP method, path, path/query parameters, request content type, pagination info, and the fully dereferenced JSON schemas of the request body and response.
- `kit_request` — Escape hatch that executes ANY of the 160 Yandex KIT API operations by operationId, including operations without a dedicated tool.
