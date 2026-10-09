import { test } from "node:test";
import assert from "node:assert/strict";

import {
  executeVerifiedMutation,
  mutationResultIsAmbiguous,
} from "./skill-mutation-protocol.js";

interface Collection {
  id: string;
  title: string;
  description: string;
  seo_title: string;
  seo_h1: string;
  seo_description: string;
  is_available_in_ad_feed: boolean;
  slug: string;
  status: "ACTIVE" | "INACTIVE";
  created_at: string;
  updated_at: string;
  cards_count: number;
  hidden_cards_count: number;
  collection_type: "DYNAMIC" | "STATIC";
  collection_sort: "OLDEST" | "NEWEST" | "SORT_WEIGHT" | "CHEAPEST" | "EXPENSIVE" | "MANUAL";
  dynamic_filter: {
    category_slugs?: string[];
    main_filter?: Array<Record<string, unknown>>;
    characteristic_filters?: Array<Record<string, unknown>>;
  };
}

function collection(id: string, overrides: Partial<Collection> = {}): Collection {
  return {
    id,
    title: "Brand",
    description: "Brand collection",
    seo_title: "Brand",
    seo_h1: "Brand",
    seo_description: "Brand collection",
    is_available_in_ad_feed: false,
    slug: "brand",
    status: "ACTIVE",
    created_at: "2026-10-09T00:00:00Z",
    updated_at: "2026-10-09T00:00:00Z",
    cards_count: 0,
    hidden_cards_count: 0,
    collection_type: "DYNAMIC",
    collection_sort: "NEWEST",
    dynamic_filter: {
      category_slugs: ["brand-a"],
      characteristic_filters: [
        { field: "brand", operator: "IN", values: ["A1"] },
      ],
    },
    ...overrides,
  };
}

const expected = collection("created-1", {
  // Deliberately reverse object-field order: matching must canonicalize it.
  dynamic_filter: {
    characteristic_filters: [
      { field: "brand", operator: "IN", values: ["A1"] },
    ],
    category_slugs: ["brand-a"],
  },
});

const preexisting = collection("before-1", {
  title: "Existing",
  slug: "existing",
  dynamic_filter: { category_slugs: ["other"] },
});

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonical(item)]),
    );
  }
  return value;
}

function verify(after: Collection[], before: Collection[]) {
  const beforeIds = new Set(before.map((item) => item.id));
  const matches = after.filter((item) =>
    !beforeIds.has(item.id) &&
    item.collection_type === expected.collection_type &&
    item.title === expected.title &&
    item.slug === expected.slug &&
    item.status === expected.status &&
    JSON.stringify(canonical(item.dynamic_filter)) === JSON.stringify(canonical(expected.dynamic_filter)),
  );
  return {
    valid: matches.length === 1,
    message:
      matches.length === 1
        ? `наблюдена полная коллекция ${matches[0]!.id}; ACK текущей записи не установлен`
        : `ожидалась одна полная совпадающая коллекция, найдено ${matches.length}`,
  };
}

test("429 and LIMIT_EXCEEDED are mutation-ambiguous, while ordinary 400 is not", () => {
  assert.equal(mutationResultIsAmbiguous(Object.assign(new Error("limited"), { status: 429 })), true);
  assert.equal(mutationResultIsAmbiguous(new Error("rate limited")), true);
  assert.equal(
    mutationResultIsAmbiguous(Object.assign(new Error("rate limited"), { status: 400, code: "LIMIT_EXCEEDED" })),
    true,
  );
  assert.equal(
    mutationResultIsAmbiguous(Object.assign(new Error("invalid body"), { status: 400, code: "VALIDATION_ERROR" })),
    false,
  );
});

test("a stored-then-429 collection is read back and adopted by ID without claiming authorship", async () => {
  let collections: Collection[] = [preexisting];
  let postCount = 0;
  const trace: string[] = [];
  const outcome = await executeVerifiedMutation<Collection[]>({
    subject: "коллекция Brand",
    read: async () => {
      trace.push("GET");
      return collections.map((item) => ({ ...item }));
    },
    write: async (before) => {
      trace.push("POST");
      assert.deepEqual(before.map((item) => item.id), [preexisting.id]);
      postCount++;
      collections = [...collections, expected];
      throw Object.assign(new Error("limited"), { status: 429 });
    },
    verifyAfter: (after, before) => {
      trace.push("VERIFY");
      return verify(after, before);
    },
  });

  assert.equal(postCount, 1);
  assert.deepEqual(trace, ["GET", "POST", "GET", "VERIFY"]);
  assert.equal(collections.length, 2);
  assert.equal(collections[1]!.id, expected.id);
  assert.equal(outcome.kind, "ambiguous");
  assert.match(outcome.message, new RegExp(expected.id));
  assert.match(outcome.message, /результат неизвестен/);
  assert.match(outcome.message, /ACK текущей записи не установлен/);
});

test("a 429 no commit, conflicting matches and a same-title different filter stay unresolved", async () => {
  const cases: Array<{ name: string; after: Collection[] }> = [
    { name: "no commit", after: [preexisting] },
    { name: "conflict", after: [preexisting, expected, { ...expected, id: "created-2" }] },
    {
      name: "same title with another filter",
      after: [
        {
          ...preexisting,
          id: "other-filter",
          title: expected.title,
          slug: expected.slug,
          dynamic_filter: { category_slugs: ["other"] },
        },
      ],
    },
  ];

  for (const item of cases) {
    let postCount = 0;
    let verifyCount = 0;
    let collections = [preexisting];
    const outcome = await executeVerifiedMutation<Collection[]>({
      subject: item.name,
      read: async () => collections.map((current) => ({ ...current })),
      write: async () => {
        postCount++;
        collections = item.after;
        throw Object.assign(new Error("limited"), { status: 429 });
      },
      verifyAfter: (after, before) => {
        verifyCount++;
        return verify(after, before);
      },
    });
    assert.equal(postCount, 1, `${item.name}: one write attempt`);
    assert.equal(verifyCount, 1, `${item.name}: readback is verified`);
    assert.equal(outcome.kind, "ambiguous", `${item.name}: unresolved outcome`);
  }
});

test("an incomplete readback remains ambiguous after one write attempt", async () => {
  let reads = 0;
  let postCount = 0;
  const outcome = await executeVerifiedMutation<Collection[]>({
    subject: "incomplete collection listing",
    read: async () => {
      reads++;
      if (reads > 1) throw new Error("page 2 unavailable");
      return [preexisting];
    },
    write: async () => {
      postCount++;
      throw Object.assign(new Error("limited"), { status: 429 });
    },
    verifyAfter: verify,
  });

  assert.equal(postCount, 1);
  assert.equal(reads, 2);
  assert.equal(outcome.kind, "ambiguous");
  assert.match(outcome.message, /повторное чтение не удалось/);
});
