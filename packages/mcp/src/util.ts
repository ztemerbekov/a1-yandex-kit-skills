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
