import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { validateRequestBody, type KitClient } from "yandex-kit-core";

import {
  clampPerPage,
  COVERAGE_DESCRIPTION,
  emptyUpdateFailure,
  fail,
  ok,
  READ_ONLY,
  validationFailure,
  withCoverage,
} from "../util.js";

export function registerDiscountTools(server: McpServer, client: KitClient): void {
  server.registerTool(
    "list_discounts",
    {
      title: "List discounts",
      description:
        "List discounts of the store filtered by status (paginated). " +
        "The status filter is required by the API. " +
        COVERAGE_DESCRIPTION,
      annotations: READ_ONLY,
      inputSchema: {
        status: z
          .array(z.enum(["ACTIVE", "INACTIVE", "ARCHIVED"]))
          .min(1)
          .describe("Discount statuses to include (required). At least one of ACTIVE, INACTIVE, ARCHIVED."),
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
    async ({ status, page, per_page, all }) => {
      try {
        const perPage = clampPerPage(per_page);
        if (all)
          return ok(withCoverage({ all: await client.listAll("GetDiscounts", { query: { status } }) }));
        return ok(
          withCoverage({
            page: await client.call("GetDiscounts", {
              query: { page, per_page: perPage, status },
            }),
            operationId: "GetDiscounts",
            perPage,
          }),
        );
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "get_discount",
    {
      title: "Get discount",
      description:
        "Get a single discount by its ID (title, value, dates, status, binding mode).",
      annotations: READ_ONLY,
      inputSchema: {
        id: z.string().describe("Discount ID (UUID)."),
      },
    },
    async ({ id }) => {
      try {
        return ok(await client.call("GetDiscountById", { pathParams: { id } }));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "create_discount",
    {
      title: "Create discount",
      description:
        "Create a new discount. Required: title, discount_value ({value, type: PERCENT|VALUE}), " +
        "discount_dates ({start_date, optional end_date}), status (ACTIVE|INACTIVE) and " +
        "binding_mode (ALL_VARIANTS|SELECTED_VARIANTS). " +
        'Call get_operation_schema("CreateDiscount") for the exact request shape.',
      inputSchema: {
        discount: z
          .record(z.unknown())
          .describe(
            "Discount record matching the CreateDiscountRequest schema " +
              '(see get_operation_schema("CreateDiscount")). ' +
              "Required: title, discount_value, discount_dates, status, binding_mode.",
          ),
      },
    },
    async ({ discount }) => {
      const check = validateRequestBody("CreateDiscount", discount);
      if (!check.valid) return validationFailure(check.errors);
      try {
        return ok(await client.call("CreateDiscount", { body: discount }));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "update_discount",
    {
      title: "Update discount",
      description:
        "Update an existing discount (plain application/json PATCH): send only the fields to change " +
        "(title, discount_value, discount_dates, status, binding_mode). " +
        'Call get_operation_schema("UpdateDiscount") for the exact request shape.',
      inputSchema: {
        id: z.string().describe("Discount ID (UUID)."),
        discount: z
          .record(z.unknown())
          .describe(
            "Fields to update, matching the UpdateDiscountRequest schema " +
              '(see get_operation_schema("UpdateDiscount")). Must not be empty.',
          ),
      },
    },
    async ({ id, discount }) => {
      if (Object.keys(discount).length === 0) {
        return emptyUpdateFailure();
      }
      const check = validateRequestBody("UpdateDiscount", discount);
      if (!check.valid) return validationFailure(check.errors);
      try {
        return ok(await client.call("UpdateDiscount", { pathParams: { id }, body: discount }));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "discount_action",
    {
      title: "Archive or unarchive discount",
      description:
        "Archive a discount (soft delete: status becomes ARCHIVED, the discount stops applying " +
        "but stays restorable) or unarchive it (returns it to a non-archived status).",
      inputSchema: {
        id: z.string().describe("Discount ID (UUID)."),
        action: z.enum(["archive", "unarchive"]).describe("Action to perform."),
      },
    },
    async ({ id, action }) => {
      try {
        const operationId = action === "archive" ? "ArchiveDiscount" : "UnarchiveDiscount";
        return ok(await client.call(operationId, { pathParams: { id } }));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "manage_discount_objects",
    {
      title: "Add or remove discount objects",
      description:
        "Attach objects to a discount or detach them. Supported object types: " +
        "product_variant_ids (variant UUIDs), category_ids (category UUIDs), " +
        "collection_ids (collection UUIDs). Per request pass EITHER product_variant_ids " +
        "OR categories/collections — the API does not mix variants with categories/collections.",
      inputSchema: {
        id: z.string().describe("Discount ID (UUID)."),
        action: z.enum(["add", "remove"]).describe("Whether to attach or detach the objects."),
        objects: z
          .record(z.unknown())
          .describe(
            "DiscountObjects record: arrays product_variant_ids, category_ids and/or collection_ids " +
              '(see get_operation_schema("AddDiscountObjects")).',
          ),
      },
    },
    async ({ id, action, objects }) => {
      const operationId = action === "add" ? "AddDiscountObjects" : "RemoveDiscountObjects";
      const check = validateRequestBody(operationId, objects);
      if (!check.valid) return validationFailure(check.errors);
      try {
        return ok(await client.call(operationId, { pathParams: { id }, body: objects }));
      } catch (e) {
        return fail(e);
      }
    },
  );
}
