import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { KitValidationError, validateRequestBody, type KitClient } from "yandex-kit-core";

import {
  clampPerPage,
  COVERAGE_DESCRIPTION,
  CSV_FIELDS_DESCRIPTION,
  CSV_FORMAT_DESCRIPTION,
  csvListResult,
  fail,
  ok,
  READ_ONLY,
  REDACT_PARAM_DESCRIPTION,
  redactPii,
  validationFailure,
  withCoverage,
} from "../util.js";

export function registerOrderTools(server: McpServer, client: KitClient): void {
  server.registerTool(
    "list_orders",
    {
      title: "List orders",
      description: "List orders of the store (paginated), newest first. " + COVERAGE_DESCRIPTION,
      annotations: READ_ONLY,
      inputSchema: {
        page: z.number().int().min(1).optional().describe("Page number, starting at 1 (default 1)."),
        per_page: z
          .number()
          .int()
          .optional()
          .describe("Items per page, 1-100 (default 25). Values outside the range are clamped."),
        all: z
          .boolean()
          .optional()
          .describe("Fetch all pages via auto-pagination, up to 500 items; ignores page/per_page."),
        redact: z.boolean().optional().describe(REDACT_PARAM_DESCRIPTION),
        format: z.enum(["csv"]).optional().describe(CSV_FORMAT_DESCRIPTION),
        fields: z.array(z.string()).min(1).optional().describe(CSV_FIELDS_DESCRIPTION),
      },
    },
    async ({ page, per_page, all, redact, format, fields }) => {
      try {
        const perPage = clampPerPage(per_page);
        const data = all
          ? withCoverage({ all: await client.listAll("GetOrders") })
          : withCoverage({
              page: await client.call("GetOrders", { query: { page, per_page: perPage } }),
              operationId: "GetOrders",
              perPage,
              pageNumber: page ?? 1,
            });
        const out = redact ? redactPii(data) : data;
        return csvListResult("GetOrders", out, format, fields) ?? ok(out);
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "get_order",
    {
      title: "Get order",
      description:
        "Get a single order by its ID, including line items, delivery chunks, payment and status.",
      annotations: READ_ONLY,
      inputSchema: {
        id: z.string().describe("Order ID (UUID)."),
        redact: z.boolean().optional().describe(REDACT_PARAM_DESCRIPTION),
      },
    },
    async ({ id, redact }) => {
      try {
        const data = await client.call("GetOrderById", { pathParams: { id } });
        return ok(redact ? redactPii(data) : data);
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "confirm_order",
    {
      title: "Confirm order",
      description:
        "Confirm an order. The order must be in the WAIT_FOR_CONFIRMATION status. " +
        "No request body is required.",
      inputSchema: {
        id: z.string().describe("Order ID (UUID)."),
      },
    },
    async ({ id }) => {
      try {
        return ok(await client.call("ConfirmOrder", { pathParams: { id } }));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "cancel_order",
    {
      title: "Cancel order",
      description:
        "Cancel an order. Whether cancellation is possible depends on the order's current status. " +
        "The optional owner reason is retained only in the MCP conversation/tool log; the KIT " +
        "CancelOrder endpoint has no reason field, so it is not sent to or stored by the KIT API. " +
        "No request body is required.",
      inputSchema: {
        id: z.string().describe("Order ID (UUID)."),
        reason: z
          .string()
          .min(1)
          .optional()
          .describe(
            "Owner-provided cancellation reason for conversation and tool-log context only; " +
              "it is not sent to or stored by the KIT API.",
          ),
      },
    },
    async ({ id }) => {
      try {
        return ok(await client.call("CancelOrder", { pathParams: { id } }));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "complete_order_delivery",
    {
      title: "Complete order delivery",
      description:
        "Mark the delivery of an order as fully completed. Intended for pickup and the store's own " +
        "delivery when delivery automation is off — with automation on, the platform moves the " +
        "order itself. No request body is required.",
      inputSchema: {
        id: z.string().describe("Order ID (UUID)."),
      },
    },
    async ({ id }) => {
      try {
        return ok(await client.call("CompleteOrderDelivery", { pathParams: { id } }));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "set_order_marking_codes",
    {
      title: "Set order marking codes",
      description:
        "Write «Честный знак» (Chestny ZNAK) marking codes onto order items, or remove them. " +
        "Each order item is a single unit and takes exactly one code; item IDs come from " +
        "get_order under delivery_chunks[].items[].id. Pass the code in full, including the " +
        "crypto tail; pass marking_code null to remove a previously written code. Atomic: if any " +
        "code fails the server-side check the whole request is rejected and nothing is written.",
      inputSchema: {
        id: z.string().describe("Order ID (UUID)."),
        items: z
          .array(
            z.object({
              order_item_id: z
                .string()
                .describe(
                  "Order item ID (UUID) from get_order delivery_chunks[].items[].id. " +
                    "Must not repeat within a request.",
                ),
              marking_code: z
                .string()
                .nullable()
                .describe(
                  "Full «Честный знак» marking code including the crypto tail, or null to " +
                    "remove the code written earlier.",
                ),
            }),
          )
          .min(1)
          .max(100)
          .describe("Order items with their marking codes, 1-100 items, one entry per item."),
      },
    },
    async ({ id, items }) => {
      const seen = new Set<string>();
      const duplicateSet = new Set<string>();
      for (const item of items) {
        if (seen.has(item.order_item_id)) duplicateSet.add(item.order_item_id);
        seen.add(item.order_item_id);
      }
      const duplicates = [...duplicateSet];
      if (duplicates.length > 0) {
        // The API rejects the entire request for a repeated item; catch it here
        // so the payload is not sent just to be refused.
        return fail(
          new KitValidationError(
            `Each order item may appear only once per request; repeated: ${duplicates.join(", ")}.`,
            [],
            "DUPLICATE_ORDER_ITEM_ID",
          ),
        );
      }
      const body = { items };
      const check = validateRequestBody("SetOrderMarkingCodes", body);
      if (!check.valid) return validationFailure(check.errors);
      try {
        return ok(await client.call("SetOrderMarkingCodes", { pathParams: { id }, body }));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "get_order_addons",
    {
      title: "Get order addons",
      description: "List additional services (addons) attached to an order by the order ID.",
      annotations: READ_ONLY,
      inputSchema: {
        id: z.string().describe("Order ID (UUID)."),
      },
    },
    async ({ id }) => {
      try {
        return ok(await client.call("GetOrderAddons", { pathParams: { id } }));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "get_order_payment_link",
    {
      title: "Get order payment link",
      description:
        "Get the signed payment-page link for an order, to be sent to the buyer — they can " +
        "pay without logging in. The link is permanent (the same value for the order every " +
        "time), works in any order status, never expires and cannot be revoked (revoking the " +
        "API token does not invalidate it) — hand it out deliberately. " +
        "Operation: GetOrderPaymentLink.",
      annotations: READ_ONLY,
      inputSchema: {
        id: z.string().describe("Order ID (UUID)."),
        source: z
          .string()
          .optional()
          .describe(
            "Traffic-source label: lands in the final link's `from` parameter so the store " +
              "can tell integrations apart in analytics. Defaults to `api`.",
          ),
      },
    },
    async ({ id, source }) => {
      try {
        return ok(
          await client.call("GetOrderPaymentLink", { pathParams: { id }, query: { source } }),
        );
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "generate_order_waybills",
    {
      title: "Generate order waybills",
      description:
        "Generate waybills (акты приёма-передачи отправлений) for order delivery chunks and " +
        "return links to PDF documents. Chunks are grouped by warehouse + delivery service — " +
        "one document per group. Every call asks the delivery service for a fresh document " +
        "(nothing is cached), and the PDF links are signed and expire at `expires_at` — do not " +
        "store them, re-request instead. Chunks a waybill cannot be produced for (self-pickup, " +
        "delivery not created yet, no warehouse, unsupported service) come back in `skipped` " +
        "with a reason. Chunk IDs come from get_order under delivery_chunks[].id.",
      inputSchema: {
        items: z
          .array(
            z.object({
              order_id: z.string().describe("Order ID (UUID)."),
              delivery_chunk_id: z
                .number()
                .int()
                .describe("Delivery chunk ID from get_order delivery_chunks[].id."),
            }),
          )
          .min(1)
          .max(100)
          .describe(
            "Order delivery chunks to produce waybills for, 1-100 entries; an order+chunk " +
              "pair must not repeat.",
          ),
      },
    },
    async ({ items }) => {
      const seen = new Set<string>();
      const duplicateSet = new Set<string>();
      for (const item of items) {
        const key = `${item.order_id}#${item.delivery_chunk_id}`;
        if (seen.has(key)) duplicateSet.add(key);
        seen.add(key);
      }
      const duplicates = [...duplicateSet];
      if (duplicates.length > 0) {
        // The API rejects the entire request for a repeated pair; catch it here
        // so the payload is not sent just to be refused.
        return fail(
          new KitValidationError(
            `Each order+chunk pair may appear only once per request; repeated: ${duplicates.join(", ")}.`,
            [],
            "DUPLICATE_ORDER_CHUNK",
          ),
        );
      }
      const body = { items };
      const check = validateRequestBody("GenerateOrderWaybills", body);
      if (!check.valid) return validationFailure(check.errors);
      try {
        return ok(await client.call("GenerateOrderWaybills", { body }));
      } catch (e) {
        return fail(e);
      }
    },
  );
}
