import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { validateRequestBody, type KitClient } from "yandex-kit-core";

import { clampPerPage, emptyUpdateFailure, fail, ok, READ_ONLY, validationFailure } from "../util.js";

export function registerCustomerTools(server: McpServer, client: KitClient): void {
  server.registerTool(
    "list_customers",
    {
      title: "List customers",
      description: "List customers of the store (paginated).",
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
        if (all) return ok(await client.listAll("GetCustomers"));
        return ok(
          await client.call("GetCustomers", {
            query: { page, per_page: clampPerPage(per_page) },
          }),
        );
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "get_customer",
    {
      title: "Get customer",
      description: "Get a single customer by their ID.",
      annotations: READ_ONLY,
      inputSchema: {
        id: z.string().describe("Customer ID (UUID)."),
      },
    },
    async ({ id }) => {
      try {
        return ok(await client.call("GetCustomerById", { pathParams: { customer_id: id } }));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "update_customer",
    {
      title: "Update customer",
      description:
        "Update a customer (plain JSON PATCH). Updatable fields: note, first_name, last_name, email. " +
        'Call get_operation_schema("UpdateCustomer") for the exact request shape.',
      inputSchema: {
        id: z.string().describe("Customer ID (UUID)."),
        customer: z
          .record(z.unknown())
          .describe(
            "Fields to update, matching the UpdateCustomerRequest schema " +
              '(see get_operation_schema("UpdateCustomer")). Must not be empty.',
          ),
      },
    },
    async ({ id, customer }) => {
      if (Object.keys(customer).length === 0) {
        return emptyUpdateFailure();
      }
      const check = validateRequestBody("UpdateCustomer", customer);
      if (!check.valid) return validationFailure(check.errors);
      try {
        return ok(
          await client.call("UpdateCustomer", { pathParams: { customer_id: id }, body: customer }),
        );
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "get_customer_orders",
    {
      title: "Get customer orders",
      description: "List order IDs of a customer by their customer ID (paginated).",
      annotations: READ_ONLY,
      inputSchema: {
        id: z.string().describe("Customer ID (UUID)."),
        page: z.number().int().min(1).optional().describe("Page number, starting at 1 (default 1)."),
        per_page: z
          .number()
          .int()
          .optional()
          .describe("Items per page, 1-100 (default 25). Values outside the range are clamped."),
      },
    },
    async ({ id, page, per_page }) => {
      try {
        return ok(
          await client.call("GetOrdersByCustomerId", {
            pathParams: { customer_id: id },
            query: { page, per_page: clampPerPage(per_page) },
          }),
        );
      } catch (e) {
        return fail(e);
      }
    },
  );
}
