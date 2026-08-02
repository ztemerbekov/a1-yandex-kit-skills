import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { validateRequestBody, type KitClient } from "yandex-kit-core";

import {
  archiveReadUnsupportedFailure,
  clampPerPage,
  emptyUpdateFailure,
  fail,
  ok,
  READ_ONLY,
  statusesOutsideFilter,
  statusFilterIgnoredFailure,
  validationFailure,
  type ToolResult,
} from "../util.js";

/**
 * Post-check for the known KIT API defect (issue #54): the server silently
 * strips `ARCHIVED` from the GetVariants status filter, so the listing falls
 * back to the default non-archived catalog. Two observable shapes:
 * - items outside the requested filter — the filter was ignored;
 * - an empty page for a filter that includes ARCHIVED — ambiguous, so probe
 *   the unfiltered listing once: a non-empty probe proves the filter WAS
 *   honored (a stripped filter would have returned that same non-empty
 *   default listing), while an empty probe leaves the archive unprovable.
 * Returns the failure to surface instead of the response, or null when the
 * response can be trusted.
 */
async function verifyStatusFilterHonored(
  client: KitClient,
  requested: string[] | undefined,
  items: unknown[],
): Promise<ToolResult | null> {
  if (!requested || requested.length === 0) return null;
  const outside = statusesOutsideFilter(requested, items);
  if (outside.length > 0) return statusFilterIgnoredFailure(requested, outside);
  if (!requested.includes("ARCHIVED") || items.length > 0) return null;
  const probe = await client.call<{ variants?: unknown[] }>("GetVariants", {
    query: { page: 1, per_page: 1 },
  });
  const defaultListingNonEmpty = Array.isArray(probe?.variants) && probe.variants.length > 0;
  return defaultListingNonEmpty ? null : archiveReadUnsupportedFailure();
}

export function registerVariantTools(server: McpServer, client: KitClient): void {
  server.registerTool(
    "list_variants",
    {
      title: "List variants",
      description:
        "List variants (sellable items / SKUs) of the store, with optional filters (paginated). " +
        "By default the API returns variants of all statuses except ARCHIVED. " +
        "Known KIT API defect: ARCHIVED is silently stripped from the status filter, so " +
        "archived variants cannot be listed (only read by ID via get_variant); the tool " +
        "detects this and fails with STATUS_FILTER_IGNORED or ARCHIVE_READ_UNSUPPORTED " +
        "instead of returning the wrong catalog slice.",
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
        if (all) {
          const result = await client.listAll("GetVariants", { query: filters });
          const guard = await verifyStatusFilterHonored(client, status, result.items);
          return guard ?? ok(result);
        }
        const res = await client.call<{ variants?: unknown[] }>("GetVariants", {
          query: { page, per_page: clampPerPage(per_page), ...filters },
        });
        const items = Array.isArray(res?.variants) ? res.variants : [];
        const guard = await verifyStatusFilterHonored(client, status, items);
        return guard ?? ok(res);
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
        return emptyUpdateFailure();
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
