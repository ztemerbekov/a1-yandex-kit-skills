import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { validateRequestBody, type KitClient } from "yandex-kit-core";

import { clampPerPage, emptyUpdateFailure, fail, ok, READ_ONLY, validationFailure } from "../util.js";

export function registerWarehouseTools(server: McpServer, client: KitClient): void {
  server.registerTool(
    "list_warehouses",
    {
      title: "List warehouses",
      description:
        "List warehouses of the store (paginated). The API requires a status filter; " +
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
          .describe("Filter by warehouse status (default: [ACTIVE])."),
      },
    },
    async ({ page, per_page, all, status }) => {
      // The status query parameter is required by the API.
      const filters = { status: status ?? ["ACTIVE"] };
      try {
        if (all) return ok(await client.listAll("GetWarehouses", { query: filters }));
        return ok(
          await client.call("GetWarehouses", {
            query: { page, per_page: clampPerPage(per_page), ...filters },
          }),
        );
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "get_warehouse",
    {
      title: "Get warehouse",
      description: "Get a single warehouse by its ID (title, slug, status).",
      annotations: READ_ONLY,
      inputSchema: {
        id: z.string().describe("Warehouse ID (UUID)."),
      },
    },
    async ({ id }) => {
      try {
        return ok(await client.call("GetWarehouseById", { pathParams: { id } }));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "create_warehouse",
    {
      title: "Create warehouse",
      description:
        "Create a new warehouse. Required: title. The URL slug is generated automatically from " +
        'the title and cannot be changed later. Call get_operation_schema("CreateWarehouse") for ' +
        "the exact request shape.",
      inputSchema: {
        warehouse: z
          .record(z.unknown())
          .describe(
            "Warehouse record matching the CreateWarehouseRequest schema " +
              '(see get_operation_schema("CreateWarehouse")). Required: title.',
          ),
      },
    },
    async ({ warehouse }) => {
      const check = validateRequestBody("CreateWarehouse", warehouse);
      if (!check.valid) return validationFailure(check.errors);
      try {
        return ok(await client.call("CreateWarehouse", { body: warehouse }));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "update_warehouse",
    {
      title: "Update warehouse",
      description:
        "Update an existing warehouse via JSON Merge Patch: send only the fields to change; " +
        "setting a field to null removes it. The slug cannot be changed after creation. " +
        'Call get_operation_schema("UpdateWarehouse") for the exact request shape.',
      inputSchema: {
        id: z.string().describe("Warehouse ID (UUID)."),
        warehouse: z
          .record(z.unknown())
          .describe(
            "Merge-patch record matching the UpdateWarehouseRequest schema " +
              '(see get_operation_schema("UpdateWarehouse")). Must not be empty.',
          ),
      },
    },
    async ({ id, warehouse }) => {
      if (Object.keys(warehouse).length === 0) {
        return emptyUpdateFailure();
      }
      // In JSON Merge Patch null means "remove this field", which the resource schema
      // cannot express; validate only non-null fields and let the API judge removals.
      const nonNullFields = Object.fromEntries(
        Object.entries(warehouse).filter(([, value]) => value !== null),
      );
      const check = validateRequestBody("UpdateWarehouse", nonNullFields);
      if (!check.valid) return validationFailure(check.errors);
      try {
        return ok(await client.call("UpdateWarehouse", { pathParams: { id }, body: warehouse }));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "warehouse_action",
    {
      title: "Archive or unarchive warehouse",
      description:
        "Archive a warehouse (soft delete: status becomes ARCHIVED, warehouse can no longer be " +
        "used for stock) or unarchive it (status becomes ACTIVE again).",
      inputSchema: {
        id: z.string().describe("Warehouse ID (UUID)."),
        action: z.enum(["archive", "unarchive"]).describe("Action to perform."),
      },
    },
    async ({ id, action }) => {
      try {
        const operationId = action === "archive" ? "ArchiveWarehouse" : "UnarchiveWarehouse";
        return ok(await client.call(operationId, { pathParams: { id } }));
      } catch (e) {
        return fail(e);
      }
    },
  );
}
