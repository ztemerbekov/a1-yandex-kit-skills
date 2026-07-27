import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { validateRequestBody, type KitClient } from "yandex-kit-core";

import { clampPerPage, fail, ok, READ_ONLY } from "../util.js";

function validationFailure(errors: string[]) {
  return fail(new Error(`Request body failed schema validation: ${errors.join("; ")}`));
}

export function registerVariantTools(server: McpServer, client: KitClient): void {
  server.registerTool(
    "list_variants",
    {
      title: "List variants",
      description:
        "List variants (sellable items / SKUs) of the store, with optional filters (paginated). " +
        "By default the API returns variants of all statuses except ARCHIVED.",
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
        product_id: z.string().optional().describe("Filter by parent product ID (UUID)."),
        status: z
          .array(z.enum(["PUBLISHED", "HIDDEN", "ARCHIVED"]))
          .optional()
          .describe("Filter by variant status."),
        name: z
          .string()
          .optional()
          .describe("Case-insensitive partial search by name, SKU, barcode or KIT ID."),
      },
    },
    async ({ page, per_page, all, product_id, status, name }) => {
      const filters = { product_id, status, name };
      try {
        if (all) return ok(await client.listAll("GetVariants", { query: filters }));
        return ok(
          await client.call("GetVariants", {
            query: { page, per_page: clampPerPage(per_page), ...filters },
          }),
        );
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "get_variant",
    {
      title: "Get variant",
      description: "Get a single variant by its ID (name, SKU, pricing, stocks, media, status).",
      annotations: READ_ONLY,
      inputSchema: {
        id: z.string().describe("Variant ID (UUID)."),
      },
    },
    async ({ id }) => {
      try {
        return ok(await client.call("GetVariantById", { pathParams: { id } }));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "create_variant",
    {
      title: "Create variant",
      description:
        "Create a new variant (sellable item) under an existing product. Required: name and product_id. " +
        'Call get_operation_schema("CreateVariant") for the exact request shape (pricing, stocks, media, ...).',
      inputSchema: {
        variant: z
          .record(z.unknown())
          .describe(
            "Variant record matching the CreateVariantRequest schema " +
              '(see get_operation_schema("CreateVariant")). Required: name, product_id.',
          ),
      },
    },
    async ({ variant }) => {
      const check = validateRequestBody("CreateVariant", variant);
      if (!check.valid) return validationFailure(check.errors);
      try {
        return ok(await client.call("CreateVariant", { body: variant }));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "update_variant",
    {
      title: "Update variant",
      description:
        "Update an existing variant via JSON Merge Patch: send only the fields to change " +
        "(e.g. pricing or stocks); set a field to null to remove it. " +
        'Call get_operation_schema("UpdateVariant") for the exact request shape.',
      inputSchema: {
        id: z.string().describe("Variant ID (UUID)."),
        variant: z
          .record(z.unknown())
          .describe(
            "Merge-patch record matching the UpdateVariantRequest schema " +
              '(see get_operation_schema("UpdateVariant")). Must not be empty.',
          ),
      },
    },
    async ({ id, variant }) => {
      if (Object.keys(variant).length === 0) {
        return fail(new Error("Update body must not be empty: provide at least one field to change."));
      }
      const check = validateRequestBody("UpdateVariant", variant);
      if (!check.valid) return validationFailure(check.errors);
      try {
        return ok(await client.call("UpdateVariant", { pathParams: { id }, body: variant }));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "variant_action",
    {
      title: "Archive or unarchive variant",
      description:
        "Archive a variant (soft delete: status becomes ARCHIVED, item is hidden from the storefront " +
        "but restorable) or unarchive it (status becomes HIDDEN; publish it afterwards via update_variant).",
      inputSchema: {
        id: z.string().describe("Variant ID (UUID)."),
        action: z.enum(["archive", "unarchive"]).describe("Action to perform."),
      },
    },
    async ({ id, action }) => {
      try {
        const operationId = action === "archive" ? "ArchiveVariant" : "UnarchiveVariant";
        return ok(await client.call(operationId, { pathParams: { id } }));
      } catch (e) {
        return fail(e);
      }
    },
  );
}
