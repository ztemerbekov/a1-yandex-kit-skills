import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { type KitClient } from "yandex-kit-core";

import {
  clampPerPage,
  COVERAGE_DESCRIPTION,
  CSV_FIELDS_DESCRIPTION,
  CSV_FORMAT_DESCRIPTION,
  csvListResult,
  fail,
  ok,
  READ_ONLY,
  REDACT_PARAM_DESCRIPTION,
  redactPii,
  withCoverage,
} from "../util.js";

const GIFT_CARD_STATUSES = [
  "ACTIVATED",
  "DEACTIVATED",
  "REFUND_IN_PROGRESS",
  "REFUNDED",
  "CANCELLED",
] as const;

export function registerGiftCardTools(server: McpServer, client: KitClient): void {
  server.registerTool(
    "list_gift_cards",
    {
      title: "List gift cards",
      description:
        "List gift cards of the store (paginated), with optional status and purchase-date " +
        "filters. " +
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
        status: z.enum(GIFT_CARD_STATUSES).optional().describe("Filter by gift card status."),
        purchased_date_from: z
          .string()
          .optional()
          .describe("Filter by purchase date: start of the range, inclusive (ISO 8601)."),
        purchased_date_to: z
          .string()
          .optional()
          .describe("Filter by purchase date: end of the range, inclusive (ISO 8601)."),
        redact: z.boolean().optional().describe(REDACT_PARAM_DESCRIPTION),
        format: z.enum(["csv"]).optional().describe(CSV_FORMAT_DESCRIPTION),
        fields: z.array(z.string()).min(1).optional().describe(CSV_FIELDS_DESCRIPTION),
      },
    },
    async ({
      page,
      per_page,
      all,
      status,
      purchased_date_from,
      purchased_date_to,
      redact,
      format,
      fields,
    }) => {
      const filters = { status, purchased_date_from, purchased_date_to };
      try {
        const perPage = clampPerPage(per_page);
        const data = all
          ? withCoverage({ all: await client.listAll("GetGiftCards", { query: filters }) })
          : withCoverage({
              page: await client.call("GetGiftCards", {
                query: { page, per_page: perPage, ...filters },
              }),
              operationId: "GetGiftCards",
              perPage,
            });
        const out = redact ? redactPii(data) : data;
        return csvListResult("GetGiftCards", out, format, fields) ?? ok(out);
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "get_gift_card",
    {
      title: "Get gift card",
      description: "Get a single gift card by its ID, including status, balance and purchase info.",
      annotations: READ_ONLY,
      inputSchema: {
        id: z.string().describe("Gift card ID (UUID)."),
        redact: z.boolean().optional().describe(REDACT_PARAM_DESCRIPTION),
      },
    },
    async ({ id, redact }) => {
      try {
        const data = await client.call("GetGiftCardById", { pathParams: { gift_card_id: id } });
        return ok(redact ? redactPii(data) : data);
      } catch (e) {
        return fail(e);
      }
    },
  );
}
