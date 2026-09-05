import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { KitValidationError, validateRequestBody, type KitClient } from "yandex-kit-core";

import {
  clampPerPage,
  COVERAGE_DESCRIPTION,
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
      },
    },
    async ({ page, per_page, all, redact }) => {
      try {
        const perPage = clampPerPage(per_page);
        const data = all
          ? withCoverage({ all: await client.listAll("GetOrders") })
          : withCoverage({
              page: await client.call("GetOrders", { query: { page, per_page: perPage } }),
              operationId: "GetOrders",
              perPage,
            });
        return ok(redact ? redactPii(data) : data);
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
}
