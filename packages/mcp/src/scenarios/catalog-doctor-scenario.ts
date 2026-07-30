import type { components } from "yandex-kit-core";

type KitProduct = components["schemas"]["Product"];
type KitVariant = components["schemas"]["Variant"];
type KitCategory = components["schemas"]["Category"];
type KitWarehouse = components["schemas"]["Warehouse"];

export interface CatalogProduct {
  id: KitProduct["id"];
  category_ids: KitProduct["category_ids"];
}

export interface CatalogVariant {
  id: KitVariant["id"];
  sku: KitVariant["sku"];
  name: KitVariant["name"];
  slug: KitVariant["slug"];
  status: KitVariant["status"];
  product_id: KitVariant["product_id"];
  product_card_id?: KitVariant["product_card_id"];
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
  "get_category",
  "get_warehouse",
]);

function notFound(message: string): Error {
  const error = new Error(message);
  error.name = "NotFoundError";
  return error;
}

function isNotFound(error: unknown): boolean {
  return error instanceof Error && error.name === "NotFoundError";
}

type CatalogCollection = "products" | "variants" | "categories" | "warehouses";

export class FakeCatalogDoctorMcp {
  readonly calls: CatalogDoctorToolCall[] = [];
  readonly #pageSize: number;
  readonly #products: CatalogProduct[];
  readonly #variants: CatalogVariant[];
  readonly #categories: CatalogCategory[];
  readonly #warehouses: CatalogWarehouse[];
  readonly #readErrors: Record<string, Error>;
  finalAnswer: string | undefined;

  constructor({
    pageSize = 100,
    products,
    variants,
    categories,
    warehouses,
    readErrors = {},
  }: {
    pageSize?: number;
    products: CatalogProduct[];
    variants: CatalogVariant[];
    categories: CatalogCategory[];
    warehouses: CatalogWarehouse[];
    readErrors?: Record<string, Error>;
  }) {
    this.#pageSize = pageSize;
    this.#products = products;
    this.#variants = variants;
    this.#categories = categories;
    this.#warehouses = warehouses;
    this.#readErrors = readErrors;
  }

  get writeCalls(): CatalogDoctorToolCall[] {
    return this.calls.filter((call) => !READ_TOOLS.has(call.name));
  }

  async call(name: string, arguments_: Record<string, unknown>): Promise<unknown> {
    this.calls.push({ name, arguments: arguments_ });
    const page = typeof arguments_.page === "number" ? arguments_.page : 1;
    const preparedError = this.#readErrors[`${name}:${String(arguments_.id ?? page)}`];
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
  return `${coverage.name === "products" ? "продукты" : coverage.name === "variants" ? "варианты" : coverage.name === "categories" ? "категории" : "склады"} ${checked}/${expected}`;
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
  const [productsCoverage, variantsCoverage, categoriesCoverage, warehousesCoverage] =
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
          level,
          object,
          `остаток ссылается на отсутствующий склад ${stock.warehouse_id}`,
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
    if (!variant.product_card_id) {
      addFinding(findings, "risk", object, "отсутствует product_card_id");
    }

    const product = products.get(variant.product_id);
    if (!product) {
      const lookupError = productLookupErrors.get(variant.product_id);
      addFinding(
        findings,
        productsCoverage.complete ? level : "risk",
        object,
        productsCoverage.complete
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
    const missingCategoryIds = product.category_ids.filter(
      (id, index) => productCategories[index] === undefined,
    );
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

  const coverageErrors = [
    productsCoverage,
    variantsCoverage,
    categoriesCoverage,
    warehousesCoverage,
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
  const evidenceErrors = [...coverageErrors, ...referenceErrors];
  const healthy =
    complete &&
    !findings.some((finding) => finding.level === "blocker" || finding.level === "risk");
  const report = [
    "Глубокий аудит каталога",
    `Покрытие: ${coverageLine}. Страниц: продукты ${productsCoverage.pages}, варианты ${variantsCoverage.pages}, категории ${categoriesCoverage.pages}, склады ${warehousesCoverage.pages}.`,
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
