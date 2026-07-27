import { KitApiError } from "yandex-kit-core";

export const READ_ONLY = { readOnlyHint: true } as const;

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
  } else if (err instanceof Error) {
    payload.error = err.message;
  } else {
    payload.error = String(err);
  }
  return { isError: true, content: [{ type: "text", text: JSON.stringify(payload) }] };
}

export function clampPerPage(perPage?: number): number {
  if (perPage === undefined) return DEFAULT_PER_PAGE;
  return Math.max(1, Math.min(MAX_PER_PAGE, Math.trunc(perPage)));
}
