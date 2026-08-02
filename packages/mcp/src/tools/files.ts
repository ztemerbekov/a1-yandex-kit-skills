import { readFile } from "node:fs/promises";
import { basename } from "node:path";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { KitValidationError, type KitClient } from "yandex-kit-core";

import { fail, ok, READ_ONLY } from "../util.js";

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
      if ((file_path === undefined) === (content_base64 === undefined)) {
        return fail(
          new KitValidationError(
            "Provide exactly one of file_path or content_base64, not both and not neither.",
            [],
            "FILE_SOURCE_REQUIRED",
          ),
        );
      }
      let bytes: Buffer;
      let name: string;
      if (content_base64 !== undefined) {
        if (!filename) {
          return fail(
            new KitValidationError(
              "filename is required when uploading via content_base64.",
              [],
              "FILENAME_REQUIRED",
            ),
          );
        }
        // Buffer.from(..., "base64") silently skips invalid characters and drops
        // trailing bits, so a lenient decode would upload corrupt bytes; validate first.
        const compact = content_base64.replace(/\s+/g, "");
        if (compact.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(compact)) {
          return fail(
            new KitValidationError(
              "content_base64 is not valid base64 (check for truncation or invalid characters).",
              [],
              "INVALID_BASE64",
            ),
          );
        }
        bytes = Buffer.from(compact, "base64");
        name = filename;
      } else {
        try {
          bytes = await readFile(file_path!);
        } catch (e) {
          return fail(e);
        }
        name = filename ?? basename(file_path!);
      }
      try {
        const form = new FormData();
        // Copy into a plain-ArrayBuffer-backed view: Buffer is not a valid BlobPart type.
        form.append("file", new Blob([new Uint8Array(bytes)]), name);
        return ok(await client.call("UploadFile", { body: form }));
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
