/**
 * Meta tools: registry search, operation schema lookup and the kit_request
 * escape hatch. Together they cover every operation of the KIT API, including
 * the ones without a dedicated curated tool.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  KitClient,
  KitValidationError,
  getRegistry,
  resolveOperationSchema,
  validateRequestBody,
  type RegistryOp,
} from "yandex-kit-core";

import {
  READ_ONLY,
  emptyUpdateFailure,
  fail,
  ok,
  statusesOutsideFilter,
  statusFilterIgnoredFailure,
  type ToolResult,
} from "../util.js";

/**
 * Generic post-check for paginated list responses (issue #54): the KIT API is
 * known to silently strip `ARCHIVED` from the GetVariants status filter and
 * fall back to the default listing. A response containing items whose status
 * lies outside the requested status filter must never be returned as if it
 * were the filtered view — for any list operation, current or future.
 */
function checkStatusFilterHonored(
  op: RegistryOp,
  query: Record<string, unknown> | undefined,
  data: unknown,
): ToolResult | null {
  if (!op.paginated || !op.itemsProp || !query) return null;
  // A scalar string serializes to the same wire form as a one-element array
  // (?status=X), so it must be guarded identically — normalize before checking.
  const raw = query.status;
  const requested = typeof raw === "string" ? [raw] : raw;
  if (!Array.isArray(requested) || requested.length === 0) return null;
  if (!requested.every((s): s is string => typeof s === "string")) return null;
  const items = (data as Record<string, unknown> | null | undefined)?.[op.itemsProp];
  if (!Array.isArray(items)) return null;
  const outside = statusesOutsideFilter(requested, items);
  return outside.length > 0 ? statusFilterIgnoredFailure(requested, outside) : null;
}

/** Field weights for search scoring (operationId/path > tag/summary > description). */
const SEARCH_FIELDS: ReadonlyArray<{
  weight: number;
  get: (op: RegistryOp) => string | null | undefined;
}> = [
  { weight: 3, get: (op) => op.id },
  { weight: 3, get: (op) => op.path },
  { weight: 2, get: (op) => op.tag },
  { weight: 2, get: (op) => op.summaryRu },
  { weight: 1, get: (op) => op.descriptionRu },
];

/**
 * Score one operation against lowercase query tokens.
 * requireAll: every token must match at least one field (search mode);
 * otherwise any matching token contributes (suggestion mode).
 */
function scoreOp(op: RegistryOp, tokens: string[], requireAll: boolean): number {
  let total = 0;
  for (const token of tokens) {
    let tokenScore = 0;
    for (const field of SEARCH_FIELDS) {
      const value = field.get(op);
      if (value && value.toLowerCase().includes(token)) tokenScore += field.weight;
    }
    if (tokenScore === 0 && requireAll) return 0;
    total += tokenScore;
  }
  return total;
}

function tokenize(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter(Boolean);
}

interface ScoredOp {
  op: RegistryOp;
  score: number;
}

function rankOps(tokens: string[], requireAll: boolean, tag?: string): ScoredOp[] {
  const tagLc = tag?.toLowerCase();
  const scored: ScoredOp[] = [];
  for (const op of Object.values(getRegistry().ops)) {
    if (tagLc && !op.tag.toLowerCase().includes(tagLc)) continue;
    const score = scoreOp(op, tokens, requireAll);
    if (score > 0) scored.push({ op, score });
  }
  scored.sort((a, b) => b.score - a.score || a.op.id.localeCompare(b.op.id));
  return scored;
}

/** Closest operationIds for an unknown id (camelCase/snake_case-aware, lenient). */
function suggestOperationIds(unknownId: string, limit = 3): string[] {
  const tokens = unknownId
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-zа-яё0-9]+/iu)
    .filter(Boolean);
  if (tokens.length === 0) return [];
  return rankOps(tokens, false)
    .slice(0, limit)
    .map((s) => s.op.id);
}

/** Curated tools for the registry's multipart operations, keyed by operationId. */
const MULTIPART_TOOLS: Record<string, string> = {
  UploadFile: "upload_file",
  UploadVideo: "upload_video",
};

function unknownOperationError(operationId: string): Error {
  const suggestions = suggestOperationIds(operationId);
  const hint =
    suggestions.length > 0
      ? ` Did you mean: ${suggestions.join(", ")}?`
      : "";
  return new KitValidationError(
    `Unknown operation_id "${operationId}".${hint} Use search_operations to find the right operation.`,
    [],
    "UNKNOWN_OPERATION",
  );
}

export function registerMetaTools(server: McpServer, client: KitClient): void {
  const opsCount = getRegistry().opsCount;

  server.registerTool(
    "search_operations",
    {
      title: "Search KIT API operations",
      description:
        `Search the full catalog of all ${opsCount} Yandex KIT API operations by keyword. ` +
        "Matches operationId, URL path, tag and Russian summary/description " +
        "(the API docs are in Russian, so Russian keywords like \"категории\" work too). " +
        "Any operation found here can be executed with kit_request; " +
        "use get_operation_schema to inspect its parameters and body shape first.",
      annotations: READ_ONLY,
      inputSchema: {
        query: z
          .string()
          .min(1)
          .describe(
            "Search keywords (whitespace-separated, case-insensitive; every token must match)",
          ),
        tag: z
          .string()
          .optional()
          .describe('Optional tag filter, e.g. "Товары" or "Вебхуки" (case-insensitive substring)'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(50)
          .default(10)
          .describe("Maximum number of results to return (1-50, default 10)"),
      },
    },
    async ({ query, tag, limit }) => {
      try {
        const ranked = rankOps(tokenize(query), true, tag);
        return ok({
          total: ranked.length,
          results: ranked.slice(0, limit).map(({ op }) => ({
            operationId: op.id,
            method: op.method,
            path: op.path,
            tag: op.tag,
            summaryRu: op.summaryRu,
            paginated: op.paginated,
          })),
        });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "get_operation_schema",
    {
      title: "Get KIT operation schema",
      description:
        "Get full metadata for one KIT API operation by operationId: HTTP method, path, " +
        "path/query parameters, request content type, pagination info, and the fully " +
        "dereferenced JSON schemas of the request body and response. " +
        "Call this before kit_request or any create/update tool to learn the exact body shape.",
      annotations: READ_ONLY,
      inputSchema: {
        operation_id: z
          .string()
          .describe('Operation id in PascalCase, e.g. "CreateProduct" (find it via search_operations)'),
      },
    },
    async ({ operation_id }) => {
      try {
        const op = getRegistry().ops[operation_id];
        if (!op) return fail(unknownOperationError(operation_id));
        const { request, response } = resolveOperationSchema(operation_id);
        return ok({
          operationId: op.id,
          method: op.method,
          path: op.path,
          tag: op.tag,
          summaryRu: op.summaryRu,
          pathParams: op.pathParams,
          queryParams: op.queryParams,
          requestContentType: op.requestContentType ?? null,
          paginated: op.paginated,
          itemsProp: op.itemsProp ?? null,
          requestSchema: request ?? null,
          responseSchema: response ?? null,
        });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "kit_request",
    {
      title: "Execute any KIT API operation",
      description:
        `Escape hatch that executes ANY of the ${opsCount} Yandex KIT API operations by operationId, ` +
        "including operations without a dedicated tool. " +
        "WARNING: this performs REAL calls against the live store — write operations " +
        "(create/update/delete/archive) take effect immediately and there is no sandbox. " +
        "Workflow: search_operations -> get_operation_schema -> kit_request. " +
        "The request body is validated against the OpenAPI schema before sending " +
        "(set validate=false to skip).",
      inputSchema: {
        operation_id: z
          .string()
          .describe('Operation id in PascalCase, e.g. "GetProducts" (find it via search_operations)'),
        path_params: z
          .record(z.union([z.string(), z.number()]))
          .optional()
          .describe('Values for {placeholders} in the path, e.g. {"id": "123"}'),
        query: z
          .record(z.unknown())
          .optional()
          .describe("Query-string parameters (e.g. page, per_page for paginated lists)"),
        body: z
          .unknown()
          .describe(
            "JSON request body; get the exact shape from get_operation_schema(\"<OperationId>\")",
          ),
        validate: z
          .boolean()
          .default(true)
          .describe("Validate body against the OpenAPI schema before sending (default true)"),
      },
    },
    async ({ operation_id, path_params, query, body, validate }) => {
      try {
        const op = getRegistry().ops[operation_id];
        if (!op) return fail(unknownOperationError(operation_id));
        if (op.requestContentType === "multipart/form-data") {
          const dedicatedTool =
            MULTIPART_TOOLS[op.id] ?? "upload_file or upload_video";
          return fail(
            new KitValidationError(
              `multipart operations are not supported by kit_request; ` +
                `use the dedicated ${dedicatedTool} tool for ${op.id}`,
              [],
              "MULTIPART_NOT_SUPPORTED",
            ),
          );
        }
        // Merge-patch/PATCH updates have all-optional schemas, so an empty {}
        // passes validation, hits the live store and "succeeds" as a server-side
        // no-op. Curated update tools reject this locally — so must kit_request.
        if (
          op.method === "patch" &&
          typeof body === "object" &&
          body !== null &&
          !Array.isArray(body) &&
          Object.keys(body).length === 0
        ) {
          return emptyUpdateFailure();
        }
        if (validate !== false && body !== undefined) {
          const result = validateRequestBody(operation_id, body);
          if (!result.valid) {
            return fail(
              new KitValidationError(
                `Request body failed schema validation (nothing was sent): ${result.errors.join("; ")}`,
                result.errors,
              ),
            );
          }
        }
        const data = await client.call(operation_id, {
          pathParams: path_params,
          query,
          body,
        });
        const guard = checkStatusFilterHonored(op, query, data);
        return guard ?? ok(data);
      } catch (e) {
        return fail(e);
      }
    },
  );
}
