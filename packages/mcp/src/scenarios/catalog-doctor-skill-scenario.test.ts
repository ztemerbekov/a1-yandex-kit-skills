import assert from "node:assert/strict";
import { test } from "node:test";

import {
  FakeCatalogDoctorMcp,
  runCatalogDoctorScenario,
  type CatalogCategory,
  type CatalogProduct,
  type CatalogVariant,
  type CatalogWarehouse,
} from "./catalog-doctor-skill-scenario.js";

function product(overrides: Partial<CatalogProduct> = {}): CatalogProduct {
  return {
    id: "product-1",
    category_ids: ["category-1"],
    ...overrides,
  };
}

function variant(overrides: Partial<CatalogVariant> = {}): CatalogVariant {
  return {
    id: "variant-1",
    sku: "SKU-1",
    name: "Товар 1",
    slug: "sku-1",
    status: "PUBLISHED",
    product_id: "product-1",
    product_card_id: "card-1",
    pricing: { price: "1000.00", final_price: "900.00" },
    stocks: [{ warehouse_id: "warehouse-1", quantity: 5, reserved: 1 }],
    media: [{ type: "IMAGE", image_id: "image-1", display_sequence: 1 }],
    ...overrides,
  };
}

function category(overrides: Partial<CatalogCategory> = {}): CatalogCategory {
  return {
    id: "category-1",
    title: "Категория 1",
    slug: "category-1",
    status: "ACTIVE",
    ...overrides,
  };
}

function warehouse(overrides: Partial<CatalogWarehouse> = {}): CatalogWarehouse {
  return {
    id: "warehouse-1",
    title: "Склад 1",
    slug: "warehouse-1",
    status: "ACTIVE",
    ...overrides,
  };
}

test("deep audit follows every page and separates blockers, risks and recommendations", async () => {
  const mcp = new FakeCatalogDoctorMcp({
    pageSize: 1,
    products: [
      product({ id: "product-1", category_ids: [] }),
      product({ id: "product-2", category_ids: ["category-1"] }),
    ],
    variants: [
      variant({
        id: "variant-price-stock",
        sku: "BROKEN-PRICE",
        product_id: "product-1",
        product_card_id: undefined,
        pricing: {},
        stocks: [{ warehouse_id: "warehouse-missing", quantity: 0, reserved: 0 }],
        media: [],
      }),
      variant({
        id: "variant-discount-reserve",
        sku: "BROKEN-RESERVE",
        status: "HIDDEN",
        product_id: "missing-product",
        pricing: {
          price: "100.00",
          final_price: "100.00",
          manual_discount_price: "120.00",
        },
        stocks: [{ warehouse_id: "warehouse-archived", quantity: 1, reserved: 2 }],
      }),
    ],
    categories: [
      category(),
      category({
        id: "category-2",
        title: "Категория 1",
        slug: "category-1",
      }),
    ],
    warehouses: [
      warehouse(),
      warehouse({ id: "warehouse-2", title: "Склад 2", slug: "warehouse-2" }),
      warehouse({
        id: "warehouse-archived",
        title: "Архивный склад",
        slug: "warehouse-archived",
        status: "ARCHIVED",
      }),
    ],
  });

  const result = await runCatalogDoctorScenario({
    request: "Проверь каталог целиком",
    mcp,
  });

  for (const tool of ["list_products", "list_variants", "list_categories", "list_warehouses"]) {
    assert.ok(
      mcp.calls.filter((call) => call.name === tool).length >= 2,
      `${tool} should read at least two pages`,
    );
  }
  assert.deepEqual(
    mcp.calls
      .filter((call) => call.name === "list_products")
      .map((call) => call.arguments.page),
    [1, 2, 3],
  );
  assert.deepEqual(
    mcp.calls.find((call) => call.name === "list_variants")?.arguments.status,
    ["PUBLISHED", "HIDDEN"],
  );
  assert.deepEqual(
    mcp.calls.find((call) => call.name === "list_categories")?.arguments.status,
    ["ACTIVE"],
  );
  assert.deepEqual(
    mcp.calls.find((call) => call.name === "list_warehouses")?.arguments.status,
    ["ACTIVE"],
  );
  assert.match(result.report, /Покрытие: продукты 2\/2, варианты 2\/2, категории 2\/2, склады 3\/3/i);
  assert.match(result.report, /Блокеры \([1-9]\d*\)/);
  assert.match(result.report, /Риски \([1-9]\d*\)/);
  assert.match(result.report, /Рекомендации \([1-9]\d*\)/);
  for (const fact of [
    "BROKEN-PRICE",
    "неположительная или отсутствующая базовая цена",
    "неположительная или отсутствующая финальная цена",
    "доступный остаток 0",
    "warehouse-missing",
    "без активной категории",
    "Product.category_ids не показывает архивные категории",
    "нет изображения",
    "product_card_id",
    "BROKEN-RESERVE",
    "ручная скидочная цена 120.00 выше базовой 100.00",
    "резерв 2 больше количества 1",
    "warehouse-archived",
    "missing-product",
    "дублирующийся slug",
    "дублирующееся название",
  ]) {
    assert.match(result.report, new RegExp(fact, "i"), fact);
  }
  assert.equal(mcp.writeCalls.length, 0);
});

test("a fully healthy catalog reports complete coverage without invented defects", async () => {
  const mcp = new FakeCatalogDoctorMcp({
    products: [product()],
    variants: [variant()],
    categories: [category()],
    warehouses: [warehouse()],
  });

  const result = await runCatalogDoctorScenario({
    request: "Проведи глубокий аудит каталога",
    mcp,
  });

  assert.match(result.report, /Покрытие: продукты 1\/1, варианты 1\/1, категории 1\/1, склады 1\/1/i);
  assert.match(result.report, /Блокеры \(0\)/);
  assert.match(result.report, /Риски \(0\)/);
  assert.match(result.report, /Рекомендации \(0\)/);
  assert.match(result.report, /каталог исправен по проверенным критериям/i);
  assert.doesNotMatch(result.report, /API-ошибка/i);
  assert.equal(mcp.writeCalls.length, 0);
});

test("an explicit archive audit includes archived entities and reports archive risk", async () => {
  const mcp = new FakeCatalogDoctorMcp({
    products: [product()],
    variants: [
      variant(),
      variant({
        id: "variant-archived",
        sku: "ARCHIVED-1",
        slug: "archived-1",
        name: "Архивный товар",
        status: "ARCHIVED",
      }),
    ],
    categories: [
      category(),
      category({
        id: "category-archived",
        title: "Архив",
        slug: "archive",
        status: "ARCHIVED",
      }),
    ],
    warehouses: [
      warehouse(),
      warehouse({
        id: "warehouse-archived",
        title: "Архивный склад",
        slug: "warehouse-archived",
        status: "ARCHIVED",
      }),
    ],
  });

  const result = await runCatalogDoctorScenario({
    request: "Проверь каталог, включая архив",
    mcp,
  });

  assert.deepEqual(
    mcp.calls.find((call) => call.name === "list_variants")?.arguments.status,
    ["PUBLISHED", "HIDDEN", "ARCHIVED"],
  );
  assert.deepEqual(
    mcp.calls.find((call) => call.name === "list_categories")?.arguments.status,
    ["ACTIVE", "ARCHIVED"],
  );
  assert.deepEqual(
    mcp.calls.find((call) => call.name === "list_warehouses")?.arguments.status,
    ["ACTIVE", "ARCHIVED"],
  );
  assert.match(result.report, /единственный наблюдаемый активный путь/i);
  assert.equal(mcp.writeCalls.length, 0);
});

test("pagination interruption is explicit and never claims the whole catalog is healthy", async () => {
  const mcp = new FakeCatalogDoctorMcp({
    pageSize: 1,
    products: [product()],
    variants: [
      variant({ id: "variant-1", sku: "SKU-1" }),
      variant({ id: "variant-2", sku: "SKU-2" }),
      variant({ id: "variant-3", sku: "SKU-3" }),
    ],
    categories: [category()],
    warehouses: [warehouse()],
    readErrors: {
      "list_variants:2": new Error("connection interrupted"),
    },
  });

  const result = await runCatalogDoctorScenario({
    request: "Проверь весь каталог",
    mcp,
  });

  assert.match(result.report, /Покрытие неполное/i);
  assert.match(result.report, /варианты 1\/3/i);
  assert.match(result.report, /list_variants.*страница 2.*connection interrupted/i);
  assert.match(result.report, /нельзя утверждать, что весь каталог исправен/i);
  assert.doesNotMatch(result.report, /каталог исправен по проверенным критериям/i);
  assert.ok(mcp.calls.some((call) => call.name === "list_warehouses"));
  assert.equal(mcp.writeCalls.length, 0);
});

test("an unread product page is resolved with get_product instead of a false broken link", async () => {
  const mcp = new FakeCatalogDoctorMcp({
    pageSize: 1,
    products: [
      product({ id: "product-1" }),
      product({ id: "product-2" }),
    ],
    variants: [variant({ product_id: "product-2" })],
    categories: [category()],
    warehouses: [warehouse()],
    readErrors: {
      "list_products:2": new Error("product page interrupted"),
    },
  });

  const result = await runCatalogDoctorScenario({
    request: "Проверь каталог",
    mcp,
  });

  assert.ok(
    mcp.calls.some(
      (call) => call.name === "get_product" && call.arguments.id === "product-2",
    ),
  );
  assert.match(result.report, /Покрытие неполное/i);
  assert.match(result.report, /продукты 2\/\?/i);
  assert.doesNotMatch(result.report, /сломанная связь.*product-2/i);
  assert.doesNotMatch(result.report, /связь с product_id product-2 не подтверждена/i);
  assert.equal(mcp.writeCalls.length, 0);
});

test("unread category and warehouse references never become confirmed blockers", async () => {
  const mcp = new FakeCatalogDoctorMcp({
    products: [product({ category_ids: ["category-unread"] })],
    variants: [
      variant({
        stocks: [
          {
            warehouse_id: "warehouse-unread",
            quantity: 5,
            reserved: 0,
          },
        ],
      }),
    ],
    categories: [],
    warehouses: [],
    readErrors: {
      "get_category:category-unread": new Error("category network timeout"),
      "get_warehouse:warehouse-unread": new Error("warehouse network timeout"),
    },
  });

  const result = await runCatalogDoctorScenario({
    request: "Проверь каталог",
    mcp,
  });

  assert.match(result.report, /Покрытие неполное/iu);
  assert.match(result.report, /category network timeout/iu);
  assert.match(result.report, /warehouse network timeout/iu);
  assert.match(result.report, /Риски \(2\)/iu);
  assert.match(result.report, /не подтверждена.*category-unread/iu);
  assert.match(result.report, /не подтверждена.*warehouse-unread/iu);
  assert.doesNotMatch(result.report, /Блокеры \([1-9]/iu);
  assert.doesNotMatch(result.report, /отсутствующий склад warehouse-unread/iu);
  assert.doesNotMatch(result.report, /сломанные ссылки на категории: category-unread/iu);
  assert.equal(mcp.writeCalls.length, 0);
});

test("an unread product reference never becomes a confirmed blocker", async () => {
  const mcp = new FakeCatalogDoctorMcp({
    products: [],
    variants: [variant({ product_id: "product-unread" })],
    categories: [category()],
    warehouses: [warehouse()],
    readErrors: {
      "get_product:product-unread": new Error("product network timeout"),
    },
  });

  const result = await runCatalogDoctorScenario({
    request: "Проверь каталог",
    mcp,
  });

  assert.match(result.report, /Покрытие неполное/iu);
  assert.match(result.report, /Риски \(1\)/iu);
  assert.match(result.report, /product_id product-unread не подтверждена.*product network timeout/iu);
  assert.doesNotMatch(result.report, /Блокеры \([1-9]/iu);
  assert.doesNotMatch(result.report, /сломанная связь: product_id product-unread/iu);
  assert.equal(mcp.writeCalls.length, 0);
});
