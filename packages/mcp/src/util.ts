import { KitApiError, KitValidationError } from "yandex-kit-core";

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

export function clampPerPage(perPage?: number, max: number = MAX_PER_PAGE): number {
  if (perPage === undefined) return Math.min(DEFAULT_PER_PAGE, max);
  return Math.max(1, Math.min(max, Math.trunc(perPage)));
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
