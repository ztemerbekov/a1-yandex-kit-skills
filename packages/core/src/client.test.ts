import { test } from "node:test";
import assert from "node:assert/strict";

import { KitClient } from "./client.js";
import { KitApiError, KitValidationError } from "./errors.js";

interface RecordedCall {
  url: string;
  init: RequestInit;
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

/** Fetch stub that records calls and delegates to a per-call handler. */
function stubFetch(handler: (url: string, init: RequestInit, callIndex: number) => Response) {
  const calls: RecordedCall[] = [];
  const fetchImpl = (async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    const idx = calls.length;
    calls.push({ url, init: init ?? {} });
    return handler(url, init ?? {}, idx);
  }) as typeof fetch;
  return { calls, fetchImpl };
}

function headerOf(init: RequestInit, name: string): string | undefined {
  return (init.headers as Record<string, string> | undefined)?.[name];
}

test("call(GetStore) sends Bearer auth header, correct URL and method", async () => {
  const { calls, fetchImpl } = stubFetch(() => jsonResponse({ id: "s1" }));
  const client = new KitClient({ token: "t", rps: 1000, fetchImpl });

  const store = await client.call<{ id: string }>("GetStore");

  assert.deepEqual(store, { id: "s1" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.url, "https://api.kit.yandex.net/v1/store");
  assert.equal(calls[0]!.init.method, "GET");
  assert.equal(headerOf(calls[0]!.init, "Authorization"), "Bearer t");
});

test("500 then 200 -> retried once and succeeds", async () => {
  const { calls, fetchImpl } = stubFetch((_url, _init, idx) =>
    idx === 0
      ? jsonResponse({ code: "UNKNOWN_ERROR", message: "boom" }, 500)
      : jsonResponse({ id: "s1" }),
  );
  const client = new KitClient({ token: "t", rps: 1000, retryBaseMs: 1, fetchImpl });

  const store = await client.call<{ id: string }>("GetStore");

  assert.deepEqual(store, { id: "s1" });
  assert.equal(calls.length, 2);
});

test("401 with real KIT error body -> KitApiError, no retry", async () => {
  const { calls, fetchImpl } = stubFetch(() =>
    jsonResponse(
      { code: "AUTHENTICATION_ERROR", message: "Ошибка аутентификации", trace_id: "abc" },
      401,
    ),
  );
  const client = new KitClient({ token: "bad", rps: 1000, retryBaseMs: 1, fetchImpl });

  await assert.rejects(client.call("GetStore"), (err: unknown) => {
    assert.ok(err instanceof KitApiError);
    assert.equal(err.status, 401);
    assert.equal(err.code, "AUTHENTICATION_ERROR");
    assert.equal(err.traceId, "abc");
    assert.equal(err.message, "Ошибка аутентификации");
    return true;
  });
  assert.equal(calls.length, 1);
});

test("HTTP 400 with code LIMIT_EXCEEDED -> retried", async () => {
  const { calls, fetchImpl } = stubFetch((_url, _init, idx) =>
    idx === 0
      ? jsonResponse({ code: "LIMIT_EXCEEDED", message: "rate limited", trace_id: "t1" }, 400)
      : jsonResponse({ id: "s1" }),
  );
  const client = new KitClient({ token: "t", rps: 1000, retryBaseMs: 1, fetchImpl });

  const store = await client.call<{ id: string }>("GetStore");

  assert.deepEqual(store, { id: "s1" });
  assert.equal(calls.length, 2);
});

test("persistent 500 -> retries exhausted after maxRetries, then KitApiError", async () => {
  const { calls, fetchImpl } = stubFetch(() =>
    jsonResponse({ code: "UNKNOWN_ERROR", message: "still down" }, 500),
  );
  const client = new KitClient({ token: "t", rps: 1000, retryBaseMs: 1, maxRetries: 2, fetchImpl });

  await assert.rejects(client.call("GetStore"), (err: unknown) => {
    assert.ok(err instanceof KitApiError);
    assert.equal(err.status, 500);
    assert.equal(err.code, "UNKNOWN_ERROR");
    return true;
  });
  assert.equal(calls.length, 3); // initial attempt + maxRetries=2
});

test("429 with Retry-After header -> delay comes from the header, not backoff", async () => {
  const { calls, fetchImpl } = stubFetch((_url, _init, idx) =>
    idx === 0
      ? jsonResponse({ code: "LIMIT_EXCEEDED", message: "slow down" }, 429, {
          "retry-after": "0",
        })
      : jsonResponse({ id: "s1" }),
  );
  // Deliberately huge base backoff: only the Retry-After: 0 path finishes fast.
  const client = new KitClient({ token: "t", rps: 1000, retryBaseMs: 5000, fetchImpl });

  const started = Date.now();
  const store = await client.call<{ id: string }>("GetStore");
  const elapsed = Date.now() - started;

  assert.deepEqual(store, { id: "s1" });
  assert.equal(calls.length, 2);
  assert.ok(elapsed < 2000, `elapsed ${elapsed}ms: Retry-After: 0 was not honored`);
});

test("per-attempt timeout aborts a hung fetch, retries, then throws", async () => {
  const calls: RecordedCall[] = [];
  // Never resolves; rejects only when the client's AbortController fires.
  const fetchImpl = (async (input: unknown, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("attempt aborted")));
    });
  }) as typeof fetch;
  const client = new KitClient({
    token: "t",
    rps: 1000,
    timeoutMs: 20,
    retryBaseMs: 1,
    maxRetries: 1,
    fetchImpl,
  });

  await assert.rejects(client.call("GetStore"), /attempt aborted/);
  assert.equal(calls.length, 2); // each attempt individually timed out
});

test("HTTP 400 with code VALIDATION_ERROR -> not retried", async () => {
  const { calls, fetchImpl } = stubFetch(() =>
    jsonResponse({ code: "VALIDATION_ERROR", message: "bad input", trace_id: "t2" }, 400),
  );
  const client = new KitClient({ token: "t", rps: 1000, retryBaseMs: 1, fetchImpl });

  await assert.rejects(client.call("GetStore"), (err: unknown) => {
    assert.ok(err instanceof KitApiError);
    assert.equal(err.status, 400);
    assert.equal(err.code, "VALIDATION_ERROR");
    return true;
  });
  assert.equal(calls.length, 1);
});

// Mutations must never be retried automatically: the API gives no idempotency
// contract, so a repeated write could duplicate a real change (issue #6).

test("POST network error -> single attempt, original error surfaces", async () => {
  const calls: RecordedCall[] = [];
  const fetchImpl = (async (input: unknown, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    throw new TypeError("fetch failed");
  }) as typeof fetch;
  const client = new KitClient({ token: "t", rps: 1000, retryBaseMs: 1, maxRetries: 3, fetchImpl });

  await assert.rejects(client.call("CreateProduct", { body: { name: "x" } }), /fetch failed/);
  assert.equal(calls.length, 1);
});

test("POST timeout -> single attempt even with maxRetries", async () => {
  const calls: RecordedCall[] = [];
  // Never resolves; rejects only when the client's AbortController fires.
  const fetchImpl = (async (input: unknown, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("attempt aborted")));
    });
  }) as typeof fetch;
  const client = new KitClient({
    token: "t",
    rps: 1000,
    timeoutMs: 20,
    retryBaseMs: 1,
    maxRetries: 3,
    fetchImpl,
  });

  await assert.rejects(client.call("CreateProduct", { body: { name: "x" } }), /attempt aborted/);
  assert.equal(calls.length, 1);
});

test("POST 500 -> not retried, KitApiError surfaces", async () => {
  const { calls, fetchImpl } = stubFetch(() =>
    jsonResponse({ code: "UNKNOWN_ERROR", message: "boom", trace_id: "t3" }, 500),
  );
  const client = new KitClient({ token: "t", rps: 1000, retryBaseMs: 1, fetchImpl });

  await assert.rejects(client.call("CreateProduct", { body: { name: "x" } }), (err: unknown) => {
    assert.ok(err instanceof KitApiError);
    assert.equal(err.status, 500);
    assert.equal(err.code, "UNKNOWN_ERROR");
    assert.equal(err.traceId, "t3");
    return true;
  });
  assert.equal(calls.length, 1);
});

test("POST 429 with Retry-After -> not retried, code/message/traceId preserved", async () => {
  const { calls, fetchImpl } = stubFetch(() =>
    jsonResponse({ code: "LIMIT_EXCEEDED", message: "slow down", trace_id: "t4" }, 429, {
      "retry-after": "0",
    }),
  );
  const client = new KitClient({ token: "t", rps: 1000, retryBaseMs: 1, fetchImpl });

  await assert.rejects(client.call("CreateProduct", { body: { name: "x" } }), (err: unknown) => {
    assert.ok(err instanceof KitApiError);
    assert.equal(err.status, 429);
    assert.equal(err.code, "LIMIT_EXCEEDED");
    assert.equal(err.message, "slow down");
    assert.equal(err.traceId, "t4");
    return true;
  });
  assert.equal(calls.length, 1);
});

test("POST 400 LIMIT_EXCEEDED -> not retried, error details preserved", async () => {
  const { calls, fetchImpl } = stubFetch(() =>
    jsonResponse({ code: "LIMIT_EXCEEDED", message: "rate limited", trace_id: "t5" }, 400),
  );
  const client = new KitClient({ token: "t", rps: 1000, retryBaseMs: 1, fetchImpl });

  await assert.rejects(client.call("CreateProduct", { body: { name: "x" } }), (err: unknown) => {
    assert.ok(err instanceof KitApiError);
    assert.equal(err.status, 400);
    assert.equal(err.code, "LIMIT_EXCEEDED");
    assert.equal(err.traceId, "t5");
    return true;
  });
  assert.equal(calls.length, 1);
});

test("PATCH, PUT and DELETE on 500 -> exactly one attempt each despite maxRetries", async () => {
  const mutations: Array<[string, Parameters<KitClient["call"]>[1]]> = [
    ["UpdateVariant", { pathParams: { id: "v1" }, body: { name: "x" } }],
    [
      "SetVariantExternalID",
      { pathParams: { id: "v1", system_type: "wildberries" }, body: { external_id: "e1" } },
    ],
    ["DeleteWebhook", { pathParams: { webhook_id: "w1" } }],
  ];
  for (const [operationId, params] of mutations) {
    const { calls, fetchImpl } = stubFetch(() =>
      jsonResponse({ code: "UNKNOWN_ERROR", message: "boom" }, 500),
    );
    const client = new KitClient({ token: "t", rps: 1000, retryBaseMs: 1, maxRetries: 5, fetchImpl });

    await assert.rejects(client.call(operationId, params), KitApiError);
    assert.equal(calls.length, 1, `${operationId}: expected exactly one network attempt`);
  }
});

test("GET network error then success -> retried and succeeds", async () => {
  const calls: RecordedCall[] = [];
  const fetchImpl = (async (input: unknown, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    if (calls.length === 1) throw new TypeError("fetch failed");
    return jsonResponse({ id: "s1" });
  }) as typeof fetch;
  const client = new KitClient({ token: "t", rps: 1000, retryBaseMs: 1, fetchImpl });

  const store = await client.call<{ id: string }>("GetStore");

  assert.deepEqual(store, { id: "s1" });
  assert.equal(calls.length, 2);
});

test("call(UpdateVariant) sends PATCH with merge-patch content type", async () => {
  const { calls, fetchImpl } = stubFetch(() => jsonResponse({ id: "v1" }));
  const client = new KitClient({ token: "t", rps: 1000, fetchImpl });

  await client.call("UpdateVariant", {
    pathParams: { id: "v1" },
    body: { price: { amount: "100.00" } },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.url, "https://api.kit.yandex.net/v1/variants/v1");
  assert.equal(calls[0]!.init.method, "PATCH");
  assert.equal(headerOf(calls[0]!.init, "Content-Type"), "application/merge-patch+json");
  assert.equal(calls[0]!.init.body, JSON.stringify({ price: { amount: "100.00" } }));
});

test("missing path param -> KitValidationError before any network call", async () => {
  const { calls, fetchImpl } = stubFetch(() => jsonResponse({}));
  const client = new KitClient({ token: "t", rps: 1000, fetchImpl });

  await assert.rejects(client.call("UpdateVariant", { body: { name: "x" } }), (err: unknown) => {
    assert.ok(err instanceof KitValidationError);
    assert.equal(err.code, "MISSING_PATH_PARAM");
    return true;
  });
  assert.equal(calls.length, 0);
});

test("rate limiter queues calls beyond the burst capacity", async () => {
  const { calls, fetchImpl } = stubFetch(() => jsonResponse({ id: "s1" }));
  // Burst capacity = rps = 20; the remaining 5 of 25 calls must wait for refill.
  const client = new KitClient({ token: "t", rps: 20, fetchImpl });

  const started = Date.now();
  await Promise.all(Array.from({ length: 25 }, () => client.call("GetStore")));
  const elapsed = Date.now() - started;

  assert.equal(calls.length, 25);
  // 5 extra tokens at 20 tokens/sec -> the last call is released at ~250 ms.
  assert.ok(elapsed >= 200, `elapsed ${elapsed}ms should be >= 200ms`);
  assert.ok(elapsed <= 2000, `elapsed ${elapsed}ms should be <= 2000ms`);
});

test("fractional rps below 1 still dispatches requests", async () => {
  const { calls, fetchImpl } = stubFetch(() => jsonResponse({ id: "s1" }));
  // Initial burst is 0.9 tokens; the first token is complete after ~111 ms.
  const client = new KitClient({ token: "t", rps: 0.9, fetchImpl });

  let guard: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    guard = setTimeout(() => reject(new Error("request never dispatched with rps < 1")), 1500);
  });
  try {
    const store = await Promise.race([client.call<{ id: string }>("GetStore"), timeout]);
    assert.deepEqual(store, { id: "s1" });
  } finally {
    clearTimeout(guard);
  }
  assert.equal(calls.length, 1);
});

test("non-positive rps -> KitValidationError from the constructor", () => {
  const { fetchImpl } = stubFetch(() => jsonResponse({}));
  for (const rps of [0, -1, Number.NaN]) {
    assert.throws(() => new KitClient({ token: "t", rps, fetchImpl }), KitValidationError);
  }
});

function variantsPage(count: number, offset: number) {
  return {
    variants: Array.from({ length: count }, (_, i) => ({ id: `v${offset + i}` })),
    total_count: 237,
  };
}

test("listAll collects all pages until a short page", async () => {
  const { calls, fetchImpl } = stubFetch((url) => {
    const page = Number(new URL(url).searchParams.get("page"));
    if (page === 1) return jsonResponse(variantsPage(100, 0));
    if (page === 2) return jsonResponse(variantsPage(100, 100));
    return jsonResponse(variantsPage(37, 200));
  });
  const client = new KitClient({ token: "t", rps: 1000, fetchImpl });

  const result = await client.listAll<{ id: string }>("GetVariants");

  assert.equal(result.items.length, 237);
  assert.equal(result.pages, 3);
  assert.equal(result.truncated, false);
  assert.equal(result.items[0]!.id, "v0");
  assert.equal(result.items[236]!.id, "v236");
  for (const call of calls) {
    assert.equal(new URL(call.url).searchParams.get("per_page"), "100");
  }
});

test("listAll respects maxItems and reports truncation", async () => {
  const { calls, fetchImpl } = stubFetch((url) => {
    const page = Number(new URL(url).searchParams.get("page"));
    return jsonResponse(variantsPage(100, (page - 1) * 100));
  });
  const client = new KitClient({ token: "t", rps: 1000, fetchImpl });

  const result = await client.listAll<{ id: string }>("GetVariants", {}, { maxItems: 150 });

  assert.equal(result.items.length, 150);
  assert.equal(result.truncated, true);
  // Pagination must stop at the cap: 100 + 50 items -> exactly 2 requests.
  assert.equal(result.pages, 2);
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.equal(new URL(call.url).searchParams.get("per_page"), "100");
  }
});

test("listAll honors the server per_page cap for GetPromocodes", async () => {
  const { calls, fetchImpl } = stubFetch((url) => {
    const page = Number(new URL(url).searchParams.get("page"));
    const count = page === 1 ? 25 : 10;
    return jsonResponse({
      promocodes: Array.from({ length: count }, (_, i) => ({ id: `pc${(page - 1) * 25 + i}` })),
      total_count: 35,
    });
  });
  const client = new KitClient({ token: "t", rps: 1000, fetchImpl });

  const result = await client.listAll<{ id: string }>("GetPromocodes", {
    query: { status: "ACTIVE" },
  });

  assert.equal(result.items.length, 35);
  assert.equal(result.pages, 2);
  assert.equal(result.truncated, false);
  for (const call of calls) {
    // The live API rejects per_page > 25 on this endpoint despite the spec's 100.
    assert.equal(new URL(call.url).searchParams.get("per_page"), "25");
    assert.equal(new URL(call.url).searchParams.get("status"), "ACTIVE");
  }
});

test("listAll rejects non-paginated operations without network", async () => {
  const { calls, fetchImpl } = stubFetch(() => jsonResponse({}));
  const client = new KitClient({ token: "t", rps: 1000, fetchImpl });

  await assert.rejects(client.listAll("GetStore"), KitValidationError);
  assert.equal(calls.length, 0);
});

test("204 empty body -> undefined result", async () => {
  const { fetchImpl } = stubFetch(() => new Response(null, { status: 204 }));
  const client = new KitClient({ token: "t", rps: 1000, fetchImpl });

  const result = await client.call("DeleteWebhook", { pathParams: { webhook_id: "w1" } });

  assert.equal(result, undefined);
});

test("large Retry-After header is capped instead of honored verbatim", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { calls, fetchImpl } = stubFetch((_url, _init, idx) =>
    idx === 0
      ? jsonResponse({ code: "LIMIT_EXCEEDED", message: "slow down" }, 429, {
          "retry-after": "7200",
        })
      : jsonResponse({ id: "s1" }),
  );
  const client = new KitClient({ token: "t", rps: 1000, retryBaseMs: 1, fetchImpl });

  const promise = client.call<{ id: string }>("GetStore");
  // Drain the microtask queue (setImmediate is not mocked) until the first
  // attempt has hit the stub and the retry sleep is pending.
  for (let i = 0; i < 50 && calls.length === 0; i++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.equal(calls.length, 1);

  // A verbatim Retry-After: 7200 would sleep two hours; the cap must fire
  // within 30 s of fake time and let the retry proceed.
  t.mock.timers.tick(30_000);
  const store = await promise;
  assert.deepEqual(store, { id: "s1" });
  assert.equal(calls.length, 2);
});
