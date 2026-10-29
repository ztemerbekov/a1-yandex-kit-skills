import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { validateRequestBody, type KitClient } from "yandex-kit-core";

import {
  COVERAGE_DESCRIPTION,
  DESTRUCTIVE,
  fail,
  ok,
  READ_ONLY,
  validationFailure,
  withCoverage,
} from "../util.js";

const BINDING_MODES = ["ALL_VARIANTS", "SELECTED_CARDS", "SELECTED_CATEGORIES_COLLECTIONS"] as const;

/** Documented limit of AddSimilarCardsObjects/RemoveSimilarCardsObjects; absent from the schema. */
const MAX_OBJECTS_PER_CALL = 500;

const BINDING_MODE_DESCRIPTION =
  "Similar-products binding mode: ALL_VARIANTS — every product of the store is similar; " +
  "SELECTED_CARDS — only the product cards bound via manage_similar_cards_objects; " +
  "SELECTED_CATEGORIES_COLLECTIONS — products of the bound categories and collections.";

const PRODUCT_CARD_ID_DESCRIPTION =
  "Product card ID (UUID) — the variant's product_card_id, not a product or variant ID.";

export function registerSimilarCardsTools(server: McpServer, client: KitClient): void {
  server.registerTool(
    "get_similar_cards",
    {
      title: "Get similar-products settings",
      description:
        "Get the similar-products settings of a product card: its binding_mode plus the bound " +
        "objects for that mode — product_card_ids for SELECTED_CARDS, category_ids and " +
        "collection_ids for SELECTED_CATEGORIES_COLLECTIONS, none for ALL_VARIANTS (up to 500 " +
        "IDs each). A 404 means the card has no settings yet — create them with " +
        'set_similar_cards_mode action="create". These settings are separate from the ' +
        "deprecated symmetric links of GetSimilarProductCardIDs — neither API sees the other's " +
        "bindings. " +
        COVERAGE_DESCRIPTION,
      annotations: READ_ONLY,
      inputSchema: {
        product_card_id: z.string().describe(PRODUCT_CARD_ID_DESCRIPTION),
      },
    },
    async ({ product_card_id }) => {
      try {
        const pathParams = { product_card_id };
        const settings = (await client.call("GetSimilarCardsById", { pathParams })) as {
          binding_mode?: string;
        };
        const result: Record<string, unknown> = { ...settings };
        if (settings.binding_mode === "SELECTED_CARDS") {
          result.cards = withCoverage({
            all: await client.listAll("GetSimilarCardsCardIDs", { pathParams }),
          });
        } else if (settings.binding_mode === "SELECTED_CATEGORIES_COLLECTIONS") {
          result.categories = withCoverage({
            all: await client.listAll("GetSimilarCardsCategoryIDs", { pathParams }),
          });
          result.collections = withCoverage({
            all: await client.listAll("GetSimilarCardsCollectionIDs", { pathParams }),
          });
        }
        return ok(result);
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "set_similar_cards_mode",
    {
      title: "Create or change similar-products settings",
      description:
        "Create the similar-products settings of a product card (action=\"create\"; 409 if " +
        "they already exist) or change the binding mode of existing ones (action=\"update\"; " +
        "404 if there are none — check with get_similar_cards). Changing the mode drops every " +
        "bound card, category and collection, and switching back does not restore them — read " +
        "them with get_similar_cards first and re-bind afterwards. After choosing " +
        "SELECTED_CARDS or SELECTED_CATEGORIES_COLLECTIONS, bind the objects with " +
        "manage_similar_cards_objects.",
      inputSchema: {
        product_card_id: z.string().describe(PRODUCT_CARD_ID_DESCRIPTION),
        action: z
          .enum(["create", "update"])
          .describe('"create" for a card without settings, "update" to change the mode.'),
        binding_mode: z.enum(BINDING_MODES).describe(BINDING_MODE_DESCRIPTION),
      },
    },
    async ({ product_card_id, action, binding_mode }) => {
      const operationId = action === "create" ? "CreateSimilarCards" : "UpdateSimilarCards";
      const body = { binding_mode };
      const check = validateRequestBody(operationId, body);
      if (!check.valid) return validationFailure(check.errors);
      try {
        return ok(await client.call(operationId, { pathParams: { product_card_id }, body }));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "manage_similar_cards_objects",
    {
      title: "Add or remove similar-products objects",
      description:
        "Bind objects to a product card's similar-products settings or unbind them (up to 500 " +
        "per call). product_card_ids work only in SELECTED_CARDS mode, category_ids and " +
        "collection_ids only in SELECTED_CATEGORIES_COLLECTIONS — send either cards or " +
        "categories/collections, never both. One-directional: only this card's settings " +
        "change, the listed cards get no reverse link (unlike the deprecated symmetric " +
        "AddSimilarProductCards/DeleteSimilarProductCards).",
      inputSchema: {
        product_card_id: z.string().describe(PRODUCT_CARD_ID_DESCRIPTION),
        action: z.enum(["add", "remove"]).describe("Whether to bind or unbind the objects."),
        objects: z
          .object({
            product_card_ids: z
              .array(z.string())
              .optional()
              .describe("Product card IDs (UUID) — SELECTED_CARDS mode only."),
            category_ids: z
              .array(z.string())
              .optional()
              .describe("Category IDs (UUID) — SELECTED_CATEGORIES_COLLECTIONS mode only."),
            collection_ids: z
              .array(z.string())
              .optional()
              .describe("Collection IDs (UUID) — SELECTED_CATEGORIES_COLLECTIONS mode only."),
          })
          .describe("Objects to bind or unbind; at least one non-empty list."),
      },
    },
    async ({ product_card_id, action, objects }) => {
      const cardCount = objects.product_card_ids?.length ?? 0;
      const groupCount = (objects.category_ids?.length ?? 0) + (objects.collection_ids?.length ?? 0);
      const hasCards = cardCount > 0;
      const hasGroups = groupCount > 0;
      if (!hasCards && !hasGroups) {
        return validationFailure(["objects: pass at least one non-empty ID list"]);
      }
      if (cardCount + groupCount > MAX_OBJECTS_PER_CALL) {
        return validationFailure([
          `objects: at most ${MAX_OBJECTS_PER_CALL} IDs per call, got ${cardCount + groupCount}`,
        ]);
      }
      if (hasCards && hasGroups) {
        return validationFailure([
          "objects: send either product_card_ids or category_ids/collection_ids, not both",
        ]);
      }
      const operationId = action === "add" ? "AddSimilarCardsObjects" : "RemoveSimilarCardsObjects";
      const check = validateRequestBody(operationId, objects);
      if (!check.valid) return validationFailure(check.errors);
      try {
        return ok(
          await client.call(operationId, { pathParams: { product_card_id }, body: objects }),
        );
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "delete_similar_cards",
    {
      title: "Delete similar-products settings",
      description:
        "Delete the similar-products settings of a product card. Cannot be undone — read them " +
        "with get_similar_cards first if they may be needed again.",
      annotations: DESTRUCTIVE,
      inputSchema: {
        product_card_id: z.string().describe(PRODUCT_CARD_ID_DESCRIPTION),
      },
    },
    async ({ product_card_id }) => {
      try {
        return ok(await client.call("DeleteSimilarCards", { pathParams: { product_card_id } }));
      } catch (e) {
        return fail(e);
      }
    },
  );
}
