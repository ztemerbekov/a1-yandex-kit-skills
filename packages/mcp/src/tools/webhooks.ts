import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { validateRequestBody, type KitClient } from "yandex-kit-core";

import { DESTRUCTIVE, fail, ok, READ_ONLY } from "../util.js";

function validationFailure(errors: string[]) {
  return fail(new Error(`Request body failed schema validation: ${errors.join("; ")}`));
}

export function registerWebhookTools(server: McpServer, client: KitClient): void {
  server.registerTool(
    "list_webhooks",
    {
      title: "List webhooks",
      description:
        "List all webhooks of the store (not paginated). Each webhook has a URL, " +
        "a list of subscribed event types and a status.",
      annotations: READ_ONLY,
      inputSchema: {},
    },
    async () => {
      try {
        return ok(await client.call("GetWebhooks"));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "get_webhook",
    {
      title: "Get webhook",
      description: "Get a single webhook by its ID (URL, subscribed events, status).",
      annotations: READ_ONLY,
      inputSchema: {
        id: z.string().describe("Webhook ID (UUID)."),
      },
    },
    async ({ id }) => {
      try {
        return ok(await client.call("GetWebhookById", { pathParams: { webhook_id: id } }));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "create_webhook",
    {
      title: "Create webhook",
      description:
        "Create a new webhook. The url must use HTTPS (HTTP is rejected). Allowed events: " +
        "ORDER_STATUS_CHANGED, ORDER_PAYMENT_STATUS_CHANGED, ORDER_DELIVERY_STATUS_CHANGED. " +
        "IMPORTANT: the response contains the signing secret — it is shown ONLY ONCE, store it " +
        'securely. Call get_operation_schema("CreateWebhook") for the exact request shape.',
      inputSchema: {
        webhook: z
          .record(z.unknown())
          .describe(
            "Webhook record matching the CreateWebhookRequest schema " +
              '(see get_operation_schema("CreateWebhook")). Required: url (HTTPS only), events.',
          ),
      },
    },
    async ({ webhook }) => {
      const check = validateRequestBody("CreateWebhook", webhook);
      if (!check.valid) return validationFailure(check.errors);
      try {
        return ok(await client.call("CreateWebhook", { body: webhook }));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "update_webhook",
    {
      title: "Update webhook",
      description:
        "Update an existing webhook: change url (HTTPS only), the subscribed events, or set " +
        "deactivate=true to switch the webhook to INACTIVE. " +
        'Call get_operation_schema("UpdateWebhook") for the exact request shape.',
      inputSchema: {
        id: z.string().describe("Webhook ID (UUID)."),
        webhook: z
          .record(z.unknown())
          .describe(
            "Fields to update, matching the UpdateWebhookRequest schema " +
              '(see get_operation_schema("UpdateWebhook")). Must not be empty.',
          ),
      },
    },
    async ({ id, webhook }) => {
      if (Object.keys(webhook).length === 0) {
        return fail(new Error("Update body must not be empty: provide at least one field to change."));
      }
      const check = validateRequestBody("UpdateWebhook", webhook);
      if (!check.valid) return validationFailure(check.errors);
      try {
        return ok(await client.call("UpdateWebhook", { pathParams: { webhook_id: id }, body: webhook }));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "delete_webhook",
    {
      title: "Delete webhook",
      description: "Permanently delete a webhook by its ID. This cannot be undone.",
      annotations: DESTRUCTIVE,
      inputSchema: {
        id: z.string().describe("Webhook ID (UUID)."),
      },
    },
    async ({ id }) => {
      try {
        return ok(await client.call("DeleteWebhook", { pathParams: { webhook_id: id } }));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "validate_webhook",
    {
      title: "Validate webhook",
      description:
        "Trigger webhook validation: the API sends a POST with event WEBHOOK_VALIDATE to the " +
        "webhook URL. With activate=true, the webhook becomes ACTIVE if the server replies " +
        'HTTP 2xx with body {"message": "validated_store_{store_id}"} (store_id: see get_store).',
      inputSchema: {
        id: z.string().describe("Webhook ID (UUID)."),
        activate: z
          .boolean()
          .optional()
          .describe("Activate the webhook after successful validation (default false)."),
      },
    },
    async ({ id, activate }) => {
      try {
        return ok(
          await client.call("ValidateWebhook", {
            pathParams: { webhook_id: id },
            query: { activate },
          }),
        );
      } catch (e) {
        return fail(e);
      }
    },
  );
}
