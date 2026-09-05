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
  fileFormData,
  ok,
  READ_ONLY,
  resolveUploadSource,
  withCoverage,
} from "../util.js";

export function registerFileTools(server: McpServer, client: KitClient): void {
  server.registerTool(
    "list_files",
    {
      title: "List files",
      description:
        "List the store's uploaded files with their URLs (paginated). Covers images " +
        "(IMAGE) and other files (OTHER) only — videos live in a separate scenario, " +
        "use get_video/list_videos. " +
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
        format: z.enum(["csv"]).optional().describe(CSV_FORMAT_DESCRIPTION),
        fields: z.array(z.string()).min(1).optional().describe(CSV_FIELDS_DESCRIPTION),
      },
    },
    async ({ page, per_page, all, format, fields }) => {
      try {
        const perPage = clampPerPage(per_page);
        const data = all
          ? withCoverage({ all: await client.listAll("GetFiles") })
          : withCoverage({
              page: await client.call("GetFiles", { query: { page, per_page: perPage } }),
              operationId: "GetFiles",
              perPage,
              pageNumber: page ?? 1,
            });
        return csvListResult("GetFiles", data, format, fields) ?? ok(data);
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "upload_file",
    {
      title: "Upload file",
      description:
        "Upload a file (e.g. an image for a variant or collection) via multipart/form-data. " +
        "Files are deduplicated by content: uploading identical bytes returns the existing file. " +
        "Max size 100 MB. Provide exactly one source: file_path or content_base64.",
      inputSchema: {
        file_path: z
          .string()
          .optional()
          .describe(
            "Absolute path to the file on the local machine running this MCP server. " +
              "Mutually exclusive with content_base64.",
          ),
        content_base64: z
          .string()
          .optional()
          .describe("File content as a base64 string. Mutually exclusive with file_path."),
        filename: z
          .string()
          .optional()
          .describe(
            "File name to send. Required with content_base64; defaults to the basename of file_path.",
          ),
      },
    },
    async ({ file_path, content_base64, filename }) => {
      const source = await resolveUploadSource({ file_path, content_base64, filename });
      if ("failure" in source) return source.failure;
      try {
        return ok(
          await client.call("UploadFile", { body: fileFormData(source.bytes, source.name) }),
        );
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "get_file",
    {
      title: "Get file",
      description: "Get metadata of a previously uploaded file by its ID (name, size, URL).",
      annotations: READ_ONLY,
      inputSchema: {
        id: z.string().describe("File ID (UUID)."),
      },
    },
    async ({ id }) => {
      try {
        return ok(await client.call("GetFileById", { pathParams: { id } }));
      } catch (e) {
        return fail(e);
      }
    },
  );
}
