import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { validateRequestBody, type KitClient } from "yandex-kit-core";

import { clampPerPage, fail, ok, READ_ONLY, validationFailure } from "../util.js";

export function registerCharacteristicTools(server: McpServer, client: KitClient): void {
  server.registerTool(
    "list_characteristic_colors",
    {
      title: "List characteristic colors",
      description:
        "List the color values of the store's characteristics with their hex codes (paginated). " +
        "Colors are keyed by the characteristic value itself (e.g. «Красный»), not by an ID.",
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
        search_text: z
          .string()
          .optional()
          .describe("Partial search by color value (e.g. «крас»)."),
      },
    },
    async ({ page, per_page, all, search_text }) => {
      const filters = { search_text };
      try {
        if (all) return ok(await client.listAll("GetCharacteristicColors", { query: filters }));
        return ok(
          await client.call("GetCharacteristicColors", {
            query: { page, per_page: clampPerPage(per_page), ...filters },
          }),
        );
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "update_characteristic_color",
    {
      title: "Update characteristic color",
      description:
        "Set the hex code of a color characteristic value. The value must already exist among the " +
        "store's characteristic values (see list_characteristic_colors) — this endpoint recolors " +
        "an existing value, it does not create one. Both fields are required.",
      inputSchema: {
        value: z
          .string()
          .describe("Characteristic value to recolor, exactly as it is stored (e.g. «Красный»)."),
        color_hex: z
          .string()
          .describe(
            'Color as a hex code (e.g. "#FF0000") or one of the special values ' +
              '"multicoloured" / "transparent".',
          ),
      },
    },
    async ({ value, color_hex }) => {
      const body = { value, color_hex };
      const check = validateRequestBody("UpdateCharacteristicColor", body);
      if (!check.valid) return validationFailure(check.errors);
      try {
        return ok(await client.call("UpdateCharacteristicColor", { body }));
      } catch (e) {
        return fail(e);
      }
    },
  );
}
