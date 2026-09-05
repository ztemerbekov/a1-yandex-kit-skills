/**
 * Fetch-based client for the Yandex KIT API.
 *
 * Features (see docs/history/PLAN.md §2/§6): Bearer auth, per-attempt timeout via
 * AbortController, token-bucket rate limiter (default 3 rps, gates every
 * attempt including retries), exponential backoff retries for GET requests
 * (network/abort, 429, >=500, and HTTP 400 with code LIMIT_EXCEEDED — KIT
 * returns rate-limit errors as 400; mutations are never retried: the API
 * gives no idempotency contract, so a timed-out write may already have been
 * executed server-side and a repeat could duplicate it), per-operation
 * content type from the generated registry (json / merge-patch+json /
 * multipart), and auto-pagination via listAll().
 */
import { KitApiError, KitValidationError } from "./errors.js";
import { getOp } from "./registry.js";

export interface KitClientOptions {
  token: string;
  /** Default: https://api.kit.yandex.net */
  baseUrl?: string;
  /** Requests per second (token bucket capacity). Default: 3. */
  rps?: number;
  /** Per-attempt timeout in milliseconds. Default: 30000. */
  timeoutMs?: number;
  /**
   * Maximum number of retries after the first attempt. Default: 3.
   * Applies to GET requests only: POST/PATCH/PUT/DELETE always make exactly
   * one network attempt regardless of this setting.
   */
  maxRetries?: number;
  /** Base delay for exponential backoff in milliseconds. Default: 500. */
  retryBaseMs?: number;
  fetchImpl?: typeof fetch;
}

export interface CallParams {
  pathParams?: Record<string, string | number>;
  query?: Record<string, unknown>;
  body?: unknown;
}

interface RawRequest {
  method: string;
  path: string;
  query?: Record<string, unknown>;
  body?: unknown;
  contentType?: string;
}

const DEFAULT_BASE_URL = "https://api.kit.yandex.net";
const LIST_ALL_PER_PAGE = 100;

/**
 * Per-operation per_page caps enforced by the live API that are stricter than
 * the published OpenAPI spec (the spec allows up to 100 everywhere, but these
 * endpoints reject larger values with HTTP 400 VALIDATION_ERROR).
 */
export const SERVER_PER_PAGE_LIMITS = {
  GetPromocodes: 25,
} as const;

/** Codes of a parsed KIT error body. LIMIT_EXCEEDED arrives with HTTP 400. */
const RETRYABLE_400_CODE = "LIMIT_EXCEEDED";

/**
 * Ceiling for a server-provided Retry-After delay: the header is unbounded and
 * server-controlled, and timeoutMs covers only the fetch — not this sleep.
 */
const RETRY_AFTER_CAP_MS = 30_000;

// NOTE: the timer must stay ref'd — an in-flight request awaiting its backoff
// delay has to keep the event loop (and thus the process) alive.
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Promise-based FIFO token bucket: capacity = rps tokens, refilled
 * continuously at rps tokens/second. A single pending timer is kept while the
 * queue is non-empty and cleared as soon as it drains; the timer stays ref'd
 * so queued requests keep the process alive until they are dispatched.
 */
class TokenBucket {
  private tokens: number;
  private lastRefill: number;
  private queue: Array<() => void> = [];
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly rps: number) {
    this.tokens = rps; // allow an initial burst of up to rps requests
    this.lastRefill = Date.now();
  }

  acquire(): Promise<void> {
    return new Promise((resolve) => {
      this.queue.push(resolve);
      this.drain();
    });
  }

  private refill(): void {
    const now = Date.now();
    // Clamp at 0: a backward wall-clock step (NTP) would drive tokens negative.
    const elapsedSec = Math.max(0, now - this.lastRefill) / 1000;
    this.lastRefill = now;
    // Cap at no less than 1 token: with rps < 1 a cap of exactly rps would
    // never let tokens reach the 1 needed to dispatch (permanent stall).
    const capacity = Math.max(this.rps, 1);
    this.tokens = Math.min(capacity, this.tokens + elapsedSec * this.rps);
  }

  private drain(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.refill();
    while (this.queue.length > 0 && this.tokens >= 1) {
      this.tokens -= 1;
      const release = this.queue.shift()!;
      release();
    }
    if (this.queue.length > 0) {
      const waitMs = Math.max(1, Math.ceil(((1 - this.tokens) / this.rps) * 1000));
      this.timer = setTimeout(() => {
        this.timer = null;
        this.drain();
      }, waitMs);
    }
  }
}

function buildQueryString(query?: Record<string, unknown>): string {
  if (!query) return "";
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item === undefined || item === null) continue;
        sp.append(key, String(item));
      }
    } else {
      sp.append(key, String(value));
    }
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

function parseRetryAfterMs(res: Response): number | undefined {
  const header = res.headers.get("retry-after");
  if (!header) return undefined;
  const seconds = Number.parseInt(header, 10);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : undefined;
}

export class KitClient {
  private readonly token: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly retryBaseMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly bucket: TokenBucket;

  constructor(opts: KitClientOptions) {
    this.token = opts.token;
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.timeoutMs = opts.timeoutMs ?? 30_000;
    this.maxRetries = opts.maxRetries ?? 3;
    this.retryBaseMs = opts.retryBaseMs ?? 500;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    const rps = opts.rps ?? 3;
    if (!Number.isFinite(rps) || rps <= 0) {
      throw new KitValidationError(`rps must be a positive number, got: ${rps}`);
    }
    this.bucket = new TokenBucket(rps);
  }

  /** Execute an operation from the generated registry by its operationId. */
  async call<T = unknown>(operationId: string, params: CallParams = {}): Promise<T> {
    const op = getOp(operationId);
    let path = op.path;
    for (const name of op.pathParams) {
      const value = params.pathParams?.[name];
      if (value === undefined || value === null) {
        throw new KitValidationError(
          `Missing path parameter "${name}" for operation ${operationId}`,
          [],
          "MISSING_PATH_PARAM",
        );
      }
      path = path.replace(`{${name}}`, encodeURIComponent(String(value)));
    }
    return this.request<T>({
      method: op.method,
      path,
      query: params.query,
      body: params.body,
      contentType: op.requestContentType ?? undefined,
    });
  }

  /** Low-level request with rate limiting, timeout and retries. */
  async request<T = unknown>(req: RawRequest): Promise<T> {
    const url = this.baseUrl + req.path + buildQueryString(req.query);
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      Accept: "application/json",
    };
    let body: BodyInit | undefined;
    if (req.body !== undefined) {
      const contentType = req.contentType ?? "application/json";
      if (contentType === "multipart/form-data") {
        // Let fetch set the multipart boundary header itself.
        body = req.body as BodyInit;
      } else {
        headers["Content-Type"] = contentType;
        body = JSON.stringify(req.body);
      }
    }
    const method = req.method.toUpperCase();
    const init: RequestInit = { method, headers, body };

    // Only GET is safe to retry automatically: a mutation whose attempt timed
    // out or failed mid-flight may still have been executed by the server, so
    // repeating it could duplicate the write. Until the API documents an
    // idempotency contract, mutations get exactly one network attempt and the
    // original error (with its ambiguity) surfaces to the caller.
    const retryBudget = method === "GET" ? this.maxRetries : 0;

    for (let attempt = 0; ; attempt++) {
      await this.bucket.acquire();

      let res: Response;
      let text: string;
      try {
        const result = await this.fetchWithTimeout(url, init);
        res = result.res;
        text = result.text;
      } catch (err) {
        // Network failure or per-attempt timeout (abort): retryable for GET.
        if (attempt < retryBudget) {
          await sleep(this.backoffDelayMs(attempt));
          continue;
        }
        throw err;
      }

      if (res.ok) {
        if (res.status === 204 || text.trim() === "") return undefined as T;
        try {
          return JSON.parse(text) as T;
        } catch {
          throw new KitApiError(
            res.status,
            "INVALID_JSON",
            `Failed to parse response body as JSON: ${text.slice(0, 500)}`,
          );
        }
      }

      let parsed: { code?: string; message?: string; trace_id?: string } | undefined;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = undefined;
      }

      const retryable =
        res.status === 429 ||
        res.status >= 500 ||
        (res.status === 400 && parsed?.code === RETRYABLE_400_CODE);
      if (retryable && attempt < retryBudget) {
        const headerMs = parseRetryAfterMs(res);
        const delay =
          headerMs !== undefined
            ? Math.min(headerMs, RETRY_AFTER_CAP_MS)
            : this.backoffDelayMs(attempt);
        await sleep(delay);
        continue;
      }

      if (parsed && typeof parsed === "object" && typeof parsed.code === "string") {
        throw new KitApiError(
          res.status,
          parsed.code,
          parsed.message ?? `HTTP ${res.status}`,
          parsed.trace_id,
          parsed,
        );
      }
      throw new KitApiError(res.status, "HTTP_ERROR", text.slice(0, 500));
    }
  }

  /**
   * Fetch all pages of a paginated list operation (per_page=100, or the
   * operation's SERVER_PER_PAGE_LIMITS cap when the live API enforces less).
   * Stops on a short page or once maxItems is reached (truncated=true).
   * total_count is passed through from the API response when it carries one.
   */
  async listAll<T = unknown>(
    operationId: string,
    params: CallParams = {},
    opts: { maxItems?: number } = {},
  ): Promise<{ items: T[]; pages: number; truncated: boolean; total_count?: number }> {
    const op = getOp(operationId);
    if (!op.paginated || !op.itemsProp) {
      throw new KitValidationError(
        `Operation ${operationId} is not a paginated list operation`,
        [],
        "NOT_PAGINATED",
      );
    }
    const itemsProp = op.itemsProp;
    const maxItems = opts.maxItems ?? 500;
    const perPage = Math.min(
      LIST_ALL_PER_PAGE,
      (SERVER_PER_PAGE_LIMITS as Record<string, number>)[operationId] ?? LIST_ALL_PER_PAGE,
    );
    const items: T[] = [];
    let pages = 0;
    let truncated = false;
    let totalCount: number | undefined;

    for (let page = 1; ; page++) {
      const res = await this.call<Record<string, unknown>>(operationId, {
        ...params,
        query: { ...params.query, page, per_page: perPage },
      });
      pages++;
      const raw = res?.[itemsProp];
      const pageItems = Array.isArray(raw) ? (raw as T[]) : [];
      if (typeof res?.total_count === "number") totalCount = res.total_count;

      const room = maxItems - items.length;
      if (pageItems.length > room) {
        items.push(...pageItems.slice(0, room));
        truncated = true;
        break;
      }
      items.push(...pageItems);
      if (pageItems.length < perPage) break; // last page
      if (items.length >= maxItems) {
        truncated = true; // cap hit exactly on a full page — more may exist
        break;
      }
    }
    // A server that silently clamps per_page ends the loop on a "short" page;
    // fewer items than total_count must never be presented as complete.
    if (!truncated && totalCount !== undefined && items.length < totalCount) {
      truncated = true;
    }
    return { items, pages, truncated, ...(totalCount !== undefined ? { total_count: totalCount } : {}) };
  }

  private backoffDelayMs(attempt: number): number {
    const base = this.retryBaseMs * 2 ** attempt;
    return base + Math.random() * base * 0.25; // +0-25% jitter
  }

  private async fetchWithTimeout(
    url: string,
    init: RequestInit,
  ): Promise<{ res: Response; text: string }> {
    const controller = new AbortController();
    // Ref'd on purpose (cleared in finally): an unref'd abort timer could let
    // the process exit mid-request when no other handle keeps the loop alive.
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(url, { ...init, signal: controller.signal });
      const text = res.status === 204 ? "" : await res.text();
      return { res, text };
    } finally {
      clearTimeout(timer);
    }
  }
}
