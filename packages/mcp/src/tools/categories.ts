import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { validateRequestBody, type KitClient } from "yandex-kit-core";

import { clampPerPage, emptyUpdateFailure, fail, ok, READ_ONLY, validationFailure } from "../util.js";

export function registerCategoryTools(server: McpServer, client: KitClient): void {
  server.registerTool(
    "list_categories",
    {
      title: "List categories",
      description:
        "List product categories of the store (paginated). The API requires a status filter; " +
        "defaults to ACTIVE when not provided.",
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
        status: z
          .array(z.enum(["ACTIVE", "ARCHIVED"]))
          .optional()
          .describe("Filter by category status (default: [ACTIVE])."),
      },
    },
    async ({ page, per_page, all, status }) => {
      // The status query parameter is required by the API.
      const filters = { status: status ?? ["ACTIVE"] };
      try {
        if (all) return ok(await client.listAll("GetCategories", { query: filters }));
        return ok(
          await client.call("GetCategories", {
            query: { page, per_page: clampPerPage(per_page), ...filters },
          }),
        );
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "get_category",
    {
      title: "Get category",
      description: "Get a single product category by its ID.",
      annotations: READ_ONLY,
      inputSchema: {
        id: z.string().describe("Category ID (UUID)."),
      },
    },
    async ({ id }) => {
      try {
        return ok(await client.call("GetCategoryById", { pathParams: { id } }));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "create_category",
    {
      title: "Create category",
      description:
        "Create a new product category. Required: title. Optional: slug, parent_id, display_sequence, " +
        'is_hidden_in_menu, file_id, seo_title, seo_description. Call get_operation_schema("CreateCategory") ' +
        "for the exact request shape.",
      inputSchema: {
        category: z
          .record(z.unknown())
          .describe(
            "Category record matching the CreateCategoryRequest schema " +
              '(see get_operation_schema("CreateCategory")). Required: title.',
          ),
      },
    },
    async ({ category }) => {
      const check = validateRequestBody("CreateCategory", category);
      if (!check.valid) return validationFailure(check.errors);
      try {
        return ok(await client.call("CreateCategory", { body: category }));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "update_category",
    {
      title: "Update category",
      description:
        "Update an existing category via JSON Merge Patch: send only the fields to change. " +
        "Only parent_id and file_id accept null (parent_id: null makes the category " +
        "top-level, file_id: null removes the image); null on any other field is rejected " +
        'by validation. Call get_operation_schema("UpdateCategory") for the exact request shape.',
      inputSchema: {
        id: z.string().describe("Category ID (UUID)."),
        category: z
          .record(z.unknown())
          .describe(
            "Merge-patch record matching the UpdateCategoryRequest schema " +
              '(see get_operation_schema("UpdateCategory")). Must not be empty.',
          ),
      },
    },
    async ({ id, category }) => {
      if (Object.keys(category).length === 0) {
        return emptyUpdateFailure();
      }
      const check = validateRequestBody("UpdateCategory", category);
      if (!check.valid) return validationFailure(check.errors);
      try {
        return ok(await client.call("UpdateCategory", { pathParams: { id }, body: category }));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "category_action",
    {
      title: "Archive or unarchive category",
      description:
        "Archive a category (soft delete: hidden from the storefront, restorable) or unarchive it. " +
        "If the category is the only one of a product with non-archived variants, archiving requires " +
        "archive_variants=true.",
      inputSchema: {
        id: z.string().describe("Category ID (UUID)."),
        action: z.enum(["archive", "unarchive"]).describe("Action to perform."),
        archive_variants: z
          .boolean()
          .optional()
          .describe("Archive only: also archive the variants left without any active category."),
      },
    },
    async ({ id, action, archive_variants }) => {
      try {
        if (action === "archive") {
          return ok(
            await client.call("ArchiveCategory", { pathParams: { id }, query: { archive_variants } }),
          );
        }
        return ok(await client.call("UnarchiveCategory", { pathParams: { id } }));
      } catch (e) {
        return fail(e);
      }
    },
  );
}
