import type { components } from "yandex-kit-core";

// Deterministic reference model for the a1-yandex-kit-catalog-doctor skill.

type KitProduct = components["schemas"]["Product"];
type KitVariant = components["schemas"]["Variant"];
type KitCategory = components["schemas"]["Category"];
type KitWarehouse = components["schemas"]["Warehouse"];
type KitCharacteristic = components["schemas"]["Characteristic"];
type KitCollection = components["schemas"]["Collection"];
type KitBadge = components["schemas"]["Badge"];
type KitContextCollection = components["schemas"]["ContextCollection"];

export interface CatalogProduct {
  id: KitProduct["id"];
  category_ids: KitProduct["category_ids"];
  settings?: KitProduct["settings"];
}

export interface CatalogVariant {
  id: KitVariant["id"];
  sku: KitVariant["sku"];
  name: KitVariant["name"];
  slug: KitVariant["slug"];
  status: KitVariant["status"];
  product_id: KitVariant["product_id"];
  product_card_id?: KitVariant["product_card_id"];
  description?: KitVariant["description"];
  brand?: KitVariant["brand"];
  characteristics?: KitVariant["characteristics"];
  pricing: KitVariant["pricing"];
  stocks: KitVariant["stocks"];
  media: KitVariant["media"];
}

export interface CatalogCategory {
  id: KitCategory["id"];
  title: KitCategory["title"];
  slug: KitCategory["slug"];
  status: KitCategory["status"];
}

export interface CatalogWarehouse {
  id: KitWarehouse["id"];
  title: KitWarehouse["title"];
  slug: KitWarehouse["slug"];
  status: KitWarehouse["status"];
}

export interface CatalogCharacteristic {
  id: KitCharacteristic["id"];
  title: KitCharacteristic["title"];
  slug: KitCharacteristic["slug"];
  status: KitCharacteristic["status"];
}

export interface CatalogCollectionInfo {
  id: KitCollection["id"];
  title: KitCollection["title"];
  slug: KitCollection["slug"];
  status: KitCollection["status"];
  collection_type: KitCollection["collection_type"];
  cards_count: KitCollection["cards_count"];
  hidden_cards_count: KitCollection["hidden_cards_count"];
  dynamic_filter?: KitCollection["dynamic_filter"];
}

export interface CatalogBadge {
  id: KitBadge["id"];
  slug: KitBadge["slug"];
  label: KitBadge["label"];
  binding_mode: KitBadge["binding_mode"];
}

export interface CatalogContextCollection {
  id: KitContextCollection["id"];
  title: KitContextCollection["title"];
  conditions: KitContextCollection["conditions"];
}

export interface CatalogDoctorToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

const READ_TOOLS = new Set([
  "list_products",
  "list_variants",
  "list_categories",
  "list_warehouses",
  "get_product",
  "get_variant",
  "get_category",
  "get_warehouse",
  "list_collections",
]);

const READ_OPERATIONS = new Set([
  "GetCharacteristics",
  "GetCharacteristicById",
  "GetVariantsByCollectionId",
  "GetBadges",
  "GetBadgeVariantIDs",
  "GetBadgeCategoryIDs",
  "GetBadgeCollectionIDs",
  "GetContextCollections",
  "GetSimilarProductCardIDs",
]);

function notFound(message: string): Error {
  const error = new Error(message);
  error.name = "NotFoundError";
  return error;
}

function isNotFound(error: unknown): boolean {
  return error instanceof Error && error.name === "NotFoundError";
}

type CatalogCollection =
  | "products"
  | "variants"
  | "categories"
  | "warehouses"
  | "collections"
  | "characteristics";

export class FakeCatalogDoctorMcp {
  readonly calls: CatalogDoctorToolCall[] = [];
  readonly #pageSize: number;
  readonly #products: CatalogProduct[];
  readonly #variants: CatalogVariant[];
  readonly #categories: CatalogCategory[];
  readonly #warehouses: CatalogWarehouse[];
  readonly #characteristics: CatalogCharacteristic[];
  readonly #collections: CatalogCollectionInfo[];
  readonly #collectionVariantIds: Record<string, string[]>;
  readonly #badges: CatalogBadge[];
  readonly #badgeVariantIds: Record<string, string[]>;
  readonly #badgeCategoryIds: Record<string, string[]>;
  readonly #badgeCollectionIds: Record<string, string[]>;
  readonly #contextCollections: CatalogContextCollection[];
  readonly #similarProductCardIds: Record<string, string[]>;
  readonly #readErrors: Record<string, Error>;
  finalAnswer: string | undefined;

  constructor({
    pageSize = 100,
    products,
    variants,
    categories,
    warehouses,
    characteristics = [],
    collections = [],
    collectionVariantIds = {},
    badges = [],
    badgeVariantIds = {},
    badgeCategoryIds = {},
    badgeCollectionIds = {},
    contextCollections = [],
    similarProductCardIds = {},
    readErrors = {},
  }: {
    pageSize?: number;
    products: CatalogProduct[];
    variants: CatalogVariant[];
    categories: CatalogCategory[];
    warehouses: CatalogWarehouse[];
    characteristics?: CatalogCharacteristic[];
    collections?: CatalogCollectionInfo[];
    collectionVariantIds?: Record<string, string[]>;
    badges?: CatalogBadge[];
    badgeVariantIds?: Record<string, string[]>;
    badgeCategoryIds?: Record<string, string[]>;
    badgeCollectionIds?: Record<string, string[]>;
    contextCollections?: CatalogContextCollection[];
    similarProductCardIds?: Record<string, string[]>;
    readErrors?: Record<string, Error>;
  }) {
    this.#pageSize = pageSize;
    this.#products = products;
    this.#variants = variants;
    this.#categories = categories;
    this.#warehouses = warehouses;
    this.#characteristics = characteristics;
    this.#collections = collections;
    this.#collectionVariantIds = collectionVariantIds;
    this.#badges = badges;
    this.#badgeVariantIds = badgeVariantIds;
    this.#badgeCategoryIds = badgeCategoryIds;
    this.#badgeCollectionIds = badgeCollectionIds;
    this.#contextCollections = contextCollections;
    this.#similarProductCardIds = similarProductCardIds;
    this.#readErrors = readErrors;
  }

  get writeCalls(): CatalogDoctorToolCall[] {
    return this.calls.filter(
      (call) =>
        !READ_TOOLS.has(call.name) &&
        !(
          call.name === "kit_request" &&
          READ_OPERATIONS.has(String(call.arguments.operation_id))
        ),
    );
  }

  async call(name: string, arguments_: Record<string, unknown>): Promise<unknown> {
    this.calls.push({ name, arguments: arguments_ });
    const query =
      arguments_.query && typeof arguments_.query === "object"
        ? (arguments_.query as Record<string, unknown>)
        : arguments_;
    const pathParams =
      arguments_.path_params && typeof arguments_.path_params === "object"
        ? (arguments_.path_params as Record<string, unknown>)
        : arguments_;
    const page = typeof query.page === "number" ? query.page : 1;
    const operationId = String(arguments_.operation_id ?? "");
    const errorKey =
      name === "kit_request"
        ? `${operationId}:${String(pathParams.id ?? pathParams.collection_id ?? pathParams.badge_id ?? pathParams.product_card_id ?? page)}`
        : `${name}:${String(arguments_.id ?? page)}`;
    const preparedError = this.#readErrors[errorKey];
    if (preparedError) throw preparedError;

    if (name === "list_products") {
      const items = this.page(this.#products, page);
      return { products: items };
    }
    if (name === "list_variants") {
      const statuses = new Set(
        Array.isArray(arguments_.status)
          ? arguments_.status.map(String)
          : [String(arguments_.status ?? "PUBLISHED")],
      );
      const variants = this.#variants.filter((variant) => statuses.has(variant.status));
      return { variants: this.page(variants, page), total_count: variants.length };
    }
    if (name === "get_product") {
      const id = String(arguments_.id);
      const product = this.#products.find((candidate) => candidate.id === id);
      if (!product) throw notFound(`Product ${id} was not found`);
      return product;
    }
    if (name === "get_variant") {
      const id = String(arguments_.id);
      const variant = this.#variants.find((candidate) => candidate.id === id);
      if (!variant) throw notFound(`Variant ${id} was not found`);
      return variant;
    }
    if (name === "list_categories") {
      const statuses = new Set(
        Array.isArray(arguments_.status)
          ? arguments_.status.map(String)
          : [String(arguments_.status ?? "ACTIVE")],
      );
      const categories = this.#categories.filter((category) => statuses.has(category.status));
      return { categories: this.page(categories, page), total_count: categories.length };
    }
    if (name === "list_warehouses") {
      const statuses = new Set(
        Array.isArray(arguments_.status)
          ? arguments_.status.map(String)
          : [String(arguments_.status ?? "ACTIVE")],
      );
      const warehouses = this.#warehouses.filter((warehouse) => statuses.has(warehouse.status));
      return { warehouses: this.page(warehouses, page), total_count: warehouses.length };
    }
    if (name === "list_collections") {
      const statuses = new Set(
        Array.isArray(arguments_.status)
          ? arguments_.status.map(String)
          : [String(arguments_.status ?? "ACTIVE")],
      );
      const collections = this.#collections.filter((collection) =>
        statuses.has(collection.status),
      );
      return {
        collections: this.page(collections, page),
        total_count: collections.length,
      };
    }
    if (name === "get_category") {
      const id = String(arguments_.id);
      const category = this.#categories.find((candidate) => candidate.id === id);
      if (!category) throw notFound(`Category ${id} was not found`);
      return category;
    }
    if (name === "get_warehouse") {
      const id = String(arguments_.id);
      const warehouse = this.#warehouses.find((candidate) => candidate.id === id);
      if (!warehouse) throw notFound(`Warehouse ${id} was not found`);
      return warehouse;
    }
    if (name === "kit_request") {
      if (operationId === "GetCharacteristics") {
        const statuses = new Set(
          Array.isArray(query.status)
            ? query.status.map(String)
            : [String(query.status ?? "ACTIVE")],
        );
        const characteristics = this.#characteristics.filter((characteristic) =>
          statuses.has(characteristic.status),
        );
        return {
          characteristics: this.page(characteristics, page),
          total_count: characteristics.length,
        };
      }
      if (operationId === "GetCharacteristicById") {
        const id = String(pathParams.id);
        const characteristic = this.#characteristics.find(
          (candidate) => candidate.id === id,
        );
        if (!characteristic) {
          throw notFound(`Characteristic ${id} was not found`);
        }
        return characteristic;
      }
      if (operationId === "GetVariantsByCollectionId") {
        const collectionId = String(pathParams.collection_id);
        const ids = this.#collectionVariantIds[collectionId] ?? [];
        return {
          variant_ids: this.page(ids, page),
          total_count: ids.length,
        };
      }
      if (operationId === "GetBadges") {
        return {
          badges: this.page(this.#badges, page),
          total_count: this.#badges.length,
        };
      }
      if (operationId === "GetBadgeVariantIDs") {
        const badgeId = String(pathParams.badge_id);
        const ids = this.#badgeVariantIds[badgeId] ?? [];
        return {
          variant_ids: this.page(ids, page),
          total_count: ids.length,
        };
      }
      if (operationId === "GetBadgeCategoryIDs") {
        const badgeId = String(pathParams.badge_id);
        const ids = this.#badgeCategoryIds[badgeId] ?? [];
        return {
          category_ids: this.page(ids, page),
          total_count: ids.length,
        };
      }
      if (operationId === "GetBadgeCollectionIDs") {
        const badgeId = String(pathParams.badge_id);
        const ids = this.#badgeCollectionIds[badgeId] ?? [];
        return {
          collection_ids: this.page(ids, page),
          total_count: ids.length,
        };
      }
      if (operationId === "GetContextCollections") {
        return {
          context_collections: this.page(this.#contextCollections, page),
          total_count: this.#contextCollections.length,
        };
      }
      if (operationId === "GetSimilarProductCardIDs") {
        const cardId = String(pathParams.product_card_id);
        const ids = this.#similarProductCardIds[cardId] ?? [];
        return {
          product_card_ids: this.page(ids, page),
          total_count: ids.length,
        };
      }
    }
    throw new Error(`Unsupported FakeCatalogDoctorMcp tool: ${name}`);
  }

  finish(report: string): void {
    this.finalAnswer = report;
  }

  private page<T>(items: T[], page: number): T[] {
    const start = (page - 1) * this.#pageSize;
    return items.slice(start, start + this.#pageSize);
  }
}

interface Coverage<T> {
  name: CatalogCollection;
  items: T[];
  expected: number | undefined;
  pages: number;
  complete: boolean;
  error?: string;
}

async function readEveryPage<T>({
  mcp,
  name,
  itemKey,
  arguments_,
}: {
  mcp: FakeCatalogDoctorMcp;
  name: CatalogCollection;
  itemKey: CatalogCollection;
  arguments_: Record<string, unknown>;
}): Promise<Coverage<T>> {
  const items: T[] = [];
  let expected: number | undefined;
  let page = 1;
  let pages = 0;

  while (true) {
    try {
      const response = (await mcp.call(`list_${name}`, {
        ...arguments_,
        page,
        per_page: 100,
      })) as Record<string, unknown>;
      const pageItems = (response[itemKey] ?? []) as T[];
      expected =
        typeof response.total_count === "number" ? response.total_count : expected;
      items.push(...pageItems);
      pages += 1;
      if (expected !== undefined && items.length >= expected) {
        return { name, items, expected, pages, complete: true };
      }
      if (pageItems.length === 0) {
        return {
          name,
          items,
          expected: expected ?? items.length,
          pages,
          complete: expected === undefined || items.length >= expected,
        };
      }
      page += 1;
    } catch (error) {
      return {
        name,
        items,
        expected,
        pages,
        complete: false,
        error:
          `list_${name}, страница ${page}: ` +
          (error instanceof Error ? error.message : String(error)),
      };
    }
  }
}

async function readEveryOperationPage<T>({
  mcp,
  operationId,
  itemKey,
  name,
  query = {},
  pathParams,
}: {
  mcp: FakeCatalogDoctorMcp;
  operationId: string;
  itemKey: string;
  name: CatalogCollection;
  query?: Record<string, unknown>;
  pathParams?: Record<string, string>;
}): Promise<Coverage<T>> {
  const items: T[] = [];
  let expected: number | undefined;
  let page = 1;
  let pages = 0;

  while (true) {
    try {
      const response = (await mcp.call("kit_request", {
        operation_id: operationId,
        ...(pathParams ? { path_params: pathParams } : {}),
        query: { ...query, page, per_page: 100 },
      })) as Record<string, unknown>;
      const pageItems = (response[itemKey] ?? []) as T[];
      expected =
        typeof response.total_count === "number" ? response.total_count : expected;
      items.push(...pageItems);
      pages += 1;
      if (expected !== undefined && items.length >= expected) {
        return { name, items, expected, pages, complete: true };
      }
      if (pageItems.length === 0) {
        return {
          name,
          items,
          expected: expected ?? items.length,
          pages,
          complete: expected === undefined || items.length >= expected,
        };
      }
      page += 1;
    } catch (error) {
      return {
        name,
        items,
        expected,
        pages,
        complete: false,
        error:
          `${operationId}, страница ${page}: ` +
          (error instanceof Error ? error.message : String(error)),
      };
    }
  }
}

type FindingLevel = "blocker" | "risk" | "recommendation";

interface CatalogFinding {
  level: FindingLevel;
  object: string;
  fact: string;
}

function decimal(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function addFinding(
  findings: CatalogFinding[],
  level: FindingLevel,
  object: string,
  fact: string,
): void {
  findings.push({ level, object, fact });
}

function problemLevel(variant: CatalogVariant): "blocker" | "risk" {
  return variant.status === "PUBLISHED" ? "blocker" : "risk";
}

function duplicateFindings(
  categories: CatalogCategory[],
  field: "slug" | "title",
): CatalogFinding[] {
  const groups = new Map<string, CatalogCategory[]>();
  for (const category of categories) {
    const key = category[field].trim().toLowerCase();
    groups.set(key, [...(groups.get(key) ?? []), category]);
  }
  return [...groups.entries()]
    .filter(([, items]) => items.length > 1)
    .map(([value, items]) => ({
      level: "risk" as const,
      object: `Категории ${items.map((item) => item.id).join(", ")}`,
      fact:
        field === "slug"
          ? `дублирующийся slug «${value}»`
          : `дублирующееся название «${value}»`,
    }));
}

function duplicateVariantFindings(
  variants: CatalogVariant[],
  field: "slug" | "name",
): CatalogFinding[] {
  const groups = new Map<string, CatalogVariant[]>();
  for (const variant of variants) {
    const key = variant[field].trim().toLowerCase();
    groups.set(key, [...(groups.get(key) ?? []), variant]);
  }
  return [...groups.entries()]
    .filter(([, items]) => items.length > 1)
    .map(([value, items]) => ({
      level: "risk" as const,
      object: `SKU ${items.map((item) => `${item.sku} (${item.id})`).join(", ")}`,
      fact:
        field === "slug"
          ? `дублирующийся slug «${value}»`
          : `дублирующееся название «${value}»`,
    }));
}

function formatCoverage(
  coverage: Coverage<unknown>,
  linkedChecked = 0,
  linkedExpected = linkedChecked,
): string {
  const checked = coverage.items.length + linkedChecked;
  const expected =
    coverage.expected === undefined
      ? coverage.complete
        ? checked + Math.max(0, linkedExpected - linkedChecked)
        : "?"
      : coverage.expected + linkedExpected;
  const label =
    coverage.name === "products"
      ? "продукты"
      : coverage.name === "variants"
        ? "варианты"
        : coverage.name === "categories"
          ? "категории"
          : coverage.name === "warehouses"
            ? "склады"
            : coverage.name === "collections"
              ? "коллекции"
              : "характеристики";
  return `${label} ${checked}/${expected}`;
}

function formatSection(
  title: string,
  level: FindingLevel,
  findings: CatalogFinding[],
): string {
  const selected = findings.filter((finding) => finding.level === level);
  return [
    `${title} (${selected.length})`,
    ...selected.map((finding) => `- ${finding.object}: ${finding.fact}.`),
  ].join("\n");
}

function characteristicValues(
  variant: CatalogVariant,
  characteristicId: string,
): string[] {
  const characteristic = (variant.characteristics ?? []).find(
    (candidate) => candidate.characteristic_id === characteristicId,
  );
  if (!characteristic) return [];
  const values = characteristic.values
    .map((value) => value.trim())
    .filter(Boolean);
  if (values.length > 0) return values;
  const deprecatedValue = characteristic.value.trim();
  return deprecatedValue ? [deprecatedValue] : [];
}

function ownerRequiredFields(request: string): Array<"brand" | "description"> {
  const match =
    /обязательн\p{L}*\s+пол\p{L}*\s+владельца\s*:\s*([^.!?\n]+)/iu.exec(
      request,
    );
  if (!match) return [];
  const fields = new Set<"brand" | "description">();
  for (const raw of match[1].split(/,|\s+и\s+/iu)) {
    const field = raw.trim().toLowerCase();
    if (field === "бренд" || field === "brand") fields.add("brand");
    if (field === "описание" || field === "description") fields.add("description");
  }
  return [...fields];
}

function requiredFieldLabel(field: "brand" | "description"): string {
  return field === "brand" ? "бренд" : "описание";
}

function mediaIdentifier(media: CatalogVariant["media"][number]): string | undefined {
  if (media.type === "IMAGE") return media.image_id;
  if (media.type === "VIDEO") return media.video_id;
  return undefined;
}

function collectionCoverageLabel(
  label: string,
  coverage: Coverage<unknown>,
): string {
  const expected = coverage.expected ?? (coverage.complete ? coverage.items.length : "?");
  return `${label} ${coverage.items.length}/${expected}`;
}

export async function runCatalogDoctorScenario({
  request,
  mcp,
}: {
  request: string;
  mcp: FakeCatalogDoctorMcp;
}): Promise<{ report: string }> {
  const includeArchive = /(?:включая|проверь|аудит).{0,20}архив|архив.{0,20}(?:каталог|сущност)/iu.test(
    request,
  );
  const checkAllMerchandising = /мерчандайзинг|merchandis/iu.test(request);
  const checkDynamicFilters =
    checkAllMerchandising ||
    /динамическ\p{L}*\s+фильтр|dynamic\s+filters?/iu.test(request);
  const checkBadges = checkAllMerchandising || /бейдж|badges?/iu.test(request);
  const checkContextCollections =
    checkAllMerchandising ||
    /контекстн\p{L}*\s+коллекц|context\s+collections?/iu.test(request);
  const checkSimilarCards =
    checkAllMerchandising ||
    /похож\p{L}*\s+(?:товар|карточ)|similar\s+(?:products?|cards?)/iu.test(
      request,
    );
  const [productsCoverage, variantsCoverage, categoriesCoverage, warehousesCoverage,
    characteristicsCoverage, collectionsCoverage] =
    await Promise.all([
      readEveryPage<CatalogProduct>({
        mcp,
        name: "products",
        itemKey: "products",
        arguments_: {},
      }),
      readEveryPage<CatalogVariant>({
        mcp,
        name: "variants",
        itemKey: "variants",
        arguments_: {
          status: includeArchive ? ["PUBLISHED", "HIDDEN", "ARCHIVED"] : ["PUBLISHED", "HIDDEN"],
        },
      }),
      readEveryPage<CatalogCategory>({
        mcp,
        name: "categories",
        itemKey: "categories",
        arguments_: { status: includeArchive ? ["ACTIVE", "ARCHIVED"] : ["ACTIVE"] },
      }),
      readEveryPage<CatalogWarehouse>({
        mcp,
        name: "warehouses",
        itemKey: "warehouses",
        arguments_: { status: includeArchive ? ["ACTIVE", "ARCHIVED"] : ["ACTIVE"] },
      }),
      readEveryOperationPage<CatalogCharacteristic>({
        mcp,
        operationId: "GetCharacteristics",
        itemKey: "characteristics",
        name: "characteristics",
        query: { status: ["ACTIVE", "ARCHIVED"] },
      }),
      readEveryPage<CatalogCollectionInfo>({
        mcp,
        name: "collections",
        itemKey: "collections",
        arguments_: { status: ["ACTIVE"] },
      }),
    ]);

  const listedProducts = new Map(
    productsCoverage.items.map((product) => [product.id, product]),
  );
  const products = new Map(listedProducts);
  const listedCategories = new Map(
    categoriesCoverage.items.map((category) => [category.id, category]),
  );
  const knownCategories = new Map(listedCategories);
  const listedWarehouses = new Map(
    warehousesCoverage.items.map((warehouse) => [warehouse.id, warehouse]),
  );
  const knownWarehouses = new Map(listedWarehouses);
  const referenceErrors: string[] = [];
  const productLookupErrors = new Map<string, string>();
  const unresolvedProductIds = new Set<string>();
  const unresolvedCategoryIds = new Set<string>();
  const unresolvedWarehouseIds = new Set<string>();

  const referencedProductIds = new Set(
    variantsCoverage.items.map((variant) => variant.product_id),
  );
  for (const id of referencedProductIds) {
    if (products.has(id)) continue;
    try {
      const product = (await mcp.call("get_product", { id })) as CatalogProduct;
      products.set(id, product);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      productLookupErrors.set(id, message);
      if (!isNotFound(error)) {
        unresolvedProductIds.add(id);
        referenceErrors.push(`get_product ${id}: ${message}`);
      }
    }
  }

  const referencedCategoryIds = new Set(
    [...products.values()].flatMap((product) => product.category_ids),
  );
  for (const id of referencedCategoryIds) {
    if (knownCategories.has(id)) continue;
    try {
      const category = (await mcp.call("get_category", { id })) as CatalogCategory;
      knownCategories.set(id, category);
    } catch (error) {
      if (!isNotFound(error)) {
        unresolvedCategoryIds.add(id);
        referenceErrors.push(
          `get_category ${id}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  const referencedWarehouseIds = new Set(
    variantsCoverage.items.flatMap((variant) =>
      variant.stocks.map((stock) => stock.warehouse_id),
    ),
  );
  for (const id of referencedWarehouseIds) {
    if (knownWarehouses.has(id)) continue;
    try {
      const warehouse = (await mcp.call("get_warehouse", { id })) as CatalogWarehouse;
      knownWarehouses.set(id, warehouse);
    } catch (error) {
      if (!isNotFound(error)) {
        unresolvedWarehouseIds.add(id);
        referenceErrors.push(
          `get_warehouse ${id}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  const findings: CatalogFinding[] = [
    ...duplicateFindings(categoriesCoverage.items, "slug"),
    ...duplicateFindings(categoriesCoverage.items, "title"),
    ...duplicateVariantFindings(variantsCoverage.items, "slug"),
    ...duplicateVariantFindings(variantsCoverage.items, "name"),
  ];
  const characteristics = new Map(
    characteristicsCoverage.items.map((characteristic) => [
      characteristic.id,
      characteristic,
    ]),
  );
  const unresolvedCharacteristicIds = new Set<string>();
  const referencedCharacteristicIds = new Set([
    ...variantsCoverage.items.flatMap((variant) =>
      (variant.characteristics ?? []).map(
        (characteristic) => characteristic.characteristic_id,
      ),
    ),
    ...[...products.values()].flatMap((product) => [
      ...(product.settings?.grouping_characteristic_ids ?? []),
      ...(product.settings?.splitting_characteristic_ids ?? []),
    ]),
  ]);
  if (!characteristicsCoverage.complete) {
    for (const id of referencedCharacteristicIds) {
      if (characteristics.has(id)) continue;
      try {
        const characteristic = (await mcp.call("kit_request", {
          operation_id: "GetCharacteristicById",
          path_params: { id },
        })) as CatalogCharacteristic;
        characteristics.set(id, characteristic);
      } catch (error) {
        if (isNotFound(error)) continue;
        unresolvedCharacteristicIds.add(id);
        referenceErrors.push(
          `GetCharacteristicById ${id}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }
  const requiredFields = ownerRequiredFields(request);

  for (const variant of variantsCoverage.items) {
    const object = `SKU ${variant.sku} (${variant.id})`;
    const level = problemLevel(variant);
    const basePrice = decimal(variant.pricing.price);
    const finalPrice = decimal(variant.pricing.final_price);
    const manualDiscount = decimal(variant.pricing.manual_discount_price);

    if (basePrice === undefined || basePrice <= 0) {
      addFinding(findings, level, object, "неположительная или отсутствующая базовая цена");
    }
    if (finalPrice === undefined || finalPrice <= 0) {
      addFinding(findings, level, object, "неположительная или отсутствующая финальная цена");
    }
    if (
      basePrice !== undefined &&
      manualDiscount !== undefined &&
      manualDiscount > basePrice
    ) {
      addFinding(
        findings,
        "risk",
        object,
        `ручная скидочная цена ${variant.pricing.manual_discount_price} выше базовой ${variant.pricing.price}`,
      );
    }

    const available = variant.stocks.reduce(
      (total, stock) => total + stock.quantity - stock.reserved,
      0,
    );
    if (available <= 0) {
      addFinding(findings, level, object, `доступный остаток ${available}`);
    }
    for (const stock of variant.stocks) {
      if (stock.reserved > stock.quantity) {
        addFinding(
          findings,
          "risk",
          object,
          `склад ${stock.warehouse_id}: резерв ${stock.reserved} больше количества ${stock.quantity}`,
        );
      }
      const warehouse = knownWarehouses.get(stock.warehouse_id);
      if (!warehouse) {
        addFinding(
          findings,
          unresolvedWarehouseIds.has(stock.warehouse_id) ? "risk" : level,
          object,
          unresolvedWarehouseIds.has(stock.warehouse_id)
            ? `ссылка на склад не подтверждена из-за ошибки чтения: ${stock.warehouse_id}`
            : `остаток ссылается на отсутствующий склад ${stock.warehouse_id}`,
        );
      } else if (warehouse.status === "ARCHIVED") {
        addFinding(
          findings,
          level,
          object,
          `остаток ссылается на архивный склад ${stock.warehouse_id}`,
        );
      }
    }

    if (!variant.media.some((media) => media.type === "IMAGE" && media.image_id)) {
      addFinding(findings, level, object, "нет изображения");
    }
    const mediaIds = new Map<string, number>();
    const mediaSequences = new Map<number, number>();
    for (const media of variant.media) {
      const id = mediaIdentifier(media);
      if (!id && (media.type === "IMAGE" || media.type === "VIDEO")) {
        const invalidMediaLevel: FindingLevel =
          media.type === "IMAGE" &&
          !variant.media.some(
            (candidate) => candidate.type === "IMAGE" && candidate.image_id,
          )
            ? level
            : "risk";
        addFinding(
          findings,
          invalidMediaLevel,
          object,
          `медиа ${media.type} без ${media.type === "IMAGE" ? "image_id" : "video_id"}`,
        );
      } else if (id) {
        const key = `${media.type}:${id}`;
        mediaIds.set(key, (mediaIds.get(key) ?? 0) + 1);
      }
      mediaSequences.set(
        media.display_sequence,
        (mediaSequences.get(media.display_sequence) ?? 0) + 1,
      );
    }
    for (const [key, count] of mediaIds) {
      if (count > 1) {
        addFinding(
          findings,
          "risk",
          object,
          `повторяется медиа ${key.slice(key.indexOf(":") + 1)} (${count} раза)`,
        );
      }
    }
    for (const [sequence, count] of mediaSequences) {
      if (count > 1) {
        addFinding(
          findings,
          "risk",
          object,
          `повторяется порядок медиа ${sequence} (${count} элемента)`,
        );
      }
    }
    if (
      variant.media.some((media) => media.type === "IMAGE" && media.image_id) &&
      !variant.media.some(
        (media) =>
          media.type === "IMAGE" &&
          Boolean(media.image_id) &&
          media.display_sequence === 1,
      )
    ) {
      addFinding(
        findings,
        "risk",
        object,
        "нет главного изображения с display_sequence 1",
      );
    }
    if (!variant.product_card_id) {
      addFinding(findings, "risk", object, "отсутствует product_card_id");
    }
    if (!variant.name.trim()) {
      addFinding(
        findings,
        "risk",
        object,
        "неполная карточка: пустое обязательное API-поле name",
      );
    }
    if (!variant.slug.trim()) {
      addFinding(
        findings,
        "risk",
        object,
        "неполная карточка: пустое обязательное API-поле slug",
      );
    }
    for (const field of requiredFields) {
      if (!(variant[field] ?? "").trim()) {
        addFinding(
          findings,
          level,
          object,
          `обязательное поле владельца «${requiredFieldLabel(field)}» не заполнено`,
        );
      }
    }
    for (const field of ["brand", "description"] as const) {
      if (
        !requiredFields.includes(field) &&
        variant[field] !== undefined &&
        !(variant[field] ?? "").trim()
      ) {
        addFinding(
          findings,
          "recommendation",
          object,
          `опциональное поле «${requiredFieldLabel(field)}» не заполнено и не объявлено владельцем обязательным`,
        );
      }
    }
    for (const characteristic of variant.characteristics ?? []) {
      if (!characteristics.has(characteristic.characteristic_id)) {
        addFinding(
          findings,
          unresolvedCharacteristicIds.has(characteristic.characteristic_id)
            ? "risk"
            : level,
          object,
          unresolvedCharacteristicIds.has(characteristic.characteristic_id)
            ? `ссылка на характеристику ${characteristic.characteristic_id} не подтверждена из-за неполного чтения`
            : `сломанная ссылка на характеристику ${characteristic.characteristic_id}`,
        );
      }
    }

    const product = products.get(variant.product_id);
    if (!product) {
      const lookupError = productLookupErrors.get(variant.product_id);
      const unresolved = unresolvedProductIds.has(variant.product_id);
      addFinding(
        findings,
        unresolved || !productsCoverage.complete ? "risk" : level,
        object,
        unresolved
          ? `связь с product_id ${variant.product_id} не подтверждена из-за ошибки чтения${lookupError ? `; get_product: ${lookupError}` : ""}`
          : productsCoverage.complete
            ? `сломанная связь: product_id ${variant.product_id} не найден${lookupError ? ` (${lookupError})` : ""}`
            : `связь с product_id ${variant.product_id} не подтверждена из-за неполной пагинации продуктов${lookupError ? `; get_product: ${lookupError}` : ""}`,
      );
      continue;
    }
    if (product.category_ids.length === 0) {
      addFinding(findings, level, object, `продукт ${product.id} без активной категории`);
      addFinding(
        findings,
        "recommendation",
        object,
        `проверить категорийные привязки продукта ${product.id}: Product.category_ids не показывает архивные категории, поэтому read-only API не отличает их отсутствие от связи только с архивом`,
      );
      continue;
    }
    const productCategories = product.category_ids.map((id) => knownCategories.get(id));
    const unresolvedProductCategoryIds = product.category_ids.filter(
      (id, index) =>
        productCategories[index] === undefined && unresolvedCategoryIds.has(id),
    );
    const missingCategoryIds = product.category_ids.filter(
      (id, index) =>
        productCategories[index] === undefined && !unresolvedCategoryIds.has(id),
    );
    if (unresolvedProductCategoryIds.length > 0) {
      addFinding(
        findings,
        "risk",
        object,
        unresolvedProductCategoryIds.length === 1
          ? `ссылка на категорию не подтверждена из-за ошибки чтения: ${unresolvedProductCategoryIds[0]}`
          : `ссылки на категории не подтверждены из-за ошибки чтения: ${unresolvedProductCategoryIds.join(", ")}`,
      );
    }
    if (missingCategoryIds.length > 0) {
      addFinding(
        findings,
        level,
        object,
        `сломанные ссылки на категории: ${missingCategoryIds.join(", ")}`,
      );
    }
    if (includeArchive && product.category_ids.length === 1) {
      addFinding(
        findings,
        "risk",
        object,
        `у продукта ${product.id} одна активная категория ${product.category_ids[0]}; её архивация уберёт единственный наблюдаемый активный путь`,
      );
    }
  }

  const variantsByProduct = new Map<string, CatalogVariant[]>();
  for (const variant of variantsCoverage.items) {
    variantsByProduct.set(variant.product_id, [
      ...(variantsByProduct.get(variant.product_id) ?? []),
      variant,
    ]);
  }
  for (const [productId, product] of products) {
    const productVariants = variantsByProduct.get(productId) ?? [];
    const activeVariants = productVariants.filter(
      (variant) => variant.status === "PUBLISHED" || variant.status === "HIDDEN",
    );
    const groupingIds = product.settings?.grouping_characteristic_ids ?? [];
    const splittingIds = product.settings?.splitting_characteristic_ids ?? [];
    const productLevel: FindingLevel = activeVariants.some(
      (variant) => variant.status === "PUBLISHED",
    )
      ? "blocker"
      : "risk";

    for (const splittingId of splittingIds) {
      if (!groupingIds.includes(splittingId)) {
        addFinding(
          findings,
          "risk",
          `Продукт ${productId}`,
          `разделяющая характеристика ${splittingId} не входит в группирующие`,
        );
      }
    }
    for (const groupingId of groupingIds) {
      const definition = characteristics.get(groupingId);
      if (!definition) {
        addFinding(
          findings,
          unresolvedCharacteristicIds.has(groupingId) ? "risk" : productLevel,
          `Продукт ${productId}`,
          unresolvedCharacteristicIds.has(groupingId)
            ? `ссылка на характеристику ${groupingId} в настройках группировки не подтверждена из-за неполного чтения`
            : `сломанная ссылка на характеристику ${groupingId} в настройках группировки`,
        );
      } else if (definition.status === "ARCHIVED" && activeVariants.length > 0) {
        addFinding(
          findings,
          productLevel,
          `Продукт ${productId}`,
          `активный продукт использует архивную характеристику ${groupingId}`,
        );
      }
      for (const variant of productVariants) {
        if (characteristicValues(variant, groupingId).length === 0) {
          addFinding(
            findings,
            problemLevel(variant),
            `SKU ${variant.sku} (${variant.id})`,
            `не задано значение группирующей характеристики ${groupingId}`,
          );
        }
      }
      if (productVariants.length > 1) {
        const distinctValues = new Set(
          productVariants
            .map((variant) => characteristicValues(variant, groupingId).join("\u001f"))
            .filter(Boolean),
        );
        if (distinctValues.size === 1) {
          addFinding(
            findings,
            "risk",
            `Продукт ${productId}`,
            `характеристика ${groupingId} не обеспечивает группировку: у всех заполненных вариантов одно значение`,
          );
        }
      }
    }

    if (groupingIds.length > 0) {
      const combinations = new Map<string, CatalogVariant[]>();
      for (const variant of productVariants) {
        const values = groupingIds.map((id) =>
          characteristicValues(variant, id).sort().join("\u001e"),
        );
        if (values.some((value) => value === "")) continue;
        const key = values.join("\u001d");
        combinations.set(key, [...(combinations.get(key) ?? []), variant]);
      }
      for (const duplicates of combinations.values()) {
        if (duplicates.length < 2) continue;
        addFinding(
          findings,
          "risk",
          `Продукт ${productId}`,
          `одинаковая комбинация группирующих характеристик у SKU ${duplicates
            .map((variant) => variant.sku)
            .join(", ")}`,
        );
      }
    }
  }

  const knownVariantIds = new Set(variantsCoverage.items.map((variant) => variant.id));
  const collectionRelations = await Promise.all(
    collectionsCoverage.items.map(async (collection) => ({
      collection,
      coverage: await readEveryOperationPage<string>({
        mcp,
        operationId: "GetVariantsByCollectionId",
        itemKey: "variant_ids",
        name: "collections",
        pathParams: { collection_id: collection.id },
      }),
    })),
  );
  for (const { collection, coverage } of collectionRelations) {
    if (collection.cards_count === 0) {
      addFinding(
        findings,
        "risk",
        `Коллекция ${collection.id}`,
        `активная коллекция ${collection.id} пуста`,
      );
    }
    if (collection.hidden_cards_count > 0) {
      addFinding(
        findings,
        "risk",
        `Коллекция ${collection.id}`,
        `активная коллекция ${collection.id} содержит ${collection.hidden_cards_count} скрытую карточку`,
      );
    }
    for (const variantId of coverage.items) {
      if (knownVariantIds.has(variantId)) continue;
      try {
        const linkedVariant = (await mcp.call("get_variant", {
          id: variantId,
        })) as CatalogVariant;
        knownVariantIds.add(linkedVariant.id);
        if (linkedVariant.status === "ARCHIVED") {
          addFinding(
            findings,
            "risk",
            `Коллекция ${collection.id}`,
            `активная коллекция ссылается на архивный variant_id ${variantId}`,
          );
        }
      } catch (error) {
        if (!isNotFound(error)) {
          const message = error instanceof Error ? error.message : String(error);
          referenceErrors.push(`get_variant ${variantId}: ${message}`);
          addFinding(
            findings,
            "risk",
            `Коллекция ${collection.id}`,
            `связь с variant_id ${variantId} не подтверждена: ${message}`,
          );
          continue;
        }
        addFinding(
          findings,
          "risk",
          `Коллекция ${collection.id}`,
          `сломанная связь с variant_id ${variantId}`,
        );
      }
    }
  }

  let badgesCoverage: Coverage<CatalogBadge> | undefined;
  let contextCoverage: Coverage<CatalogContextCollection> | undefined;
  const badgeBindingCoverages: Coverage<string>[] = [];
  const similarCoverages: Coverage<string>[] = [];
  let similarCardScope = 0;
  if (checkBadges || checkDynamicFilters) {
    badgesCoverage = await readEveryOperationPage<CatalogBadge>({
      mcp,
      operationId: "GetBadges",
      itemKey: "badges",
      name: "collections",
    });
    if (checkBadges) {
      const knownCategoryIds = new Set(
        categoriesCoverage.items.map((category) => category.id),
      );
      const knownCollectionIds = new Set(
        collectionsCoverage.items.map((collection) => collection.id),
      );
      for (const badge of badgesCoverage.items) {
        if (badge.binding_mode === "SELECTED_VARIANTS") {
          const bindings = await readEveryOperationPage<string>({
            mcp,
            operationId: "GetBadgeVariantIDs",
            itemKey: "variant_ids",
            name: "collections",
            pathParams: { badge_id: badge.id },
          });
          badgeBindingCoverages.push(bindings);
          for (const variantId of bindings.items) {
            if (knownVariantIds.has(variantId)) continue;
            addFinding(
              findings,
              "risk",
              `Бейдж ${badge.id}`,
              `сломанная или непроверенная привязка к variant_id ${variantId}`,
            );
          }
          continue;
        }
        const [categoryBindings, collectionBindings] = await Promise.all([
          readEveryOperationPage<string>({
            mcp,
            operationId: "GetBadgeCategoryIDs",
            itemKey: "category_ids",
            name: "collections",
            pathParams: { badge_id: badge.id },
          }),
          readEveryOperationPage<string>({
            mcp,
            operationId: "GetBadgeCollectionIDs",
            itemKey: "collection_ids",
            name: "collections",
            pathParams: { badge_id: badge.id },
          }),
        ]);
        badgeBindingCoverages.push(categoryBindings, collectionBindings);
        for (const categoryId of categoryBindings.items) {
          if (knownCategoryIds.has(categoryId)) continue;
          addFinding(
            findings,
            "risk",
            `Бейдж ${badge.id}`,
            `сломанная или непроверенная привязка к category_id ${categoryId}`,
          );
        }
        for (const collectionId of collectionBindings.items) {
          if (knownCollectionIds.has(collectionId)) continue;
          addFinding(
            findings,
            "risk",
            `Бейдж ${badge.id}`,
            `сломанная или непроверенная привязка к collection_id ${collectionId}`,
          );
        }
      }
    }
  }

  if (checkDynamicFilters) {
    const categorySlugs = new Set(
      categoriesCoverage.items.map((category) => category.slug),
    );
    const characteristicSlugs = new Set(
      characteristicsCoverage.items.map((characteristic) => characteristic.slug),
    );
    const badgeSlugs = new Set(
      (badgesCoverage?.items ?? []).map((badge) => badge.slug),
    );
    for (const collection of collectionsCoverage.items) {
      if (collection.collection_type !== "DYNAMIC") continue;
      if (!collection.dynamic_filter) {
        addFinding(
          findings,
          "risk",
          `Коллекция ${collection.id}`,
          "динамическая коллекция не содержит dynamic_filter",
        );
        continue;
      }
      for (const slug of collection.dynamic_filter.category_slugs ?? []) {
        if (!categorySlugs.has(slug)) {
          addFinding(
            findings,
            "risk",
            `Коллекция ${collection.id}`,
            `динамический фильтр ссылается на отсутствующую категорию ${slug}`,
          );
        }
      }
      for (const filter of collection.dynamic_filter.characteristic_filters ?? []) {
        if (!characteristicSlugs.has(filter.field)) {
          addFinding(
            findings,
            "risk",
            `Коллекция ${collection.id}`,
            `динамический фильтр ссылается на отсутствующую характеристику ${filter.field}`,
          );
        }
      }
      for (const filter of collection.dynamic_filter.main_filter ?? []) {
        const values =
          "values" in filter
            ? filter.values
            : "value" in filter && filter.value
              ? [filter.value]
              : [];
        if (filter.field === "badge_slugs") {
          for (const slug of values) {
            if (badgeSlugs.has(slug)) continue;
            addFinding(
              findings,
              "risk",
              `Коллекция ${collection.id}`,
              `динамический фильтр ссылается на отсутствующий бейдж ${slug}`,
            );
          }
        }
        if (filter.field === "has_characteristics") {
          for (const slug of values) {
            if (characteristicSlugs.has(slug)) continue;
            addFinding(
              findings,
              "risk",
              `Коллекция ${collection.id}`,
              `динамический фильтр ссылается на отсутствующую характеристику ${slug}`,
            );
          }
        }
      }
    }
  }

  if (checkContextCollections) {
    contextCoverage = await readEveryOperationPage<CatalogContextCollection>({
      mcp,
      operationId: "GetContextCollections",
      itemKey: "context_collections",
      name: "collections",
    });
    const characteristicSlugs = new Set(
      characteristicsCoverage.items.map((characteristic) => characteristic.slug),
    );
    for (const contextCollection of contextCoverage.items) {
      for (const condition of contextCollection.conditions) {
        if (
          condition.type === "CHARACTERISTIC" &&
          (!condition.characteristic_slug ||
            !characteristicSlugs.has(condition.characteristic_slug))
        ) {
          addFinding(
            findings,
            "risk",
            `Контекстная коллекция ${contextCollection.id}`,
            `условие ссылается на отсутствующую характеристику ${condition.characteristic_slug ?? "(slug не задан)"}`,
          );
        }
      }
    }
  }

  if (checkSimilarCards) {
    const knownCardIds = new Set(
      variantsCoverage.items
        .map((variant) => variant.product_card_id)
        .filter((id): id is string => Boolean(id)),
    );
    similarCardScope = knownCardIds.size;
    for (const cardId of knownCardIds) {
      const coverage = await readEveryOperationPage<string>({
        mcp,
        operationId: "GetSimilarProductCardIDs",
        itemKey: "product_card_ids",
        name: "collections",
        pathParams: { product_card_id: cardId },
      });
      similarCoverages.push(coverage);
      for (const similarCardId of coverage.items) {
        if (!knownCardIds.has(similarCardId)) {
          addFinding(
            findings,
            "risk",
            `Карточка ${cardId}`,
            `сломанная или непроверенная связь с похожей карточкой ${similarCardId}`,
          );
        }
      }
    }
  }

  const coverageErrors = [
    productsCoverage,
    variantsCoverage,
    categoriesCoverage,
    warehousesCoverage,
    characteristicsCoverage,
    collectionsCoverage,
    ...collectionRelations.map(({ coverage }) => coverage),
    ...(badgesCoverage ? [badgesCoverage] : []),
    ...badgeBindingCoverages,
    ...(contextCoverage ? [contextCoverage] : []),
    ...similarCoverages,
  ]
    .filter((coverage) => !coverage.complete)
    .map((coverage) => coverage.error ?? `list_${coverage.name}: чтение завершилось раньше ожидаемого`);
  if (coverageErrors.length > 0 || referenceErrors.length > 0) {
    addFinding(
      findings,
      "recommendation",
      "Покрытие",
      "повторить аудит после восстановления чтения недоступных страниц и ссылок",
    );
  }
  if (findings.some((finding) => finding.level === "blocker")) {
    addFinding(
      findings,
      "recommendation",
      "Каталог",
      "сначала устранить подтверждённые блокеры, используя только значения владельца",
    );
  }
  if (findings.some((finding) => finding.level === "risk")) {
    addFinding(
      findings,
      "recommendation",
      "Каталог",
      "проверить риски по источнику данных до любых изменений",
    );
  }

  const linkedCategoryCount = knownCategories.size - listedCategories.size;
  const linkedWarehouseCount = knownWarehouses.size - listedWarehouses.size;
  const linkedProductCount = products.size - listedProducts.size;
  const linkedProductExpected = linkedProductCount + unresolvedProductIds.size;
  const linkedCategoryExpected = linkedCategoryCount + unresolvedCategoryIds.size;
  const linkedWarehouseExpected = linkedWarehouseCount + unresolvedWarehouseIds.size;
  const complete = coverageErrors.length === 0 && referenceErrors.length === 0;
  const coverageLine = [
    formatCoverage(productsCoverage, linkedProductCount, linkedProductExpected),
    formatCoverage(variantsCoverage),
    formatCoverage(categoriesCoverage, linkedCategoryCount, linkedCategoryExpected),
    formatCoverage(warehousesCoverage, linkedWarehouseCount, linkedWarehouseExpected),
  ].join(", ");
  const structuralCoverageLine = [
    `характеристики ${characteristics.size}/${
      characteristicsCoverage.expected ??
      (characteristicsCoverage.complete ? characteristics.size : "?")
    }`,
    formatCoverage(collectionsCoverage),
    ...(badgesCoverage
      ? [collectionCoverageLabel("бейджи", badgesCoverage)]
      : []),
    ...(contextCoverage
      ? [collectionCoverageLabel("контекстные коллекции", contextCoverage)]
      : []),
    ...(checkSimilarCards
      ? [`похожие карточки ${similarCoverages.length}/${similarCardScope}`]
      : []),
  ].join(", ");
  const evidenceErrors = [...coverageErrors, ...referenceErrors];
  const healthy =
    complete &&
    !findings.some((finding) => finding.level === "blocker" || finding.level === "risk");
  const report = [
    "Глубокий аудит каталога",
    `Покрытие: ${coverageLine}. Страниц: продукты ${productsCoverage.pages}, варианты ${variantsCoverage.pages}, категории ${categoriesCoverage.pages}, склады ${warehousesCoverage.pages}.`,
    `Структурное покрытие: ${structuralCoverageLine}.`,
    complete
      ? "Покрытие полное по запрошенному активному каталогу и используемым ссылкам."
      : `Покрытие неполное: ${evidenceErrors.join("; ")}.`,
    formatSection("Блокеры", "blocker", findings),
    formatSection("Риски", "risk", findings),
    formatSection("Рекомендации", "recommendation", findings),
    healthy
      ? "Каталог исправен по проверенным критериям."
      : complete
        ? "Вывод относится только к проверенным критериям; правильные цены и остатки не вычислялись."
        : "Нельзя утверждать, что весь каталог исправен: часть данных не прочитана.",
    "Аудит выполнен только чтением; изменения каталога не вызывались.",
  ].join("\n\n");
  mcp.finish(report);
  return { report };
}
