import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { KitValidationError, validateRequestBody, type KitClient } from "yandex-kit-core";

import {
  archiveReadUnsupportedFailure,
  clampPerPage,
  emptyUpdateFailure,
  fail,
  mixedArchivedFilterFailure,
  ok,
  READ_ONLY,
  statusesOutsideFilter,
  statusFilterIgnoredFailure,
  validationFailure,
  type ToolResult,
} from "../util.js";

/**
 * The API takes decimal prices as strings, but a consumer LLM naturally sends
 * numbers; `null` is meaningful (reset the price) and must survive untouched.
 */
function normalizePrice(value: string | number | null | undefined): string | null | undefined {
  return typeof value === "number" ? String(value) : value;
}

/**
 * Post-check for the known KIT API defect (issue #54): the server silently
 * strips `ARCHIVED` from the GetVariants status filter (honoring the rest).
 * Shapes: out-of-filter items — the filter was ignored; a mixed filter with no
 * archived item in the response — indistinguishable from an honored view with
 * an empty archive, unprovable; an empty page-1 for a pure [ARCHIVED] filter —
 * disambiguated by one probe carrying the same scope (product_id/name): if the
 * scoped listing is non-empty, a stripped filter would have returned it, so
 * the empty response proves an empty archive. The proof fails for other pages
 * (an empty later page of the stripped listing is legitimate) and for an
 * unscoped probe (other products would make it non-empty).
 * Returns the failure to surface, or null when the response can be trusted.
 */
async function verifyStatusFilterHonored(
  client: KitClient,
  requested: string[] | undefined,
  scope: { product_id?: string; name?: string },
  page: number | undefined,
  items: unknown[],
): Promise<ToolResult | null> {
  if (!requested || requested.length === 0) return null;
  const outside = statusesOutsideFilter(requested, items);
  if (outside.length > 0) return statusFilterIgnoredFailure(requested, outside);
  if (!requested.includes("ARCHIVED")) return null;
  const anyArchived = items.some(
    (item) => (item as { status?: unknown } | null)?.status === "ARCHIVED",
  );
  if (anyArchived) return null; // archived items came back — the filter was honored
  if (requested.length > 1) return mixedArchivedFilterFailure(requested);
  if (items.length > 0) return null; // items without a readable status — trust as before
  if ((page ?? 1) > 1) return archiveReadUnsupportedFailure();
  const probe = await client.call<{ variants?: unknown[] }>("GetVariants", {
    query: { page: 1, per_page: 1, ...scope },
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
        "detects this and fails with STATUS_FILTER_IGNORED, ARCHIVE_READ_UNSUPPORTED or " +
        "MIXED_ARCHIVED_FILTER_UNSUPPORTED (for filters mixing ARCHIVED with other " +
        "statuses) instead of returning the wrong catalog slice.",
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
      const scope = { product_id, name };
      try {
        if (all) {
          // listAll always starts at page 1, so the probe-proof is valid.
          const result = await client.listAll("GetVariants", { query: filters });
          const guard = await verifyStatusFilterHonored(client, status, scope, 1, result.items);
          return guard ?? ok(result);
        }
        const res = await client.call<{ variants?: unknown[] }>("GetVariants", {
          query: { page, per_page: clampPerPage(per_page), ...filters },
        });
        const items = Array.isArray(res?.variants) ? res.variants : [];
        const guard = await verifyStatusFilterHonored(client, status, scope, page, items);
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
        "`media` holds images and at most ONE video: a video entry is accepted only when the same " +
        "`media` list also carries at least one image, and its video_id must already be READY " +
        "(upload_video / upload_video_from_url, then poll get_video). " +
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
        "(e.g. pricing or stocks). No field of UpdateVariantRequest is nullable, so null " +
        "values are rejected by validation before any call — to clear a price, use " +
        "bulk_update_prices (its price/manual_discount_price accept null). " +
        "`media` is an exception to merge-patch granularity: sending it REPLACES the whole list, " +
        "so resend the existing images alongside anything you add. At most ONE video per variant, " +
        "and a video is accepted only when the same list carries at least one image — sending a " +
        "video alone wipes the images and fails. `stocks` and `characteristics` replace the whole " +
        "list too; rebuild them from a fresh get_variant, which IS the complete current state " +
        "(an empty characteristics list is genuinely empty, nothing hidden). " +
        'Call get_operation_schema("UpdateVariant") for the exact request shape — but ignore its ' +
        "prose for `stocks`: upstream the spec pasted the media wording there, while the field " +
        "still takes VariantStock entries (per-warehouse quantities).",
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
    "bulk_update_prices",
    {
      title: "Bulk update prices",
      description:
        "Update prices of up to 5000 variants in one synchronous, atomic request — the fast path " +
        "for syncing a whole catalog instead of calling update_variant per item. If a single item " +
        "is invalid (variant unknown or archived, variant listed twice, price malformed, discount " +
        "price above the base price) the whole request is rejected with 400 and NOTHING is " +
        "applied; the response `errors` list names every offending variant. Both price fields are " +
        "optional per item: omit a key to keep the current value, or send null to reset it " +
        "(resetting `price` works only on unpublished variants). Changing `price` recomputes the " +
        "promo price; promo membership is refreshed in the background afterwards.",
      inputSchema: {
        items: z
          .array(
            z.object({
              variant_id: z.string().describe("Variant ID (UUID). Must not repeat within a batch."),
              price: z
                .union([z.string(), z.number()])
                .nullable()
                .optional()
                .describe(
                  "New base price (before discounts), e.g. 1000 or \"1000.00\". Omit to keep the " +
                    "current price; null resets it (unpublished variants only).",
                ),
              manual_discount_price: z
                .union([z.string(), z.number()])
                .nullable()
                .optional()
                .describe(
                  "New manually set discounted price. Must not exceed price. Omit to keep the " +
                    "current value; null clears the manual discount.",
                ),
            }),
          )
          .min(1)
          .max(5000)
          .describe("Price updates, 1-5000 items, one entry per variant."),
      },
    },
    async ({ items }) => {
      const seen = new Set<string>();
      const duplicateSet = new Set<string>();
      for (const item of items) {
        if (seen.has(item.variant_id)) duplicateSet.add(item.variant_id);
        seen.add(item.variant_id);
      }
      const duplicates = [...duplicateSet];
      if (duplicates.length > 0) {
        // The API rejects the entire batch for a repeated variant; catch it here
        // so a 5000-item payload is not sent just to be refused.
        return fail(
          new KitValidationError(
            `Each variant may appear only once in a batch; repeated: ${duplicates.join(", ")}.`,
            [],
            "DUPLICATE_VARIANT_ID",
          ),
        );
      }
      const body = {
        items: items.map((item) => ({
          variant_id: item.variant_id,
          ...("price" in item ? { price: normalizePrice(item.price) } : {}),
          ...("manual_discount_price" in item
            ? { manual_discount_price: normalizePrice(item.manual_discount_price) }
            : {}),
        })),
      };
      const check = validateRequestBody("BulkUpdatePrices", body);
      if (!check.valid) return validationFailure(check.errors);
      try {
        return ok(await client.call("BulkUpdatePrices", { body }));
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
