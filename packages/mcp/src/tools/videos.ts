import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { validateRequestBody, type KitClient } from "yandex-kit-core";

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
  validationFailure,
  withCoverage,
} from "../util.js";

const VIDEO_STATUSES = ["UPLOADED", "PROCESSING", "READY", "ERROR"] as const;

export function registerVideoTools(server: McpServer, client: KitClient): void {
  server.registerTool(
    "list_videos",
    {
      title: "List videos",
      description:
        "List product videos of the store (paginated), oldest upload first. The API requires a " +
        "status filter; defaults to all four statuses when not provided. " +
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
          .array(z.enum(VIDEO_STATUSES))
          .optional()
          .describe(
            "Filter by processing status (default: all of UPLOADED, PROCESSING, READY, ERROR).",
          ),
        format: z.enum(["csv"]).optional().describe(CSV_FORMAT_DESCRIPTION),
        fields: z.array(z.string()).min(1).optional().describe(CSV_FIELDS_DESCRIPTION),
      },
    },
    async ({ page, per_page, all, status, format, fields }) => {
      // The status query parameter is required by the API.
      const filters = { status: status ?? [...VIDEO_STATUSES] };
      try {
        const perPage = clampPerPage(per_page);
        const data = all
          ? withCoverage({ all: await client.listAll("GetVideos", { query: filters }) })
          : withCoverage({
              page: await client.call("GetVideos", {
                query: { page, per_page: perPage, ...filters },
              }),
              operationId: "GetVideos",
              perPage,
              pageNumber: page ?? 1,
            });
        return csvListResult("GetVideos", data, format, fields) ?? ok(data);
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "get_video",
    {
      title: "Get video",
      description:
        "Get a single video by its ID with the current processing status. Use it to poll after " +
        "upload_video: the status walks UPLOADED -> PROCESSING -> READY (the `content` field with " +
        "the player links is filled only in READY) or ends in ERROR (details in `error`). " +
        "Poll at most once every 5 seconds — processing time scales with the video length.",
      annotations: READ_ONLY,
      inputSchema: {
        video_id: z
          .string()
          .describe(
            "Video ID from the upload_video or list_videos response — an opaque string, not a UUID.",
          ),
      },
    },
    async ({ video_id }) => {
      try {
        return ok(await client.call("GetVideoById", { pathParams: { video_id } }));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "upload_video",
    {
      title: "Upload video",
      description:
        "Upload a product video via multipart/form-data and queue it for processing. Max size " +
        "100 MB; formats mp4, mov, webm, avi, flv. Videos are deduplicated by content: uploading " +
        "identical bytes returns the existing video. The response carries the video ID — poll it " +
        "with get_video until the status is READY, then attach the video to a variant through " +
        "`media` in create_variant / update_variant (at most one video per variant, and the same " +
        "`media` list must also carry at least one image). Provide exactly one source: file_path or " +
        "content_base64.",
      inputSchema: {
        file_path: z
          .string()
          .optional()
          .describe(
            "Absolute path to the video file on the local machine running this MCP server. " +
              "Mutually exclusive with content_base64.",
          ),
        content_base64: z
          .string()
          .optional()
          .describe(
            "Video content as a base64 string. Mutually exclusive with file_path. " +
              "Prefer file_path for large videos.",
          ),
        filename: z
          .string()
          .optional()
          .describe(
            "File name to send; it becomes the video title. Required with content_base64; " +
              "defaults to the basename of file_path.",
          ),
      },
    },
    async ({ file_path, content_base64, filename }) => {
      const source = await resolveUploadSource({ file_path, content_base64, filename });
      if ("failure" in source) return source.failure;
      try {
        return ok(
          await client.call("UploadVideo", { body: fileFormData(source.bytes, source.name) }),
        );
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "upload_video_from_url",
    {
      title: "Upload video from URL",
      description:
        "Upload a product video by public link and queue it for processing — use it instead of " +
        "upload_video when the file lives on the web rather than on this machine. Accepts a public " +
        "Yandex.Disk link to a video file, a direct link to a video file, or a link to the Yandex " +
        "KIT player (which returns the already uploaded video). The link must be reachable without " +
        "authentication, otherwise the API answers 400. Same limits as upload_video: max 100 MB, " +
        "formats mp4, mov, webm, avi, flv, deduplicated by content. The response carries the video " +
        "ID — poll it with get_video until the status is READY, then attach the video to a variant " +
        "through `media` in create_variant / update_variant (at most one video per variant, and the " +
        "same `media` list must also carry at least one image).",
      inputSchema: {
        url: z
          .string()
          .describe(
            "Public link to the video: a Yandex.Disk link to a video file, a direct file link, " +
              "or a Yandex KIT player link.",
          ),
      },
    },
    async ({ url }) => {
      const body = { url };
      const check = validateRequestBody("UploadVideoFromUrl", body);
      if (!check.valid) return validationFailure(check.errors);
      try {
        return ok(await client.call("UploadVideoFromUrl", { body }));
      } catch (e) {
        return fail(e);
      }
    },
  );
}
