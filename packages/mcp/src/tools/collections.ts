import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { validateRequestBody, type KitClient } from "yandex-kit-core";

import { clampPerPage, DESTRUCTIVE, emptyUpdateFailure, fail, ok, READ_ONLY, validationFailure } from "../util.js";

// The API requires the status filter on GetCollections; default to all statuses.
const ALL_STATUSES = ["ACTIVE", "INACTIVE"] as const;

export function registerCollectionTools(server: McpServer, client: KitClient): void {
  server.registerTool(
    "list_collections",
    {
      title: "List collections",
      description:
        "List collections of the store (paginated). A collection is a curated set of product " +
        "cards: STATIC (filled manually via manage_collection_cards) or DYNAMIC (filled by filters).",
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
          .optional()
          .describe("Filter by collection status (default: both ACTIVE and INACTIVE)."),
        type: z
          .array(z.enum(["STATIC", "DYNAMIC"]))
          .optional()
          .describe("Filter by collection type."),
      },
    },
    async ({ page, per_page, all, status, type }) => {
      const filters = { status: status ?? ALL_STATUSES, type };
      try {
        if (all) {
          return ok(await client.listAll("GetCollections", { query: filters }, { maxItems: 500 }));
        }
        return ok(
          await client.call("GetCollections", {
            query: { page, per_page: clampPerPage(per_page), ...filters },
          }),
        );
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "get_collection",
    {
      title: "Get collection",
      description: "Get a single collection by its ID (title, slug, status, type, SEO fields).",
      annotations: READ_ONLY,
      inputSchema: {
        id: z.string().describe("Collection ID (UUID)."),
      },
    },
    async ({ id }) => {
      try {
        return ok(await client.call("GetCollectionById", { pathParams: { collection_id: id } }));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "create_collection",
    {
      title: "Create collection",
      description:
        "Create a new collection. Required: title, status (ACTIVE|INACTIVE) and collection_type " +
        "(STATIC|DYNAMIC; DYNAMIC also takes a dynamic_filter). " +
        'Call get_operation_schema("CreateCollection") for the exact request shape.',
      inputSchema: {
        collection: z
          .record(z.unknown())
          .describe(
            "Collection record matching the CreateCollectionRequest schema " +
              '(see get_operation_schema("CreateCollection")). Required: title, status, collection_type.',
          ),
      },
    },
    async ({ collection }) => {
      const check = validateRequestBody("CreateCollection", collection);
      if (!check.valid) return validationFailure(check.errors);
      try {
        return ok(await client.call("CreateCollection", { body: collection }));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "update_collection",
    {
      title: "Update collection",
      description:
        "Update an existing collection (plain JSON PATCH; only the provided fields are changed). " +
        "The collection type itself cannot be changed. " +
        'Call get_operation_schema("UpdateCollection") for the exact request shape.',
      inputSchema: {
        id: z.string().describe("Collection ID (UUID)."),
        collection: z
          .record(z.unknown())
          .describe(
            "Fields to update, matching the UpdateCollectionRequest schema " +
              '(see get_operation_schema("UpdateCollection")). Must not be empty.',
          ),
      },
    },
    async ({ id, collection }) => {
      if (Object.keys(collection).length === 0) {
        return emptyUpdateFailure();
      }
      const check = validateRequestBody("UpdateCollection", collection);
      if (!check.valid) return validationFailure(check.errors);
      try {
        return ok(
          await client.call("UpdateCollection", {
            pathParams: { collection_id: id },
            body: collection,
          }),
        );
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "delete_collection",
    {
      title: "Delete collection",
      description: "Permanently delete a collection by its ID. This cannot be undone.",
      annotations: DESTRUCTIVE,
      inputSchema: {
        id: z.string().describe("Collection ID (UUID)."),
      },
    },
    async ({ id }) => {
      try {
        return ok(await client.call("DeleteCollectionById", { pathParams: { collection_id: id } }));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "manage_collection_cards",
    {
      title: "Add or remove collection cards",
      description:
        "Add product cards to a STATIC collection or remove them from it. " +
        "Requires product_card_ids (array of product card UUIDs).",
      inputSchema: {
        id: z.string().describe("Collection ID (UUID)."),
        action: z.enum(["add", "remove"]).describe("Whether to add or remove the cards."),
        cards: z
          .record(z.unknown())
          .describe(
            'Request body with product_card_ids, e.g. {"product_card_ids": ["<uuid>", ...]}. ' +
              'See get_operation_schema("AddCardsToCollection").',
          ),
      },
    },
    async ({ id, action, cards }) => {
      const operationId = action === "add" ? "AddCardsToCollection" : "RemoveCardsFromCollection";
      const check = validateRequestBody(operationId, cards);
      if (!check.valid) return validationFailure(check.errors);
      try {
        return ok(
          await client.call(operationId, { pathParams: { collection_id: id }, body: cards }),
        );
      } catch (e) {
        return fail(e);
      }
    },
  );
}
