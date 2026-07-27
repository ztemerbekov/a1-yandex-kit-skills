import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { type KitClient } from "yandex-kit-core";

import { clampPerPage, fail, ok, READ_ONLY } from "../util.js";

export function registerOrderTools(server: McpServer, client: KitClient): void {
  server.registerTool(
    "list_orders",
    {
      title: "List orders",
      description: "List orders of the store (paginated), newest first.",
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
      },
    },
    async ({ page, per_page, all }) => {
      try {
        if (all) return ok(await client.listAll("GetOrders"));
        return ok(
          await client.call("GetOrders", {
            query: { page, per_page: clampPerPage(per_page) },
          }),
        );
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
      },
    },
    async ({ id }) => {
      try {
        return ok(await client.call("GetOrderById", { pathParams: { id } }));
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
        "No request body is required.",
      inputSchema: {
        id: z.string().describe("Order ID (UUID)."),
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
