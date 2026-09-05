import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { validateRequestBody, type KitClient } from "yandex-kit-core";

import {
  clampPerPage,
  COVERAGE_DESCRIPTION,
  CSV_FIELDS_DESCRIPTION,
  CSV_FORMAT_DESCRIPTION,
  csvListResult,
  emptyUpdateFailure,
  fail,
  ok,
  READ_ONLY,
  REDACT_PARAM_DESCRIPTION,
  redactPii,
  validationFailure,
  withCoverage,
} from "../util.js";

export function registerCustomerTools(server: McpServer, client: KitClient): void {
  server.registerTool(
    "list_customers",
    {
      title: "List customers",
      description: "List customers of the store (paginated). " + COVERAGE_DESCRIPTION,
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
          ? withCoverage({ all: await client.listAll("GetCustomers") })
          : withCoverage({
              page: await client.call("GetCustomers", { query: { page, per_page: perPage } }),
              operationId: "GetCustomers",
              perPage,
            });
        const out = redact ? redactPii(data) : data;
        return csvListResult("GetCustomers", out, format, fields) ?? ok(out);
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
        redact: z.boolean().optional().describe(REDACT_PARAM_DESCRIPTION),
      },
    },
    async ({ id, redact }) => {
      try {
        const data = await client.call("GetCustomerById", { pathParams: { customer_id: id } });
        return ok(redact ? redactPii(data) : data);
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
      description:
        "List order IDs of a customer by their customer ID (paginated). " + COVERAGE_DESCRIPTION,
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
        const perPage = clampPerPage(per_page);
        return ok(
          withCoverage({
            page: await client.call("GetOrdersByCustomerId", {
              pathParams: { customer_id: id },
              query: { page, per_page: perPage },
            }),
            operationId: "GetOrdersByCustomerId",
            perPage,
          }),
        );
      } catch (e) {
        return fail(e);
      }
    },
  );
}
