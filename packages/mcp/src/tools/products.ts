import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { validateRequestBody, type KitClient } from "yandex-kit-core";

import { clampPerPage, fail, ok, READ_ONLY } from "../util.js";

function validationFailure(errors: string[]) {
  return fail(new Error(`Request body failed schema validation: ${errors.join("; ")}`));
}

export function registerProductTools(server: McpServer, client: KitClient): void {
  server.registerTool(
    "list_products",
    {
      title: "List products",
      description:
        "List products of the store (paginated). A product groups one or more variants (SKUs) " +
        "and links them to categories.",
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
        if (all) return ok(await client.listAll("GetProducts"));
        return ok(
          await client.call("GetProducts", {
            query: { page, per_page: clampPerPage(per_page) },
          }),
        );
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "get_product",
    {
      title: "Get product",
      description: "Get a single product by its ID, including its category bindings.",
      annotations: READ_ONLY,
      inputSchema: {
        id: z.string().describe("Product ID (UUID)."),
      },
    },
    async ({ id }) => {
      try {
        return ok(await client.call("GetProductById", { pathParams: { id } }));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "create_product",
    {
      title: "Create product",
      description:
        "Create a new product. Requires category_ids (array of category UUIDs, at least one). " +
        'Call get_operation_schema("CreateProduct") for the exact request shape.',
      inputSchema: {
        product: z
          .record(z.unknown())
          .describe(
            "Product record matching the CreateProductRequest schema " +
              '(see get_operation_schema("CreateProduct")). Required: category_ids.',
          ),
      },
    },
    async ({ product }) => {
      const check = validateRequestBody("CreateProduct", product);
      if (!check.valid) return validationFailure(check.errors);
      try {
        return ok(await client.call("CreateProduct", { body: product }));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "update_product",
    {
      title: "Update product",
      description:
        "Update an existing product (plain JSON PATCH, not merge-patch). " +
        "Passing category_ids fully replaces the product's category list. " +
        'Call get_operation_schema("UpdateProduct") for the exact request shape.',
      inputSchema: {
        id: z.string().describe("Product ID (UUID)."),
        product: z
          .record(z.unknown())
          .describe(
            "Fields to update, matching the UpdateProductRequest schema " +
              '(see get_operation_schema("UpdateProduct")). Must not be empty.',
          ),
      },
    },
    async ({ id, product }) => {
      if (Object.keys(product).length === 0) {
        return fail(new Error("Update body must not be empty: provide at least one field to change."));
      }
      const check = validateRequestBody("UpdateProduct", product);
      if (!check.valid) return validationFailure(check.errors);
      try {
        return ok(await client.call("UpdateProduct", { pathParams: { id }, body: product }));
      } catch (e) {
        return fail(e);
      }
    },
  );
}
