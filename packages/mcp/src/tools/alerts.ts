import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { type KitClient } from "yandex-kit-core";

import { clampPerPage, COVERAGE_DESCRIPTION, fail, ok, READ_ONLY, withCoverage } from "../util.js";

export function registerAlertTools(server: McpServer, client: KitClient): void {
  server.registerTool(
    "list_alerts",
    {
      title: "List alerts",
      description:
        "List system alerts of the store (paginated), CRITICAL ones first and newest first within " +
        "the same severity. The API requires a status filter; defaults to ACTIVE when not provided. " +
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
          .array(z.enum(["ACTIVE", "RESOLVED"]))
          .optional()
          .describe("Filter by alert status (default: [ACTIVE])."),
      },
    },
    async ({ page, per_page, all, status }) => {
      // The status query parameter is required by the API.
      const filters = { status: status ?? ["ACTIVE"] };
      try {
        const perPage = clampPerPage(per_page);
        if (all) return ok(withCoverage({ all: await client.listAll("GetAlerts", { query: filters }) }));
        return ok(
          withCoverage({
            page: await client.call("GetAlerts", {
              query: { page, per_page: perPage, ...filters },
            }),
            operationId: "GetAlerts",
            perPage,
          }),
        );
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "resolve_alert",
    {
      title: "Resolve alert",
      description:
        "Mark an alert as resolved. Only WARNING alerts can be closed by hand: an active CRITICAL " +
        "alert is rejected with 400 and clears itself once the underlying problem is fixed. " +
        "No request body is required.",
      inputSchema: {
        alert_id: z
          .string()
          .describe(
            'Alert ID from the list_alerts response — a semantic string such as "certificateExpiry", not a UUID.',
          ),
      },
    },
    async ({ alert_id }) => {
      try {
        return ok(await client.call("ResolveAlert", { pathParams: { alert_id } }));
      } catch (e) {
        return fail(e);
      }
    },
  );
}
