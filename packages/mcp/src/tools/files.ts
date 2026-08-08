import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { type KitClient } from "yandex-kit-core";

import { fail, fileFormData, ok, READ_ONLY, resolveUploadSource } from "../util.js";

export function registerFileTools(server: McpServer, client: KitClient): void {
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
