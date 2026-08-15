import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CATALOG_FIX_BATCH_LIMIT,
  CATALOG_VIDEO_POLL_INTERVAL_MS,
  CATALOG_VIDEO_POLL_LIMIT,
  FakeCatalogDoctorFixMcp,
  runCatalogDoctorFixScenario,
} from "./catalog-doctor-skill-fix-scenario.js";
import type { CatalogVariant } from "./catalog-doctor-skill-scenario.js";

function variant(overrides: Partial<CatalogVariant> = {}): CatalogVariant {
  return {
    id: "variant-42",
    sku: "SKU-42",
    name: "Товар 42",
    slug: "sku-42",
    description: "Описание",
    brand: "A1",
    status: "PUBLISHED",
    product_id: "product-1",
    product_card_id: "card-1",
    characteristics: [],
    pricing: { price: "1000.00", final_price: "1000.00" },
    stocks: [
      { warehouse_id: "warehouse-1", quantity: 2, reserved: 0 },
      { warehouse_id: "warehouse-2", quantity: 8, reserved: 2 },
    ],
    media: [
      { type: "IMAGE", image_id: "image-1", display_sequence: 1 },
      { type: "VIDEO", video_id: "video-1", display_sequence: 2 },
    ],
    ...overrides,
  };
}

test("an exact price command performs read, one write and re-read without another question", async () => {
  const mcp = new FakeCatalogDoctorFixMcp({
    variants: [variant()],
  });

  const { report } = await runCatalogDoctorFixScenario({
    request: "Поставь цену 4 990 для SKU-42",
    mcp,
  });

  assert.deepEqual(
    mcp.calls.map((call) => call.name),
    ["list_variants", "get_variant", "update_variant", "get_variant"],
  );
  assert.deepEqual(mcp.writeCalls[0]?.arguments, {
    id: "variant-42",
    variant: { pricing: { price: "4990" } },
  });
  assert.equal(mcp.variantById("variant-42")?.pricing.price, "4990");
});

test("a target lookup error is reported and never reaches a catalog write", async () => {
  const mcp = new FakeCatalogDoctorFixMcp({
    variants: [variant()],
    readErrors: {
      "list_variants:1": new Error("variant lookup unavailable"),
    },
  });

  const { report } = await runCatalogDoctorFixScenario({
    request: "Поставь цену 4 990 для SKU-42",
    mcp,
  });

  assert.equal(mcp.writeCalls.length, 0);
});

test("an explicit UUID bypasses list lookup and reuses its detail read", async () => {
  const id = "00000000-0000-4000-8000-000000000042";
  const mcp = new FakeCatalogDoctorFixMcp({
    variants: [variant({ id, sku: "PRIMARY" })],
    readErrors: {
      list_variants: new Error("variant lookup unavailable"),
    },
  });

  const { report } = await runCatalogDoctorFixScenario({
    request: `Поставь цену 4 990 для ${id}`,
    mcp,
  });

  assert.deepEqual(
    mcp.calls.map((call) => call.name),
    ["get_variant", "update_variant", "get_variant"],
  );
});

test("an unspecified stock repair asks one grouped source question and performs no write", async () => {
  const mcp = new FakeCatalogDoctorFixMcp({
    variants: [variant()],
  });

  const { report } = await runCatalogDoctorFixScenario({
    request: "Исправь остатки",
    mcp,
  });

  assert.equal(mcp.writeCalls.length, 0);
});

test("one stock change preserves every sibling warehouse entry", async () => {
  const mcp = new FakeCatalogDoctorFixMcp({
    variants: [variant()],
  });

  const { report } = await runCatalogDoctorFixScenario({
    request: "Поставь остаток 7 на складе warehouse-1 для SKU-42",
    mcp,
  });

  assert.deepEqual(mcp.writeCalls[0]?.arguments, {
    id: "variant-42",
    variant: {
      stocks: [
        { warehouse_id: "warehouse-1", quantity: 7, reserved: 0 },
        { warehouse_id: "warehouse-2", quantity: 8, reserved: 2 },
      ],
    },
  });
  assert.deepEqual(mcp.variantById("variant-42")?.stocks, [
    { warehouse_id: "warehouse-1", quantity: 7, reserved: 0 },
    { warehouse_id: "warehouse-2", quantity: 8, reserved: 2 },
  ]);
});

test("one image addition preserves every sibling media entry", async () => {
  const mcp = new FakeCatalogDoctorFixMcp({
    variants: [variant()],
  });

  const { report } = await runCatalogDoctorFixScenario({
    request: "Добавь изображение image-2 на позицию 3 для SKU-42",
    mcp,
  });

  assert.deepEqual(mcp.writeCalls[0]?.arguments, {
    id: "variant-42",
    variant: {
      media: [
        { type: "IMAGE", image_id: "image-1", display_sequence: 1 },
        { type: "VIDEO", video_id: "video-1", display_sequence: 2 },
        { type: "IMAGE", image_id: "image-2", display_sequence: 3 },
      ],
    },
  });
  assert.equal(mcp.variantById("variant-42")?.media.length, 3);
});

test("an exact public-link video command uploads, polls, links and verifies the full media list", async () => {
  const mcp = new FakeCatalogDoctorFixMcp({
    variants: [
      variant({
        media: [
          { type: "IMAGE", image_id: "image-1", display_sequence: 1 },
          { type: "OTHER", display_sequence: 2 },
        ],
      }),
    ],
    uploadedVideoId: "video-from-url",
    videoStatusSequence: ["PROCESSING", "READY"],
  });

  await runCatalogDoctorFixScenario({
    request:
      "Добавь видео по ссылке https://cdn.example.com/video.mp4 на позицию 3 для SKU-42",
    mcp,
  });

  assert.deepEqual(
    mcp.calls.map((call) => call.name),
    [
      "list_variants",
      "get_variant",
      "upload_video_from_url",
      "get_video",
      "get_video",
      "update_variant",
      "get_variant",
    ],
  );
  assert.deepEqual(mcp.writeCalls.map((call) => call.name), [
    "upload_video_from_url",
    "update_variant",
  ]);
  assert.deepEqual(mcp.writeCalls[0]?.arguments, {
    url: "https://cdn.example.com/video.mp4",
  });
  assert.deepEqual(
    mcp.calls
      .filter((call) => call.name === "get_video")
      .map((call) => call.arguments),
    [
      { video_id: "video-from-url" },
      { video_id: "video-from-url" },
    ],
  );
  assert.deepEqual(mcp.videoPollDelays, [CATALOG_VIDEO_POLL_INTERVAL_MS]);
  assert.deepEqual(mcp.variantById("variant-42")?.media, [
    { type: "IMAGE", image_id: "image-1", display_sequence: 1 },
    { type: "OTHER", display_sequence: 2 },
    { type: "VIDEO", video_id: "video-from-url", display_sequence: 3 },
  ]);
});

test("a public-link video command leaves a variant without an image unchanged", async () => {
  const initial = variant({ media: [] });
  const mcp = new FakeCatalogDoctorFixMcp({ variants: [initial] });

  await runCatalogDoctorFixScenario({
    request:
      "Добавь видео по ссылке https://cdn.example.com/video.mp4 на позицию 1 для SKU-42",
    mcp,
  });

  assert.deepEqual(mcp.calls.map((call) => call.name), [
    "list_variants",
    "get_variant",
  ]);
  assert.equal(mcp.writeCalls.length, 0);
  assert.deepEqual(mcp.variantById("variant-42")?.media, initial.media);
});

test("an add command preserves an existing video until replacement is explicitly authorized", async () => {
  const initial = variant();
  const mcp = new FakeCatalogDoctorFixMcp({ variants: [initial] });

  await runCatalogDoctorFixScenario({
    request:
      "Добавь видео по ссылке https://cdn.example.com/new.mp4 на позицию 3 для SKU-42",
    mcp,
  });

  assert.deepEqual(mcp.calls.map((call) => call.name), [
    "list_variants",
    "get_variant",
  ]);
  assert.equal(mcp.writeCalls.length, 0);
  assert.deepEqual(mcp.variantById("variant-42")?.media, initial.media);
});

test("a video processing error keeps the uploaded video separate from the variant", async () => {
  const initial = variant({
    media: [{ type: "IMAGE", image_id: "image-1", display_sequence: 1 }],
  });
  const mcp = new FakeCatalogDoctorFixMcp({
    variants: [initial],
    uploadedVideoId: "video-error",
    videoStatusSequence: ["ERROR"],
  });

  await runCatalogDoctorFixScenario({
    request:
      "Добавь видео по ссылке https://cdn.example.com/error.mp4 на позицию 2 для SKU-42",
    mcp,
  });

  assert.deepEqual(mcp.writeCalls.map((call) => call.name), [
    "upload_video_from_url",
  ]);
  assert.equal(
    mcp.calls.filter((call) => call.name === "get_video").length,
    1,
  );
  assert.ok(!mcp.calls.some((call) => call.name === "update_variant"));
  assert.deepEqual(mcp.variantById("variant-42")?.media, initial.media);
});

test("an exhausted video polling bound never links a non-ready video", async () => {
  const initial = variant({
    media: [{ type: "IMAGE", image_id: "image-1", display_sequence: 1 }],
  });
  const mcp = new FakeCatalogDoctorFixMcp({
    variants: [initial],
    uploadedVideoId: "video-processing",
    videoStatusSequence: ["PROCESSING"],
  });

  await runCatalogDoctorFixScenario({
    request:
      "Добавь видео по ссылке https://cdn.example.com/slow.mp4 на позицию 2 для SKU-42",
    mcp,
  });

  assert.equal(
    mcp.calls.filter((call) => call.name === "get_video").length,
    CATALOG_VIDEO_POLL_LIMIT,
  );
  assert.equal(
    mcp.videoPollDelays.length,
    CATALOG_VIDEO_POLL_LIMIT - 1,
  );
  assert.ok(
    mcp.videoPollDelays.every(
      (milliseconds) => milliseconds >= CATALOG_VIDEO_POLL_INTERVAL_MS,
    ),
  );
  assert.ok(!mcp.calls.some((call) => call.name === "update_variant"));
  assert.deepEqual(mcp.variantById("variant-42")?.media, initial.media);
});

test("permanent deletion needs the exact verb and archived target, then verifies not-found", async () => {
  const mcp = new FakeCatalogDoctorFixMcp({
    variants: [
      variant({
        id: "variant-archived",
        sku: "ARCH-1",
        slug: "arch-1",
        name: "Архивный товар",
        status: "ARCHIVED",
      }),
    ],
  });

  const { report } = await runCatalogDoctorFixScenario({
    request: "Безвозвратно удали SKU ARCH-1",
    mcp,
  });

  assert.deepEqual(
    mcp.calls.map((call) => call.name),
    ["list_variants", "get_variant", "kit_request", "get_variant"],
  );
  assert.deepEqual(mcp.writeCalls[0]?.arguments, {
    operation_id: "DeleteVariant",
    path_params: { id: "variant-archived" },
  });
  assert.equal(mcp.writeCalls.length, 1);
  assert.equal(mcp.variantById("variant-archived"), undefined);
});

test("an ordinary delete verb never substitutes archive or permanent deletion", async () => {
  const mcp = new FakeCatalogDoctorFixMcp({
    variants: [
      variant({
        id: "variant-archived",
        sku: "ARCH-1",
        status: "ARCHIVED",
      }),
    ],
  });

  const { report } = await runCatalogDoctorFixScenario({
    request: "Удали SKU ARCH-1",
    mcp,
  });

  assert.equal(mcp.writeCalls.length, 0);
});

test("a price batch respects the limit, continues after a local error and keeps every outcome", async () => {
  const mcp = new FakeCatalogDoctorFixMcp({
    variants: [
      variant({ id: "variant-a", sku: "SKU-A", slug: "sku-a" }),
      variant({ id: "variant-b", sku: "SKU-B", slug: "sku-b" }),
      variant({ id: "variant-c", sku: "SKU-C", slug: "sku-c" }),
    ],
    mutationErrors: {
      "update_variant:variant-b": new Error("validation failed"),
    },
  });

  const { report } = await runCatalogDoctorFixScenario({
    request: "Поставь цены: SKU-A=100, SKU-B=200, SKU-C=300",
    mcp,
  });

  assert.equal(CATALOG_FIX_BATCH_LIMIT, 100);
  assert.equal(mcp.writeCalls.length, 3);
  assert.equal(mcp.writeCalls.filter((call) => call.arguments.id === "variant-b").length, 1);
  assert.equal(mcp.variantById("variant-a")?.pricing.price, "100");
  assert.equal(mcp.variantById("variant-b")?.pricing.price, "1000.00");
  assert.equal(mcp.variantById("variant-c")?.pricing.price, "300");
});

test("a price batch reports malformed and conflicting entries without writing their targets", async () => {
  const mcp = new FakeCatalogDoctorFixMcp({
    variants: [
      variant({ id: "variant-a", sku: "SKU-A", slug: "sku-a" }),
      variant({ id: "variant-b", sku: "SKU-B", slug: "sku-b" }),
      variant({ id: "variant-c", sku: "SKU-C", slug: "sku-c" }),
    ],
  });

  const { report } = await runCatalogDoctorFixScenario({
    request:
      "Поставь цены: SKU-A=100, SKU-B=oops, SKU-C=300, SKU-C=400",
    mcp,
  });

  assert.equal(mcp.writeCalls.length, 1);
  assert.equal(mcp.variantById("variant-a")?.pricing.price, "100");
  assert.equal(mcp.variantById("variant-b")?.pricing.price, "1000.00");
  assert.equal(mcp.variantById("variant-c")?.pricing.price, "1000.00");
});

test("array verification uses the detail read rather than a stale list projection", async () => {
  const detailVariant = variant({
    stocks: [
      { warehouse_id: "warehouse-1", quantity: 2, reserved: 0 },
      { warehouse_id: "warehouse-detail", quantity: 9, reserved: 1 },
    ],
  });
  const listVariant = variant({
    stocks: [{ warehouse_id: "warehouse-1", quantity: 2, reserved: 0 }],
  });
  const mcp = new FakeCatalogDoctorFixMcp({
    variants: [detailVariant],
    listVariants: [listVariant],
  });

  const { report } = await runCatalogDoctorFixScenario({
    request: "Поставь остаток 7 на складе warehouse-1 для SKU-42",
    mcp,
  });

  assert.deepEqual(mcp.variantById("variant-42")?.stocks, [
    { warehouse_id: "warehouse-1", quantity: 7, reserved: 0 },
    { warehouse_id: "warehouse-detail", quantity: 9, reserved: 1 },
  ]);
});

test("a mutation timeout is never retried and remains ambiguous after the re-read", async () => {
  const timeout = new Error("network timeout");
  timeout.name = "TimeoutError";
  const mcp = new FakeCatalogDoctorFixMcp({
    variants: [variant()],
    mutationErrors: {
      "update_variant:variant-42": timeout,
    },
  });

  const { report } = await runCatalogDoctorFixScenario({
    request: "Поставь цену 4990 для SKU-42",
    mcp,
  });

  assert.equal(mcp.writeCalls.length, 1);
  assert.equal(
    mcp.calls.filter((call) => call.name === "get_variant").length,
    2,
  );
});

test("a mutation 5xx is never treated as a confirmed no-op or retried", async () => {
  const serverError = Object.assign(new Error("internal server error"), {
    status: 500,
  });
  const mcp = new FakeCatalogDoctorFixMcp({
    variants: [variant()],
    mutationErrors: {
      "update_variant:variant-42": serverError,
    },
  });

  const { report } = await runCatalogDoctorFixScenario({
    request: "Поставь цену 4990 для SKU-42",
    mcp,
  });

  assert.equal(mcp.writeCalls.length, 1);
  assert.equal(
    mcp.calls.filter((call) => call.name === "get_variant").length,
    2,
  );
});
