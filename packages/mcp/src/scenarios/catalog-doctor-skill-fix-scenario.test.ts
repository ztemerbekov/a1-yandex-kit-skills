import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  CATALOG_FIX_BATCH_LIMIT,
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
  assert.match(report, /Исправлено \(1\)[\s\S]*SKU-42 \(variant-42\)/iu);
  assert.match(report, /Не исправлено \(0\)/iu);
  assert.match(report, /Неоднозначно \(0\)/iu);
  assert.doesNotMatch(report, /подтверд/iu);
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
  assert.match(report, /Не исправлено \(1\)/iu);
  assert.match(report, /variant lookup unavailable/iu);
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
  assert.match(report, /Исправлено \(1\)/iu);
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
  assert.match(report, /Неоднозначно \(1\)/iu);
  assert.match(report, /остатк/iu);
  assert.match(report, /источник правильных количеств/iu);
  assert.match(report, /SKU|склад|warehouse/iu);
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
  assert.match(report, /Исправлено \(1\)/iu);
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
  assert.match(report, /Исправлено \(1\)/iu);
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
  assert.match(report, /Исправлено \(1\)[\s\S]*ARCH-1/iu);
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
  assert.match(report, /Неоднозначно \(1\)/iu);
  assert.match(report, /архивировать, восстановить или безвозвратно удалить/iu);
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
  assert.match(report, /Исправлено \(2\)[\s\S]*SKU-A[\s\S]*SKU-C/iu);
  assert.match(report, /Не исправлено \(1\)[\s\S]*SKU-B[\s\S]*validation failed/iu);
  assert.match(report, /Неоднозначно \(0\)/iu);
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
  assert.match(report, /Исправлено \(1\)[\s\S]*SKU-A/iu);
  assert.match(
    report,
    /Неоднозначно \(2\)[\s\S]*SKU-B[\s\S]*точная числовая цена/iu,
  );
  assert.match(report, /SKU-C[\s\S]*конфликтующие цены 300 и 400/iu);
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
  assert.match(report, /Исправлено \(1\)/iu);
  assert.match(report, /соседние склады сохранены/iu);
  assert.match(report, /Неоднозначно \(0\)/iu);
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
  assert.match(report, /Неоднозначно \(1\)/iu);
  assert.match(report, /результат неизвестен, нужна проверка/iu);
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
  assert.match(report, /Неоднозначно \(1\)/iu);
  assert.match(report, /результат неизвестен, нужна проверка/iu);
  assert.doesNotMatch(report, /Не исправлено \(1\)/iu);
});

test("the catalog doctor documents authoritative sources, array preservation and no invented values", () => {
  const skillRoot = new URL(
    "../../../../skills/a1-yandex-kit-catalog-doctor/",
    import.meta.url,
  );
  const skill = readFileSync(new URL("SKILL.md", skillRoot), "utf8");
  const exactWriteProtocol = readFileSync(
    new URL("references/exact-write-protocol.md", skillRoot),
    "utf8",
  );
  const catalogFixOperations = readFileSync(
    new URL("references/catalog-fix-operations.md", skillRoot),
    "utf8",
  );
  const contractText = `${exactWriteProtocol}\n${catalogFixOperations}`;

  for (const expected of [
    "owner-named authoritative source",
    "Never invent a",
    "Variant.stocks",
    "Variant.media",
    "Variant.characteristics",
    "Product.category_ids",
    "Product.settings",
    "without another confirmation",
    "result unknown",
  ]) {
    const pattern =
      expected === "result unknown"
        ? /результат неизвестен, нужна проверка/iu
        : expected === "without another confirmation"
          ? /without another\s+confirmation/iu
        : new RegExp(expected.replace(".", "\\."), "iu");
    assert.match(contractText, pattern, expected);
  }

  for (const reference of [
    "audit-protocol.md",
    "core-catalog-audit.md",
    "structural-audit.md",
    "merchandising-audit.md",
    "exact-write-protocol.md",
    "catalog-fix-operations.md",
  ]) {
    assert.match(
      skill,
      new RegExp(
        `\\[\\s*(?:\\d+\\. )?\`?references/${reference.replace(".", "\\.")}\`?\\s*\\]` +
          `\\(references/${reference.replace(".", "\\.")}\\)`,
        "u",
      ),
      reference,
    );
    assert.doesNotThrow(() =>
      readFileSync(new URL(`references/${reference}`, skillRoot), "utf8"),
    );
  }

  assert.doesNotMatch(skill, /Scenario evaluation contract/u);
});

test("the shared exact-write protocol is generated identically into both skills", () => {
  const source = readFileSync(
    new URL(
      "../../../../packages/codegen/src/skill-src/references/exact-write-protocol.md",
      import.meta.url,
    ),
    "utf8",
  );
  const generatedHeader =
    "<!-- Generated from packages/codegen/src/skill-src/references/exact-write-protocol.md; do not edit. -->\n\n";
  const catalogCopy = readFileSync(
    new URL(
      "../../../../skills/a1-yandex-kit-catalog-doctor/references/exact-write-protocol.md",
      import.meta.url,
    ),
    "utf8",
  );
  const operatorCopy = readFileSync(
    new URL(
      "../../../../skills/a1-yandex-kit-operator/references/exact-write-protocol.md",
      import.meta.url,
    ),
    "utf8",
  );

  assert.equal(catalogCopy, generatedHeader + source);
  assert.equal(operatorCopy, catalogCopy);
});
