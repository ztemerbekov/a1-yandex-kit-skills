---
name: a1-yandex-kit-store
description: "Manage Yandex KIT store-level resources over its REST API: store profile, warehouses, users, geo regions, file uploads, redirects, blog/news posts and system alerts. Use when reading store metadata, managing warehouses or redirects, uploading files, publishing news or triaging store alerts in a Yandex KIT store."
compatibility: "Requires Node.js >= 20"
metadata:
  author: Aleksandr Kovalko
  version: "1.5.2"
---

# A1 Yandex KIT — Store

## Communication

Before producing any user-facing message, read and apply
[`../a1-yandex-kit/references/merchant-communication.md`](../a1-yandex-kit/references/merchant-communication.md)
completely.

Covers the store-level domain of the Yandex KIT e-commerce API — tags: Магазин,
Склады, Пользователи, Гео, Файлы, Редиректы, Новости, Алерты. This is where you read the store
profile and the API user, manage warehouses (variant stocks reference them; `UpdateWarehouse`
uses JSON Merge Patch), upload files (`POST /v1/files` — with `POST /v1/videos` in the
catalog domain, one of the API's two `multipart/form-data` endpoints), and maintain SEO
redirects and blog/news posts.

Alerts are the store's system-problem feed: `GET /v1/alerts` **requires** a status filter
(`ACTIVE`/`RESOLVED`) and returns `CRITICAL` before `WARNING`, newest first within a
severity. Only `WARNING` alerts can be closed by hand via
`POST /v1/alerts/{alert_id}/resolve`; an active `CRITICAL` one is rejected with 400 and
clears itself once the underlying problem is fixed.

For authentication (`Authorization: Bearer <token>`), the base URL (`https://api.kit.yandex.net`, all paths under `/v1/`), the 3 rps rate limit and the `{code, message, trace_id}` error contract, see the `a1-yandex-kit` skill.

## Workflow

Run the bundled scripts from this skill's directory — they are self-contained
(Node.js >= 20, builtins + a vendored validator, no `npm install`, no network).

1. **Search** for the operation you need:

   ```bash
   node scripts/search_docs.mjs "<query>" [--tag "<Тег>"] [--limit N]
   ```

   Matches operation ids, paths, tags and the Russian summaries/descriptions,
   e.g. `node scripts/search_docs.mjs "создать склад"`.

2. **Inspect** the full contract of one operation — path/query parameters plus the fully
   dereferenced request/response schemas:

   ```bash
   node scripts/search_docs.mjs --operation CreateWarehouse
   ```

3. **Validate** a drafted request body offline before sending anything:

   ```bash
   node scripts/validate.mjs --operation CreateWarehouse --body '<json>'
   # or: node scripts/validate.mjs --operation CreateWarehouse --body-file body.json
   ```

   Prints `VALID` (exit 0) or the list of schema violations (exit 1).

4. **Execute** the operation:

   - prefer the matching `mcp-yandex-kit` MCP tool from «Related MCP tools» below (e.g. `get_store`, `create_warehouse`);
   - any operation without a dedicated tool: the `kit_request` MCP tool — it validates
     the body against the same schema before sending;
   - or plain HTTP:
     `curl -H "Authorization: Bearer $YANDEX_KIT_TOKEN" https://api.kit.yandex.net/v1/...`
     (mind the 3 rps limit).

## Endpoints (23 operations)

### Магазин

| Method | Path | OperationId | Summary (RU) |
| --- | --- | --- | --- |
| GET | `/v1/store` | `GetStore` | Получение информации о магазине |

### Склады

| Method | Path | OperationId | Summary (RU) |
| --- | --- | --- | --- |
| GET | `/v1/warehouses` | `GetWarehouses` | Получение списка складов |
| POST | `/v1/warehouses` | `CreateWarehouse` | Создание нового склада |
| GET | `/v1/warehouses/{id}` | `GetWarehouseById` | Получение склада по ID |
| PATCH | `/v1/warehouses/{id}` | `UpdateWarehouse` | Обновление склада |
| POST | `/v1/warehouses/{id}/archive` | `ArchiveWarehouse` | Архивирование склада |
| POST | `/v1/warehouses/{id}/unarchive` | `UnarchiveWarehouse` | Восстановление склада из архива |

### Пользователи

| Method | Path | OperationId | Summary (RU) |
| --- | --- | --- | --- |
| GET | `/v1/users/current` | `GetCurrentUser` | Получение текущего пользователя |

### Гео

| Method | Path | OperationId | Summary (RU) |
| --- | --- | --- | --- |
| GET | `/v1/geo/regions` | `GetRegions` | Получение списка регионов |

### Файлы

| Method | Path | OperationId | Summary (RU) |
| --- | --- | --- | --- |
| POST | `/v1/files` | `UploadFile` | Загрузка файла |
| GET | `/v1/files/{id}` | `GetFileById` | Получение файла по ID |

### Редиректы

| Method | Path | OperationId | Summary (RU) |
| --- | --- | --- | --- |
| GET | `/v1/redirects` | `GetRedirects` | Получение списка редиректов |
| POST | `/v1/redirects` | `CreateRedirect` | Создание редиректа |
| GET | `/v1/redirects/{redirect_id}` | `GetRedirectById` | Получение редиректа по ID |
| PATCH | `/v1/redirects/{redirect_id}` | `UpdateRedirect` | Обновление редиректа |
| DELETE | `/v1/redirects/{redirect_id}` | `DeleteRedirectById` | Удаление редиректа |

### Новости

| Method | Path | OperationId | Summary (RU) |
| --- | --- | --- | --- |
| GET | `/v1/blogs/{blog_id}` | `GetBlogById` | Получение новости по уникальному идентификатору |
| PATCH | `/v1/blogs/{blog_id}` | `UpdateBlog` | Обновление новости |
| DELETE | `/v1/blogs/{blog_id}` | `DeleteBlogById` | Удаление новости |
| GET | `/v1/blogs` | `GetBlogs` | Получение списка новостей |
| POST | `/v1/blogs` | `CreateBlog` | Создание новости |

### Алерты

| Method | Path | OperationId | Summary (RU) |
| --- | --- | --- | --- |
| GET | `/v1/alerts` | `GetAlerts` | Получение списка алертов |
| POST | `/v1/alerts/{alert_id}/resolve` | `ResolveAlert` | Закрытие алерта |

## Related MCP tools

Curated `mcp-yandex-kit` tools for these tags (the server also exposes the meta trio —
`search_operations`, `get_operation_schema`, `kit_request` — reaching all
162 operations):

- `get_store` — Get information about the current store (id, slug, b2c_url).
- `get_current_user` — Get the user that owns the API token.
- `get_regions` — Get the list of geographic regions (countries, regions, cities).
- `list_warehouses` — List warehouses of the store (paginated).
- `get_warehouse` — Get a single warehouse by its ID (title, slug, status).
- `create_warehouse` — Create a new warehouse.
- `update_warehouse` — Update an existing warehouse via JSON Merge Patch: send only the fields to change; setting a field to null removes it.
- `warehouse_action` — Archive a warehouse (soft delete: status becomes ARCHIVED, warehouse can no longer be used for stock) or unarchive it (status becomes ACTIVE again).
- `upload_file` — Upload a file (e.g. an image for a variant or collection) via multipart/form-data.
- `get_file` — Get metadata of a previously uploaded file by its ID (name, size, URL).
- `list_blogs` — List store news articles (paginated).
- `get_blog` — Get one store news article by ID.
- `create_blog` — Create a store news article.
- `update_blog` — Update a store news article.
- `list_alerts` — List system alerts of the store (paginated), CRITICAL ones first and newest first within the same severity.
- `resolve_alert` — Mark an alert as resolved.

Редиректы have no dedicated tools — manage them through `search_operations` + `kit_request`.
