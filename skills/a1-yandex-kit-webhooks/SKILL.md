---
name: a1-yandex-kit-webhooks
description: "Manage Yandex KIT webhooks over its REST API: subscribe HTTPS endpoints to order status, payment and delivery events and handle the one-time signing secret. Use when creating, updating, validating or deleting KIT webhooks, verifying incoming calls, diagnosing missing order-status callbacks or migrating receipt-status automations."
compatibility: "Requires Node.js >= 20"
metadata:
  author: Aleksandr Kovalko
  version: "1.5.2"
---

# A1 Yandex KIT — Webhooks

## Communication

Before producing any user-facing message, read and apply
[`../a1-yandex-kit/references/merchant-communication.md`](../a1-yandex-kit/references/merchant-communication.md)
completely.

Covers the Вебхуки tag of the Yandex KIT e-commerce API: subscribing HTTPS endpoints to
order lifecycle notifications and managing those subscriptions.

Key facts:

- Callback URLs must be **HTTPS** — plain `http://` URLs are rejected.
- Exactly **three event types** exist: `ORDER_STATUS_CHANGED`,
  `ORDER_PAYMENT_STATUS_CHANGED` and `ORDER_DELIVERY_STATUS_CHANGED`.
- **`ORDER_STATUS_CHANGED` is being narrowed** (Yandex announced it; no cutoff date given):
  it will stop firing for the two receipt-technical statuses `CREATING_INITIAL_RECEIPT`
  and `CREATING_FINAL_RECEIPTS`. An integration triggered by those two events must move to
  `ORDER_PLACED` and `COMPLETED` respectively. An integration that merely stores the
  order's current status needs no change — both statuses stay in the `OrderStatus` enum
  and in `GET /v1/orders/{order_id}`; only the callback disappears.
- Creating a webhook (`CreateWebhook`) returns a signing `secret` that is shown
  **only once** — persist it immediately; it cannot be retrieved later (delete and
  recreate the webhook if lost).
- **The signature algorithm is not documented by Yandex.** Use the secret to verify that
  incoming calls are authentic, but check the KIT community chat
  (https://t.me/+f9qV8snaY1pmM2Ji) or Yandex support for the current signing scheme
  before relying on any particular construction.
- `ValidateWebhook` asks the API to POST a `WEBHOOK_VALIDATE` event to your URL — use it
  to test reachability after deploying the receiver.

For authentication (`Authorization: Bearer <token>`), the base URL (`https://api.kit.yandex.net`, all paths under `/v1/`), the 3 rps rate limit and the `{code, message, trace_id}` error contract, see the `a1-yandex-kit` skill.

## Workflow

Run the bundled scripts from this skill's directory — they are self-contained
(Node.js >= 20, builtins + a vendored validator, no `npm install`, no network).

1. **Search** for the operation you need:

   ```bash
   node scripts/search_docs.mjs "<query>" [--tag "<Тег>"] [--limit N]
   ```

   Matches operation ids, paths, tags and the Russian summaries/descriptions,
   e.g. `node scripts/search_docs.mjs "создать вебхук"`.

2. **Inspect** the full contract of one operation — path/query parameters plus the fully
   dereferenced request/response schemas:

   ```bash
   node scripts/search_docs.mjs --operation CreateWebhook
   ```

3. **Validate** a drafted request body offline before sending anything:

   ```bash
   node scripts/validate.mjs --operation CreateWebhook --body '<json>'
   # or: node scripts/validate.mjs --operation CreateWebhook --body-file body.json
   ```

   Prints `VALID` (exit 0) or the list of schema violations (exit 1).

4. **Execute** the operation:

   - prefer the matching `mcp-yandex-kit` MCP tool from «Related MCP tools» below (e.g. `create_webhook`, `validate_webhook`);
   - any operation without a dedicated tool: the `kit_request` MCP tool — it validates
     the body against the same schema before sending;
   - or plain HTTP:
     `curl -H "Authorization: Bearer $YANDEX_KIT_TOKEN" https://api.kit.yandex.net/v1/...`
     (mind the 3 rps limit).

## Endpoints (6 operations)

### Вебхуки

| Method | Path | OperationId | Summary (RU) |
| --- | --- | --- | --- |
| GET | `/v1/webhooks` | `GetWebhooks` | Получение списка вебхуков |
| POST | `/v1/webhooks` | `CreateWebhook` | Создание вебхука |
| POST | `/v1/webhooks/{webhook_id}/validate` | `ValidateWebhook` | Валидация вебхука |
| GET | `/v1/webhooks/{webhook_id}` | `GetWebhookById` | Получение вебхука по уникальному идентификатору |
| PATCH | `/v1/webhooks/{webhook_id}` | `UpdateWebhook` | Обновление вебхука |
| DELETE | `/v1/webhooks/{webhook_id}` | `DeleteWebhook` | Удаление вебхука |

## Related MCP tools

Curated `mcp-yandex-kit` tools for these tags (the server also exposes the meta trio —
`search_operations`, `get_operation_schema`, `kit_request` — reaching all
162 operations):

- `list_webhooks` — List all webhooks of the store (not paginated).
- `get_webhook` — Get a single webhook by its ID (URL, subscribed events, status).
- `create_webhook` — Create a new webhook.
- `update_webhook` — Update an existing webhook: change url (HTTPS only), the subscribed events, or set deactivate=true to switch the webhook to INACTIVE.
- `delete_webhook` — Permanently delete a webhook by its ID.
- `validate_webhook` — Trigger webhook validation: the API sends a POST with event WEBHOOK_VALIDATE to the webhook URL.
