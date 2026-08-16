import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { validateRequestBody, type KitClient } from "yandex-kit-core";

import {
  clampPerPage,
  emptyUpdateFailure,
  fail,
  ok,
  READ_ONLY,
  validationFailure,
} from "../util.js";

export function registerCharacteristicTools(server: McpServer, client: KitClient): void {
  server.registerTool(
    "list_characteristics",
    {
      title: "List characteristics",
      description: "List product characteristics (paginated).",
      annotations: READ_ONLY,
      inputSchema: {
        page: z.number().int().min(1).optional(),
        per_page: z.number().int().optional(),
        all: z.boolean().optional(),
      },
    },
    async ({ page, per_page, all }) => {
      try {
        if (all) return ok(await client.listAll("GetCharacteristics"));
        return ok(await client.call("GetCharacteristics", {
          query: { page, per_page: clampPerPage(per_page) },
        }));
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "get_characteristic",
    {
      title: "Get characteristic",
      description: "Get one product characteristic by ID.",
      annotations: READ_ONLY,
      inputSchema: { id: z.string() },
    },
    async ({ id }) => {
      try {
        return ok(await client.call("GetCharacteristicById", { pathParams: { id } }));
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "create_characteristic",
    {
      title: "Create characteristic",
      description:
        "Create a product characteristic. Call get_operation_schema(\"CreateCharacteristic\") for the exact request shape.",
      inputSchema: { characteristic: z.record(z.unknown()) },
    },
    async ({ characteristic }) => {
      const check = validateRequestBody("CreateCharacteristic", characteristic);
      if (!check.valid) return validationFailure(check.errors);
      try {
        return ok(await client.call("CreateCharacteristic", { body: characteristic }));
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "update_characteristic",
    {
      title: "Update characteristic",
      description:
        "Update a product characteristic. Call get_operation_schema(\"UpdateCharacteristic\") for the exact request shape.",
      inputSchema: {
        id: z.string(),
        characteristic: z.record(z.unknown()),
      },
    },
    async ({ id, characteristic }) => {
      if (Object.keys(characteristic).length === 0) return emptyUpdateFailure();
      const check = validateRequestBody("UpdateCharacteristic", characteristic);
      if (!check.valid) return validationFailure(check.errors);
      try {
        return ok(await client.call("UpdateCharacteristic", {
          pathParams: { id },
          body: characteristic,
        }));
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "list_characteristic_groups",
    {
      title: "List characteristic groups",
      description: "List product characteristic groups (paginated).",
      annotations: READ_ONLY,
      inputSchema: {
        page: z.number().int().min(1).optional(),
        per_page: z.number().int().optional(),
        all: z.boolean().optional(),
      },
    },
    async ({ page, per_page, all }) => {
      try {
        if (all) return ok(await client.listAll("GetCharacteristicGroups"));
        return ok(await client.call("GetCharacteristicGroups", {
          query: { page, per_page: clampPerPage(per_page) },
        }));
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "get_characteristic_group",
    {
      title: "Get characteristic group",
      description: "Get one product characteristic group by ID.",
      annotations: READ_ONLY,
      inputSchema: { id: z.string() },
    },
    async ({ id }) => {
      try {
        return ok(await client.call("GetCharacteristicGroupById", { pathParams: { id } }));
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "create_characteristic_group",
    {
      title: "Create characteristic group",
      description:
        "Create a product characteristic group. Call get_operation_schema(\"CreateCharacteristicGroup\") for the exact request shape.",
      inputSchema: { group: z.record(z.unknown()) },
    },
    async ({ group }) => {
      const check = validateRequestBody("CreateCharacteristicGroup", group);
      if (!check.valid) return validationFailure(check.errors);
      try {
        return ok(await client.call("CreateCharacteristicGroup", { body: group }));
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "update_characteristic_group",
    {
      title: "Update characteristic group",
      description:
        "Update a product characteristic group. Call get_operation_schema(\"UpdateCharacteristicGroup\") for the exact request shape.",
      inputSchema: { id: z.string(), group: z.record(z.unknown()) },
    },
    async ({ id, group }) => {
      if (Object.keys(group).length === 0) return emptyUpdateFailure();
      const check = validateRequestBody("UpdateCharacteristicGroup", group);
      if (!check.valid) return validationFailure(check.errors);
      try {
        return ok(await client.call("UpdateCharacteristicGroup", {
          pathParams: { id },
          body: group,
        }));
      } catch (error) {
        return fail(error);
      }
    },
  );

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
