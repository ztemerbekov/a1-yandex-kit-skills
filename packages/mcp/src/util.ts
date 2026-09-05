import { readFile } from "node:fs/promises";
import { basename } from "node:path";

import {
  getOp,
  KitApiError,
  KitValidationError,
  resolveOperationSchema,
} from "yandex-kit-core";

export const READ_ONLY = { readOnlyHint: true } as const;
export const DESTRUCTIVE = { destructiveHint: true } as const;

export const MAX_PER_PAGE = 100;
export const DEFAULT_PER_PAGE = 25;

export interface ToolResult {
  content: { type: "text"; text: string }[];
  isError?: boolean;
  [key: string]: unknown;
}

/** Compact JSON result — keeps consumer-LLM token usage low. */
export function ok(data: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data ?? { ok: true }) }] };
}

export function fail(err: unknown): ToolResult {
  const payload: Record<string, unknown> = {};
  if (err instanceof KitApiError) {
    payload.error = err.message;
    payload.code = err.code;
    payload.status = err.status;
    if (err.traceId) payload.traceId = err.traceId;
  } else if (err instanceof KitValidationError) {
    // Local (pre-network) failure: code but no HTTP status/traceId.
    payload.error = err.message;
    payload.code = err.code;
  } else if (err instanceof Error) {
    payload.error = err.message;
  } else {
    payload.error = String(err);
  }
  return { isError: true, content: [{ type: "text", text: JSON.stringify(payload) }] };
}

/** Request body failed the local OpenAPI schema check; nothing was sent. */
export function validationFailure(errors: string[]): ToolResult {
  return fail(
    new KitValidationError(`Request body failed schema validation: ${errors.join("; ")}`, errors),
  );
}

/** Empty update body rejected before any network call. */
export function emptyUpdateFailure(): ToolResult {
  return fail(
    new KitValidationError(
      "Update body must not be empty: provide at least one field to change.",
      [],
      "EMPTY_UPDATE_BODY",
    ),
  );
}

/**
 * Bytes + file name of a multipart upload from the mutually exclusive
 * `file_path` / `content_base64` pair, or the failure to surface (no network).
 */
export async function resolveUploadSource(input: {
  file_path?: string;
  content_base64?: string;
  filename?: string;
}): Promise<{ failure: ToolResult } | { bytes: Buffer; name: string }> {
  const { file_path, content_base64, filename } = input;
  if ((file_path === undefined) === (content_base64 === undefined)) {
    return {
      failure: fail(
        new KitValidationError(
          "Provide exactly one of file_path or content_base64, not both and not neither.",
          [],
          "FILE_SOURCE_REQUIRED",
        ),
      ),
    };
  }
  if (content_base64 !== undefined) {
    if (!filename) {
      return {
        failure: fail(
          new KitValidationError(
            "filename is required when uploading via content_base64.",
            [],
            "FILENAME_REQUIRED",
          ),
        ),
      };
    }
    // Buffer.from(..., "base64") silently skips invalid characters and drops
    // trailing bits — a lenient decode would upload corrupt (or zero) bytes.
    const compact = content_base64.replace(/\s+/g, "");
    if (
      compact.length === 0 ||
      compact.length % 4 !== 0 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(compact)
    ) {
      return {
        failure: fail(
          new KitValidationError(
            "content_base64 is not valid base64 (check for truncation or invalid characters).",
            [],
            "INVALID_BASE64",
          ),
        ),
      };
    }
    return { bytes: Buffer.from(compact, "base64"), name: filename };
  }
  try {
    return { bytes: await readFile(file_path!), name: filename ?? basename(file_path!) };
  } catch (e) {
    return { failure: fail(e) };
  }
}

/** Multipart body with a single `file` part, as both upload endpoints expect. */
export function fileFormData(bytes: Buffer, name: string): FormData {
  const form = new FormData();
  // Copy into a plain-ArrayBuffer-backed view: Buffer is not a valid BlobPart type.
  form.append("file", new Blob([new Uint8Array(bytes)]), name);
  return form;
}

/** Replacement value for personal data masked by `redactPii`. */
export const REDACTED = "[redacted]";

/**
 * Names of personal-data fields, collected from the response schemas of the
 * bundled OpenAPI spec (specs/kit-swagger.openapi.json):
 *
 * - `OrderClientInfo`: first_name, last_name, patronymic, phone, email
 * - `Customer`: first_name, last_name, phone, email, note (customer note)
 * - `OrderDeliveryInfo`: delivery_notes (delivery comment)
 * - `OrderAddressInfo` (delivery address parts): courier_locality,
 *   courier_address, pickup_point_locality, pickup_point_address,
 *   self_pick_up_locality, self_pick_up_address, floor, appartment
 *   (the spec's original spelling; the 2026-09 spec update added the
 *   correctly spelled `apartment` alongside it), entrance, intercom
 * - `GiftCard`: buyer_name, buyer_email, buyer_phone, holder_email
 *
 * Identifiers, amounts, statuses and dates are deliberately NOT listed:
 * they are what an aggregating task actually needs.
 */
export const PII_FIELDS: ReadonlySet<string> = new Set([
  // person
  "first_name",
  "last_name",
  "patronymic",
  "phone",
  "email",
  // free-form notes about the person / the delivery
  "note",
  "delivery_notes",
  // delivery address and its parts
  "courier_locality",
  "courier_address",
  "pickup_point_locality",
  "pickup_point_address",
  "self_pick_up_locality",
  "self_pick_up_address",
  "floor",
  "appartment",
  "apartment",
  "entrance",
  "intercom",
  // gift card buyer / holder
  "buyer_name",
  "buyer_email",
  "buyer_phone",
  "holder_email",
]);

/**
 * Deep copy of a RESPONSE with the value of every PII field (see `PII_FIELDS`)
 * replaced by `"[redacted]"` — the analog of the official client's `--redact`
 * (docs/YANDEX-KIT-SKILLS-OFFICIAL-RESEARCH.md §1.3). Output-only by design:
 * request bodies must never pass through here, a redacted write would be a
 * silent corruption. `null`/absent PII values stay as they are — there is
 * nothing to hide and a placeholder would fake data that never existed.
 */
export function redactPii<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => redactPii(item)) as unknown as T;
  if (value === null || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (PII_FIELDS.has(key) && entry !== null && entry !== undefined) {
      out[key] = REDACTED;
    } else {
      out[key] = redactPii(entry);
    }
  }
  return out as T;
}

/** Shared `.describe()` text for the opt-in `redact` parameter. */
export const REDACT_PARAM_DESCRIPTION =
  "Use redact:true when the task does not need personal data (e.g. counting or aggregating " +
  'orders) — personal fields (name, phone, email, delivery address and its parts, notes) are ' +
  'replaced with "[redacted]". Applies to the response only; request bodies are never ' +
  "redacted. Default false.";

export function clampPerPage(perPage?: number, max: number = MAX_PER_PAGE): number {
  if (perPage === undefined) return Math.min(DEFAULT_PER_PAGE, max);
  return Math.max(1, Math.min(max, Math.trunc(perPage)));
}

/** Shared description line for tools whose responses carry a coverage envelope. */
export const COVERAGE_DESCRIPTION =
  'The response carries a machine-readable coverage envelope (coverage, received, total_count, ' +
  'pages_read); coverage:"partial" MUST be reflected in the user-facing answer and forbids ' +
  "claiming the listing is complete.";

/** Shared `.describe()` text for the optional `format` parameter of list tools. */
export const CSV_FORMAT_DESCRIPTION =
  'Output format: "csv" renders the items as RFC 4180 CSV (a leading "# coverage:" comment ' +
  "line, then the header row) instead of JSON — cheaper for wide exports. Default: JSON.";

/** Shared `.describe()` text for the optional `fields` parameter of list tools. */
export const CSV_FIELDS_DESCRIPTION =
  'CSV columns; only valid together with format:"csv". Field names are validated against the ' +
  "item schema of the operation's response — an unknown name fails with the list of allowed " +
  "fields. Default: every top-level scalar field of the item.";

const SCALAR_TYPES = new Set(["string", "number", "integer", "boolean"]);

const listItemFieldsCache = new Map<string, { all: string[]; scalars: string[] }>();

/**
 * Top-level properties of a list operation's item, taken from the response
 * schema in the generated registry/spec (the same source validateRequestBody
 * uses for request bodies). `scalars` are the properties whose (deref'ed)
 * type is string/number/integer/boolean — the default CSV columns.
 */
function listItemFields(operationId: string): { all: string[]; scalars: string[] } {
  const cached = listItemFieldsCache.get(operationId);
  if (cached) return cached;
  const op = getOp(operationId);
  const response = resolveOperationSchema(operationId).response as
    | { properties?: Record<string, { items?: { properties?: Record<string, { type?: unknown }> } }> }
    | undefined;
  const props =
    (op.itemsProp && response?.properties?.[op.itemsProp]?.items?.properties) || {};
  const all = Object.keys(props);
  const scalars = all.filter((name) => {
    const type = props[name]?.type;
    return typeof type === "string" && SCALAR_TYPES.has(type);
  });
  const result = { all, scalars };
  listItemFieldsCache.set(operationId, result);
  return result;
}

/** RFC 4180: quote a cell when it holds a quote, comma or line break; double the quotes. */
function csvEscape(cell: string): string {
  return /[",\r\n]/.test(cell) ? `"${cell.replaceAll('"', '""')}"` : cell;
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return csvEscape(JSON.stringify(value));
  return csvEscape(String(value));
}

/**
 * CSV rendering of a list response that already carries the coverage envelope
 * (research §3 item 12: an empty column must not read as a fact about the
 * store, so requested fields are checked against the schema first).
 *
 * Returns null when neither `format` nor `fields` was passed — the caller
 * falls back to the JSON path. The coverage envelope survives as a leading
 * `# coverage:` comment line: embedding CSV in a JSON string would double-
 * escape every quote and newline, while a comment line keeps the CSV
 * copy-pasteable and is trivially stripped.
 */
export function csvListResult(
  operationId: string,
  data: Record<string, unknown>,
  format: "csv" | undefined,
  fields: string[] | undefined,
): ToolResult | null {
  if (format === undefined && fields === undefined) return null;
  if (format === undefined) {
    return fail(
      new KitValidationError(
        'fields is only valid together with format:"csv".',
        [],
        "FIELDS_REQUIRE_CSV",
      ),
    );
  }
  const known = listItemFields(operationId);
  if (fields !== undefined) {
    const allowed = new Set(known.all);
    const unknown = fields.filter((name) => !allowed.has(name));
    if (unknown.length > 0) {
      return fail(
        new KitValidationError(
          `Unknown CSV field(s) for ${operationId}: ${unknown.join(", ")}. ` +
            `Allowed fields: ${known.all.join(", ")}.`,
          [],
          "UNKNOWN_CSV_FIELD",
        ),
      );
    }
  }
  const columns = fields ?? known.scalars;
  const itemsProp = getOp(operationId).itemsProp;
  const rawByProp = itemsProp ? data[itemsProp] : undefined;
  const raw = Array.isArray(rawByProp) ? rawByProp : data.items;
  const items = Array.isArray(raw) ? raw : [];
  const commentParts = [
    `coverage: ${String(data.coverage)}`,
    `received: ${String(data.received)}`,
    ...(typeof data.total_count === "number" ? [`total_count: ${data.total_count}`] : []),
    `pages_read: ${String(data.pages_read)}`,
  ];
  const lines = [
    `# ${commentParts.join("; ")}`,
    columns.map(csvEscape).join(","),
    ...items.map((item) =>
      columns
        .map((name) =>
          csvCell(item !== null && typeof item === "object" ? (item as Record<string, unknown>)[name] : undefined),
        )
        .join(","),
    ),
  ];
  return { content: [{ type: "text", text: lines.join("\r\n") }] };
}

interface ListAllResult {
  items: unknown[];
  pages: number;
  truncated: boolean;
  total_count?: number;
}

/**
 * Coverage envelope for list responses — the completeness verdict as a machine
 * fact rather than a duty of the consumer model (the official client prints
 * `{coverage, received, total_count, pages_read, items}` from `kit.py list`;
 * docs/YANDEX-KIT-SKILLS-OFFICIAL-RESEARCH.md §1.3, §2.2 item 7).
 *
 * - `all` mode (client.listAll): coverage follows `truncated`; `pages_read`
 *   records the pages consumed and the legacy `pages`/`truncated` aliases are
 *   retained; `total_count` is whatever the API reported, if anything.
 * - single-page mode: `pages_read` is 1 and coverage is "partial" when
 *   `total_count > received`, or when a full page of `perPage` items arrived
 *   without a `total_count` (a continuation may exist); otherwise "complete".
 *
 * Single-page mode spreads the raw API response, so its own fields (including
 * `total_count`) stay where consumers already expect them.
 */
export function withCoverage(
  source:
    | { all: ListAllResult }
    | { page: unknown; operationId: string; perPage: number },
): Record<string, unknown> {
  if ("all" in source) {
    const { items, pages, truncated, total_count } = source.all;
    return {
      items,
      coverage: truncated ? "partial" : "complete",
      received: items.length,
      ...(total_count !== undefined ? { total_count } : {}),
      pages_read: pages,
      // Keep the names emitted by KitClient.listAll for consumers that used the
      // pre-coverage response while exposing the explicit coverage verdict.
      pages,
      truncated,
    };
  }
  const res =
    source.page !== null && typeof source.page === "object"
      ? (source.page as Record<string, unknown>)
      : {};
  const itemsProp = getOp(source.operationId).itemsProp;
  const raw = itemsProp ? res[itemsProp] : undefined;
  const received = Array.isArray(raw) ? raw.length : 0;
  const totalCount = typeof res.total_count === "number" ? res.total_count : undefined;
  const partial =
    totalCount !== undefined
      ? totalCount > received
      : received >= source.perPage && source.perPage > 0;
  return {
    ...res,
    coverage: partial ? "partial" : "complete",
    received,
    pages_read: 1,
  };
}

/**
 * Distinct `status` values found in `items` that lie outside the requested
 * status filter. A non-empty result proves the server ignored the filter and
 * fell back to a different listing (issue #54: the KIT API silently strips
 * `ARCHIVED` from the GetVariants status filter and returns the default
 * non-archived catalog instead).
 */
export function statusesOutsideFilter(requested: readonly string[], items: unknown[]): string[] {
  const allowed = new Set(requested);
  const outside = new Set<string>();
  for (const item of items) {
    const status = (item as { status?: unknown } | null)?.status;
    if (typeof status === "string" && !allowed.has(status)) outside.add(status);
  }
  return [...outside].sort();
}

/** The server returned items outside the requested status filter (issue #54). */
export function statusFilterIgnoredFailure(
  requested: readonly string[],
  outside: readonly string[],
): ToolResult {
  return fail(
    new KitValidationError(
      `The KIT API ignored the requested status filter [${requested.join(", ")}]: ` +
        `the response contains statuses [${outside.join(", ")}] outside the filter ` +
        "(known KIT API defect: ARCHIVED is silently stripped from the GetVariants " +
        "status filter and the listing falls back to the default non-archived catalog). " +
        "The response was discarded so the default listing cannot be mistaken for the " +
        "filtered view. Archived variants cannot be listed via the API; they can only " +
        "be read by ID (get_variant).",
      [],
      "STATUS_FILTER_IGNORED",
    ),
  );
}

/**
 * Mixed status filter with ARCHIVED (issue #54): the stripped listing is
 * indistinguishable from an honored view with an empty archive — unprovable.
 */
export function mixedArchivedFilterFailure(requested: readonly string[]): ToolResult {
  return fail(
    new KitValidationError(
      `A status filter mixing ARCHIVED with other statuses [${requested.join(", ")}] cannot ` +
        "be trusted: the KIT API silently strips ARCHIVED from the GetVariants status filter " +
        "(known defect), so the response would hold only the non-archived slice presented as " +
        "the full filtered view. The response was discarded. Query the non-archived statuses " +
        "without ARCHIVED; archived variants can only be read by ID (get_variant).",
      [],
      "MIXED_ARCHIVED_FILTER_UNSUPPORTED",
    ),
  );
}

/** Empty ARCHIVED listing that cannot be told apart from the filter defect (issue #54). */
export function archiveReadUnsupportedFailure(): ToolResult {
  return fail(
    new KitValidationError(
      "Listing archived variants is not supported by the KIT API right now: the server " +
        "silently strips ARCHIVED from the GetVariants status filter (known defect), and " +
        "both the filtered and the unfiltered listings are empty, so an empty archive " +
        "cannot be distinguished from the defect. Do NOT conclude the archive is empty. " +
        "Archived variants can only be read by ID (get_variant).",
      [],
      "ARCHIVE_READ_UNSUPPORTED",
    ),
  );
}
