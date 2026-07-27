import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { validateRequestBody, type KitClient } from "yandex-kit-core";

import { clampPerPage, fail, ok, READ_ONLY } from "../util.js";

function validationFailure(errors: string[]) {
  return fail(new Error(`Request body failed schema validation: ${errors.join("; ")}`));
}

export function registerPromocodeTools(server: McpServer, client: KitClient): void {
  server.registerTool(
    "list_promocodes",
    {
      title: "List promocodes",
      description:
        "List promocodes of the store filtered by status (paginated). " +
        "The status filter is required by the API.",
      annotations: READ_ONLY,
      inputSchema: {
        status: z
          .enum(["ACTIVE", "INACTIVE"])
          .describe("Promocode status to include (required)."),
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
        if (all) return ok(await client.listAll("GetPromocodes", { query: { status } }));
        return ok(
          await client.call("GetPromocodes", {
            query: { page, per_page: clampPerPage(per_page), status },
          }),
        );
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "get_promocode",
    {
      title: "Get promocode",
      description:
        "Get a single promocode by its ID (code, title, discount value, dates, type, usage limits).",
      annotations: READ_ONLY,
      inputSchema: {
        id: z.string().describe("Promocode ID (UUID)."),
      },
    },
    async ({ id }) => {
      try {
        return ok(await client.call("GetPromocodeById", { pathParams: { id } }));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "create_promocode",
    {
      title: "Create promocode",
      description:
        "Create a new promocode. Required: code, title, discount_value ({value, type: PERCENT|VALUE}), " +
        "promocode_dates ({start_date, optional end_date}) and type (ORDER|PRODUCTS). " +
        "Optional: binding_mode, minimum_order_amount, max_usage, max_discount_amount, " +
        "one_time_use, first_order_only, show_in_pdp. " +
        'Call get_operation_schema("CreatePromocode") for the exact request shape.',
      inputSchema: {
        promocode: z
          .record(z.unknown())
          .describe(
            "Promocode record matching the CreatePromocodeRequest schema " +
              '(see get_operation_schema("CreatePromocode")). ' +
              "Required: code, title, discount_value, promocode_dates, type.",
          ),
      },
    },
    async ({ promocode }) => {
      const check = validateRequestBody("CreatePromocode", promocode);
      if (!check.valid) return validationFailure(check.errors);
      try {
        return ok(await client.call("CreatePromocode", { body: promocode }));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "update_promocode",
    {
      title: "Update promocode",
      description:
        "Update an existing promocode (plain application/json PATCH): send only the fields to change " +
        "(code, title, discount_value, promocode_dates, status, binding_mode, limits). " +
        'Call get_operation_schema("UpdatePromocode") for the exact request shape.',
      inputSchema: {
        id: z.string().describe("Promocode ID (UUID)."),
        promocode: z
          .record(z.unknown())
          .describe(
            "Fields to update, matching the UpdatePromocodeRequest schema " +
              '(see get_operation_schema("UpdatePromocode")). Must not be empty.',
          ),
      },
    },
    async ({ id, promocode }) => {
      if (Object.keys(promocode).length === 0) {
        return fail(new Error("Update body must not be empty: provide at least one field to change."));
      }
      const check = validateRequestBody("UpdatePromocode", promocode);
      if (!check.valid) return validationFailure(check.errors);
      try {
        return ok(await client.call("UpdatePromocode", { pathParams: { id }, body: promocode }));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "manage_promocode_objects",
    {
      title: "Add or remove promocode objects",
      description:
        "Attach objects to a promocode or detach them. Supported object types: " +
        "product_variant_ids (variant UUIDs), category_ids (category UUIDs), " +
        "collection_ids (collection UUIDs). Per request pass EITHER product_variant_ids " +
        "OR categories/collections — the API does not mix variants with categories/collections.",
      inputSchema: {
        id: z.string().describe("Promocode ID (UUID)."),
        action: z.enum(["add", "remove"]).describe("Whether to attach or detach the objects."),
        objects: z
          .record(z.unknown())
          .describe(
            "PromocodeObjects record: arrays product_variant_ids, category_ids and/or collection_ids " +
              '(see get_operation_schema("AddPromocodeObjects")).',
          ),
      },
    },
    async ({ id, action, objects }) => {
      const operationId = action === "add" ? "AddPromocodeObjects" : "RemovePromocodeObjects";
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
