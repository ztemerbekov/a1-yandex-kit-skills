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
  validationFailure,
  withCoverage,
} from "../util.js";

// The API requires the status filter on GetBlogs (a call without it is a 400
// "Обязательный параметр 'status' отсутствует", live 2026-11-18); default to both statuses,
// so an unpublished article is still listed.
const ALL_STATUSES = ["ACTIVE", "INACTIVE"] as const;

export function registerBlogTools(server: McpServer, client: KitClient): void {
  server.registerTool(
    "list_blogs",
    {
      title: "List news articles",
      description:
        "List store news articles (paginated). Unpublished (INACTIVE) articles are included by " +
        "default — each item carries its status; pass status to narrow. " +
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
          .describe("Fetch all pages via auto-pagination, up to 500 items; ignores page/per_page."),
        status: z
          .array(z.enum(["ACTIVE", "INACTIVE"]))
          .min(1)
          .optional()
          .describe("Filter by article status (default: both ACTIVE and INACTIVE)."),
        format: z.enum(["csv"]).optional().describe(CSV_FORMAT_DESCRIPTION),
        fields: z.array(z.string()).min(1).optional().describe(CSV_FIELDS_DESCRIPTION),
      },
    },
    async ({ page, per_page, all, status, format, fields }) => {
      const filters = { status: status ?? ALL_STATUSES };
      try {
        const perPage = clampPerPage(per_page);
        const data = all
          ? withCoverage({ all: await client.listAll("GetBlogs", { query: filters }) })
          : withCoverage({
              page: await client.call("GetBlogs", {
                query: { page, per_page: perPage, ...filters },
              }),
              operationId: "GetBlogs",
              perPage,
              pageNumber: page ?? 1,
            });
        return csvListResult("GetBlogs", data, format, fields) ?? ok(data);
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "get_blog",
    {
      title: "Get news article",
      description: "Get one store news article by ID.",
      annotations: READ_ONLY,
      inputSchema: {
        id: z.string().describe("News article ID (UUID)."),
      },
    },
    async ({ id }) => {
      try {
        return ok(
          await client.call("GetBlogById", {
            pathParams: { blog_id: id },
          }),
        );
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "create_blog",
    {
      title: "Create news article",
      description:
        "Create a store news article. Call get_operation_schema(\"CreateBlog\") for the exact request shape.",
      inputSchema: {
        blog: z.record(z.unknown()).describe("News article matching the CreateBlog request schema."),
      },
    },
    async ({ blog }) => {
      const check = validateRequestBody("CreateBlog", blog);
      if (!check.valid) return validationFailure(check.errors);
      try {
        return ok(await client.call("CreateBlog", { body: blog }));
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "update_blog",
    {
      title: "Update news article",
      description:
        "Update a store news article. Call get_operation_schema(\"UpdateBlog\") for the exact request shape.",
      inputSchema: {
        id: z.string().describe("News article ID (UUID)."),
        blog: z.record(z.unknown()).describe("Fields matching the UpdateBlog request schema."),
      },
    },
    async ({ id, blog }) => {
      if (Object.keys(blog).length === 0) return emptyUpdateFailure();
      const check = validateRequestBody("UpdateBlog", blog);
      if (!check.valid) return validationFailure(check.errors);
      try {
        return ok(
          await client.call("UpdateBlog", {
            pathParams: { blog_id: id },
            body: blog,
          }),
        );
      } catch (error) {
        return fail(error);
      }
    },
  );
}
