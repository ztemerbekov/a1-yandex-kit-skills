import assert from "node:assert/strict";
import { test } from "node:test";

// Structural-audit scenarios for the Catalog Doctor skill reference model.

import {
  FakeCatalogDoctorMcp,
  runCatalogDoctorScenario,
  type CatalogCategory,
  type CatalogCharacteristic,
  type CatalogCollectionInfo,
  type CatalogProduct,
  type CatalogVariant,
  type CatalogWarehouse,
} from "./catalog-doctor-skill-scenario.js";

function product(overrides: Partial<CatalogProduct> = {}): CatalogProduct {
  return {
    id: "product-1",
    category_ids: ["category-1"],
    settings: {
      grouping_characteristic_ids: ["characteristic-color"],
      splitting_characteristic_ids: [],
    },
    ...overrides,
  };
}

function variant(overrides: Partial<CatalogVariant> = {}): CatalogVariant {
  return {
    id: "variant-1",
    sku: "SKU-1",
    name: "Футболка, красная",
    slug: "t-shirt-red",
    description: "Хлопковая футболка",
    brand: "A1",
    status: "PUBLISHED",
    product_id: "product-1",
    product_card_id: "card-1",
    characteristics: [
      {
        characteristic_id: "characteristic-color",
        value: "Красный",
        values: ["Красный"],
      },
    ],
    pricing: { price: "1000.00", final_price: "1000.00" },
    stocks: [{ warehouse_id: "warehouse-1", quantity: 5, reserved: 0 }],
    media: [{ type: "IMAGE", image_id: "image-1", display_sequence: 1 }],
    ...overrides,
  };
}

function category(overrides: Partial<CatalogCategory> = {}): CatalogCategory {
  return {
    id: "category-1",
    title: "Одежда",
    slug: "clothes",
    status: "ACTIVE",
    ...overrides,
  };
}

function warehouse(overrides: Partial<CatalogWarehouse> = {}): CatalogWarehouse {
  return {
    id: "warehouse-1",
    title: "Основной",
    slug: "main",
    status: "ACTIVE",
    ...overrides,
  };
}

function characteristic(
  overrides: Partial<CatalogCharacteristic> = {},
): CatalogCharacteristic {
  return {
    id: "characteristic-color",
    title: "Цвет",
    slug: "color",
    status: "ACTIVE",
    ...overrides,
  };
}

function collection(
  overrides: Partial<CatalogCollectionInfo> = {},
): CatalogCollectionInfo {
  return {
    id: "collection-1",
    title: "Новинки",
    slug: "new",
    status: "ACTIVE",
    collection_type: "STATIC",
    cards_count: 1,
    hidden_cards_count: 0,
    ...overrides,
  };
}

test("structural audit finds grouping, characteristic, media and collection defects from API facts", async () => {
  const mcp = new FakeCatalogDoctorMcp({
    pageSize: 1,
    products: [
      product(),
      product({
        id: "product-2",
        settings: {
          grouping_characteristic_ids: [
            "characteristic-archived",
            "characteristic-missing",
          ],
          splitting_characteristic_ids: [],
        },
      }),
    ],
    variants: [
      variant(),
      variant({
        id: "variant-2",
        sku: "SKU-2",
        slug: "t-shirt-blue",
        name: "Название содержит синий, но значения нет",
        brand: "",
        description: "",
        characteristics: [
          {
            characteristic_id: "characteristic-color",
            value: "Красный",
            values: ["Красный"],
          },
        ],
        media: [
          { type: "IMAGE", display_sequence: 2 },
          { type: "VIDEO", display_sequence: 2 },
          { type: "IMAGE", image_id: "image-duplicate", display_sequence: 4 },
          { type: "IMAGE", image_id: "image-duplicate", display_sequence: 5 },
        ],
      }),
      variant({
        id: "variant-4",
        sku: "SKU-4",
        slug: "t-shirt-no-color",
        name: "Футболка без цвета",
        characteristics: [],
      }),
      variant({
        id: "variant-3",
        sku: "SKU-3",
        slug: "product-2",
        name: "Товар 2",
        product_id: "product-2",
        product_card_id: "card-3",
        characteristics: [
          {
            characteristic_id: "characteristic-archived",
            value: "XL",
            values: ["XL"],
          },
          {
            characteristic_id: "characteristic-broken-reference",
            value: "Факт",
            values: ["Факт"],
          },
        ],
      }),
    ],
    categories: [category()],
    warehouses: [warehouse()],
    characteristics: [
      characteristic(),
      characteristic({
        id: "characteristic-archived",
        title: "Размер",
        slug: "size",
        status: "ARCHIVED",
      }),
    ],
    collections: [
      collection({
        id: "collection-empty",
        cards_count: 0,
      }),
      collection({
        id: "collection-hidden",
        slug: "hidden",
        cards_count: 2,
        hidden_cards_count: 1,
      }),
    ],
    collectionVariantIds: {
      "collection-empty": [],
      "collection-hidden": ["variant-1", "variant-missing"],
    },
  });

  const { report } = await runCatalogDoctorScenario({
    request:
      "Проверь структурное качество каталога. Обязательные поля владельца: бренд, описание.",
    mcp,
  });

  for (const fact of [
    "одинаковая комбинация группирующих характеристик",
    "не задано значение группирующей характеристики characteristic-color",
    "архивн.+characteristic-archived",
    "сломанная ссылка на характеристику characteristic-missing",
    "сломанная ссылка на характеристику characteristic-broken-reference",
    "обязательное поле владельца «бренд» не заполнено",
    "обязательное поле владельца «описание» не заполнено",
    "медиа IMAGE без image_id",
    "медиа VIDEO без video_id",
    "повторяется медиа image-duplicate",
    "повторяется порядок медиа 2",
    "нет главного изображения с display_sequence 1",
    "активная коллекция collection-empty пуста",
    "активная коллекция collection-hidden содержит 1 скрытую карточку",
    "variant-missing",
  ]) {
    assert.match(report, new RegExp(fact, "iu"), fact);
  }
  assert.doesNotMatch(report, /значение «синий» выведено из названия/iu);
  assert.match(report, /структурное покрытие: характеристики 2\/2, коллекции 2\/2/iu);
  assert.equal(mcp.writeCalls.length, 0);
});

test("optional merchandising entities are not defects and are not read without owner request", async () => {
  const mcp = new FakeCatalogDoctorMcp({
    products: [product()],
    variants: [variant()],
    categories: [category()],
    warehouses: [warehouse()],
    characteristics: [characteristic()],
    collections: [],
    badges: [],
    contextCollections: [],
    similarProductCardIds: {},
  });

  const { report } = await runCatalogDoctorScenario({
    request: "Проверь структурное качество каталога",
    mcp,
  });

  assert.match(report, /Блокеры \(0\)/);
  assert.match(report, /Риски \(0\)/);
  assert.doesNotMatch(report, /нет (?:коллекц|бейдж|контекстн|похож)/iu);
  assert.ok(
    !mcp.calls.some(
      (call) =>
        call.name === "kit_request" &&
        [
          "GetBadges",
          "GetContextCollections",
          "GetSimilarProductCardIDs",
        ].includes(String(call.arguments.operation_id)),
    ),
  );
  assert.equal(mcp.writeCalls.length, 0);
});

test("a general merchandising request expands every optional read scope without inventing absence defects", async () => {
  const mcp = new FakeCatalogDoctorMcp({
    products: [product()],
    variants: [variant()],
    categories: [category()],
    warehouses: [warehouse()],
    characteristics: [characteristic()],
    collections: [],
    badges: [],
    contextCollections: [],
    similarProductCardIds: {},
  });

  const { report } = await runCatalogDoctorScenario({
    request: "Проверь мерчандайзинг каталога",
    mcp,
  });

  for (const operation of [
    "GetBadges",
    "GetContextCollections",
    "GetSimilarProductCardIDs",
  ]) {
    assert.ok(
      mcp.calls.some(
        (call) =>
          call.name === "kit_request" &&
          call.arguments.operation_id === operation,
      ),
      operation,
    );
  }
  assert.match(report, /Блокеры \(0\)/);
  assert.match(report, /Риски \(0\)/);
  assert.equal(mcp.writeCalls.length, 0);
});

test("card completeness separates owner requirements, incompleteness risks and optional advice", async () => {
  const mcp = new FakeCatalogDoctorMcp({
    products: [product()],
    variants: [
      variant({
        name: "",
        brand: "",
        description: "",
      }),
    ],
    categories: [category()],
    warehouses: [warehouse()],
    characteristics: [characteristic()],
    collections: [],
  });

  const { report } = await runCatalogDoctorScenario({
    request:
      "Проверь структурное качество. Обязательные поля владельца: описание.",
    mcp,
  });

  assert.match(
    report,
    /Блокеры \([1-9]\d*\)[\s\S]*обязательное поле владельца «описание» не заполнено/iu,
  );
  assert.match(
    report,
    /Риски \([1-9]\d*\)[\s\S]*неполная карточка: пустое обязательное API-поле name/iu,
  );
  assert.match(
    report,
    /Рекомендации \([1-9]\d*\)[\s\S]*опциональное поле «бренд» не заполнено/iu,
  );
  assert.equal(mcp.writeCalls.length, 0);
});

test("an interrupted characteristic list uses detail reads instead of inventing a broken reference", async () => {
  const sizeCharacteristic = characteristic({
    id: "characteristic-size",
    title: "Размер",
    slug: "size",
  });
  const mcp = new FakeCatalogDoctorMcp({
    pageSize: 1,
    products: [
      product({
        settings: {
          grouping_characteristic_ids: ["characteristic-size"],
          splitting_characteristic_ids: [],
        },
      }),
    ],
    variants: [
      variant({
        characteristics: [
          {
            characteristic_id: "characteristic-size",
            value: "M",
            values: ["M"],
          },
        ],
      }),
    ],
    categories: [category()],
    warehouses: [warehouse()],
    characteristics: [characteristic(), sizeCharacteristic],
    collections: [],
    readErrors: {
      "GetCharacteristics:2": new Error("characteristic page interrupted"),
    },
  });

  const { report } = await runCatalogDoctorScenario({
    request: "Проверь структурное качество каталога",
    mcp,
  });

  assert.ok(
    mcp.calls.some(
      (call) =>
        call.name === "kit_request" &&
        call.arguments.operation_id === "GetCharacteristicById" &&
        (call.arguments.path_params as { id?: string }).id ===
          "characteristic-size",
    ),
  );
  assert.match(report, /Покрытие неполное/iu);
  assert.match(report, /характеристики 2\/2/iu);
  assert.doesNotMatch(
    report,
    /сломанная ссылка на характеристику characteristic-size/iu,
  );
  assert.equal(mcp.writeCalls.length, 0);
});

test("media OTHER does not require a video identifier", async () => {
  const mcp = new FakeCatalogDoctorMcp({
    products: [product()],
    variants: [
      variant({
        media: [
          { type: "IMAGE", image_id: "image-1", display_sequence: 1 },
          { type: "OTHER", display_sequence: 2 },
        ],
      }),
    ],
    categories: [category()],
    warehouses: [warehouse()],
    characteristics: [characteristic()],
    collections: [],
  });

  const { report } = await runCatalogDoctorScenario({
    request: "Проверь медиа каталога",
    mcp,
  });

  assert.doesNotMatch(report, /медиа OTHER без video_id/iu);
  assert.match(report, /Блокеры \(0\)/);
  assert.match(report, /Риски \(0\)/);
  assert.equal(mcp.writeCalls.length, 0);
});

test("an invalid secondary media item is a risk when a usable image remains", async () => {
  const mcp = new FakeCatalogDoctorMcp({
    products: [product()],
    variants: [
      variant({
        media: [
          { type: "IMAGE", image_id: "image-1", display_sequence: 1 },
          { type: "VIDEO", display_sequence: 2 },
        ],
      }),
    ],
    categories: [category()],
    warehouses: [warehouse()],
    characteristics: [characteristic()],
    collections: [],
  });

  const { report } = await runCatalogDoctorScenario({
    request: "Проверь медиа каталога",
    mcp,
  });

  assert.match(report, /Блокеры \(0\)/);
  assert.match(report, /Риски \([1-9]\d*\)[\s\S]*медиа VIDEO без video_id/iu);
  assert.equal(mcp.writeCalls.length, 0);
});

test("a collection relation to an archived variant is resolved instead of called broken", async () => {
  const archivedVariant = variant({
    id: "variant-archived",
    sku: "ARCHIVED-1",
    slug: "archived-1",
    name: "Архивный вариант",
    status: "ARCHIVED",
  });
  const mcp = new FakeCatalogDoctorMcp({
    products: [product()],
    variants: [variant(), archivedVariant],
    categories: [category()],
    warehouses: [warehouse()],
    characteristics: [characteristic()],
    collections: [collection()],
    collectionVariantIds: {
      "collection-1": ["variant-archived"],
    },
  });

  const { report } = await runCatalogDoctorScenario({
    request: "Проверь структурное качество каталога",
    mcp,
  });

  assert.ok(
    mcp.calls.some(
      (call) =>
        call.name === "get_variant" &&
        call.arguments.id === "variant-archived",
    ),
  );
  assert.match(report, /архивный variant_id variant-archived/iu);
  assert.doesNotMatch(report, /сломанная[^.\n]*variant-archived/iu);
  assert.equal(mcp.writeCalls.length, 0);
});

test("owner-requested merchandising audit reads optional relations and reports only broken facts", async () => {
  const mcp = new FakeCatalogDoctorMcp({
    products: [product()],
    variants: [variant()],
    categories: [category()],
    warehouses: [warehouse()],
    characteristics: [characteristic()],
    collections: [
      collection({
        collection_type: "DYNAMIC",
        dynamic_filter: {
          category_slugs: ["missing-category"],
          characteristic_filters: [
            { field: "missing-characteristic", operator: "IN", values: ["x"] },
          ],
        },
      }),
    ],
    collectionVariantIds: { "collection-1": ["variant-1"] },
    badges: [
      {
        id: "badge-1",
        slug: "sale",
        label: "Sale",
        binding_mode: "SELECTED_VARIANTS",
      },
      {
        id: "badge-2",
        slug: "category-sale",
        label: "Category sale",
        binding_mode: "SELECTED_CATEGORIES_COLLECTIONS",
      },
    ],
    badgeVariantIds: { "badge-1": ["variant-missing"] },
    badgeCategoryIds: { "badge-2": ["category-missing"] },
    badgeCollectionIds: { "badge-2": ["collection-missing"] },
    contextCollections: [
      {
        id: "context-1",
        title: "Похожие по неизвестному полю",
        conditions: [
          {
            type: "CHARACTERISTIC",
            operator: "EQ",
            characteristic_slug: "missing-characteristic",
          },
        ],
      },
    ],
    similarProductCardIds: { "card-1": ["card-missing"] },
  });

  const { report } = await runCatalogDoctorScenario({
    request:
      "Проверь динамические фильтры, привязки бейджей, контекстные коллекции и похожие товары.",
    mcp,
  });

  for (const operation of [
    "GetBadges",
    "GetBadgeVariantIDs",
    "GetBadgeCategoryIDs",
    "GetBadgeCollectionIDs",
    "GetContextCollections",
    "GetSimilarProductCardIDs",
  ]) {
    assert.ok(
      mcp.calls.some(
        (call) =>
          call.name === "kit_request" &&
          call.arguments.operation_id === operation,
      ),
      operation,
    );
  }
  for (const fact of [
    "missing-category",
    "missing-characteristic",
    "variant-missing",
    "category-missing",
    "collection-missing",
    "card-missing",
  ]) {
    assert.match(report, new RegExp(fact, "iu"), fact);
  }
  assert.match(
    report,
    /структурное покрытие:.*бейджи 2\/2.*контекстные коллекции 1\/1.*похожие карточки 1\/1/iu,
  );
  assert.doesNotMatch(report, /отсутствие бейджей само по себе/iu);
  assert.equal(mcp.writeCalls.length, 0);
});
