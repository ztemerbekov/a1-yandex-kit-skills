import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { KitValidationError, validateRequestBody, type KitClient } from "yandex-kit-core";

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
  validationFailure,
  withCoverage,
} from "../util.js";

export function registerProductTools(server: McpServer, client: KitClient): void {
  server.registerTool(
    "list_products",
    {
      title: "List products",
      description:
        "List product records (paginated); for export requests, use this for explicit raw " +
        "product-group or catalog-structure dumps. " +
        "Ordinary catalog exports use list_variants: a product carries grouping and category " +
        "data, not a sellable name, SKU, price or stock. format:\"csv\" defaults to top-level " +
        "scalar fields (currently id and group_id) and " +
        "does not flatten variant data. " +
        COVERAGE_DESCRIPTION,
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
          .describe(
            "Fetch pages via auto-pagination, up to 500 items; inspect coverage and continue with " +
            "explicit page reads if coverage is partial; ignores page/per_page.",
          ),
        format: z.enum(["csv"]).optional().describe(CSV_FORMAT_DESCRIPTION),
        fields: z.array(z.string()).min(1).optional().describe(CSV_FIELDS_DESCRIPTION),
      },
    },
    async ({ page, per_page, all, format, fields }) => {
      try {
        const perPage = clampPerPage(per_page);
        const data = all
          ? withCoverage({ all: await client.listAll("GetProducts") })
          : withCoverage({
              page: await client.call("GetProducts", { query: { page, per_page: perPage } }),
              operationId: "GetProducts",
              perPage,
              pageNumber: page ?? 1,
            });
        return csvListResult("GetProducts", data, format, fields) ?? ok(data);
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
        return emptyUpdateFailure();
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

  server.registerTool(
    "bulk_update_card_slugs",
    {
      title: "Bulk update product card slugs",
      description:
        "Change the URL identifier (slug) of up to 100 product cards in one synchronous, atomic " +
        "request — the only way to change a card's storefront URL (update_variant has no slug " +
        "field). Address cards by product_card_id, read from Variant.product_card_id " +
        "(get_variant/list_variants) — NOT a product id. No field returns the card slug: Variant.slug " +
        "is the variant's own slug and does not change; verify the write by re-reading " +
        "relative_link_url, which carries the new slug immediately. If a " +
        "single item is invalid (card not found, card listed twice, slug malformed, repeated in " +
        "the batch or already taken by another card) the whole request is rejected with 400 and " +
        "NOTHING is applied; the response `errors` list names every offending card " +
        "(product_card_id + code: PRODUCT_CARD_NOT_FOUND, DUPLICATE_ITEM, INVALID_SLUG, " +
        "DUPLICATE_SLUG, SLUG_ALREADY_TAKEN). Old links keep working after the change. Do not " +
        "assemble the new URL from the slug: read the storefront link from relative_link_url " +
        "(list_variant_links), which follows the store's URL rules. Success returns {\"ok\":true}.",
      inputSchema: {
        items: z
          .array(
            z.object({
              product_card_id: z
                .string()
                .describe(
                  "Product card ID (UUID) from Variant.product_card_id — not the product id. " +
                    "Must not repeat within a batch.",
                ),
              slug: z
                .string()
                .min(1)
                .max(200)
                .regex(/^[a-z0-9_-]+$/)
                .describe(
                  "New URL identifier: 1-200 chars of lowercase Latin letters, digits, '-' and " +
                    "'_' (e.g. \"iphone-15-pro-black\"). Must be unique within the batch and not " +
                    "taken by another card.",
                ),
            }),
          )
          .min(1)
          .max(100)
          .describe("Slug updates, 1-100 items, one entry per product card."),
      },
    },
    async ({ items }) => {
      const repeatedCards = repeated(items.map((item) => item.product_card_id));
      if (repeatedCards.length > 0) {
        // The API rejects the entire batch for a repeated card; catch it here.
        return fail(
          new KitValidationError(
            `Each product card may appear only once in a batch; repeated: ${repeatedCards.join(", ")}.`,
            [],
            "DUPLICATE_PRODUCT_CARD_ID",
          ),
        );
      }
      const repeatedSlugs = repeated(items.map((item) => item.slug));
      if (repeatedSlugs.length > 0) {
        return fail(
          new KitValidationError(
            `Each slug may appear only once in a batch; repeated: ${repeatedSlugs.join(", ")}.`,
            [],
            "DUPLICATE_SLUG",
          ),
        );
      }
      const body = {
        items: items.map((item) => ({ product_card_id: item.product_card_id, slug: item.slug })),
      };
      const check = validateRequestBody("BulkUpdateProductCardSlugs", body);
      if (!check.valid) return validationFailure(check.errors);
      try {
        return ok(await client.call("BulkUpdateProductCardSlugs", { body }));
      } catch (e) {
        return fail(e);
      }
    },
  );
}

/** Values that occur more than once, in first-repeat order. */
function repeated(values: string[]): string[] {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) dupes.add(value);
    seen.add(value);
  }
  return [...dupes];
}
