import type {
  OperatorDiscount,
  OperatorOrder,
  OperatorProduct,
  OperatorPromocode,
  OperatorVariant,
  OperatorWebhook,
} from "./operator-skill-scenario.js";
import {
  FakeP1Mcp,
  type PromoCategory,
  type PromoGift,
  type PromoStore,
  type PromoWarehouse,
} from "./promo-launcher-skill-scenario.js";

export type LaunchStatus = "NOT_READY" | "CONDITIONALLY_READY" | "READY";

export interface LaunchCoverage {
  complete: boolean;
  counts: {
    stores: number;
    products: number;
    variants: number;
    categories: number;
    warehouses: number;
    discounts: number;
    promocodes: number;
    gifts: number;
    webhooks: number;
    orders: number;
  };
  pages: Record<string, number>;
}

export interface LaunchCheckResult {
  status: LaunchStatus;
  blockers: string[];
  risks: string[];
  unchecked: string[];
  recommendations: string[];
  coverage: LaunchCoverage;
  report: string;
}

interface PageResult<T> {
  items: T[];
  pages: number;
  complete: boolean;
  error?: string;
}

async function readEveryPage<T>({
  tool,
  arguments_: baseArguments,
  buildArguments,
  select,
  mcp,
}: {
  tool: string;
  arguments_: Record<string, unknown>;
  buildArguments?: (
    baseArguments: Record<string, unknown>,
    page: number,
  ) => Record<string, unknown>;
  select: (response: unknown) => { items: T[]; total_count: number };
  mcp: FakeP1Mcp;
}): Promise<PageResult<T>> {
  const items: T[] = [];
  let page = 1;
  let pages = 0;
  let totalCount: number | undefined;
  while (totalCount === undefined || items.length < totalCount) {
    let selected: { items: T[]; total_count: number };
    try {
      selected = select(
        await mcp.call(
          tool,
          buildArguments?.(baseArguments, page) ?? {
            ...baseArguments,
            page,
            per_page: 100,
          },
        ),
      );
    } catch (error) {
      return {
        items,
        pages,
        complete: false,
        error: `страница ${page}: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
    pages += 1;
    totalCount = selected.total_count;
    items.push(...selected.items);
    if (selected.items.length === 0 && items.length < totalCount) {
      return {
        items,
        pages,
        complete: false,
        error: `пагинация остановилась на ${items.length} из ${totalCount}`,
      };
    }
    page += 1;
  }
  return { items, pages, complete: true };
}

function expired(endDate: string | undefined, now: Date): boolean {
  return endDate !== undefined && new Date(endDate).getTime() < now.getTime();
}

function formatSection(title: string, items: string[]): string {
  return `${title} (${items.length})\n${
    items.length > 0 ? items.map((item) => `- ${item}`).join("\n") : "- нет"
  }`;
}

async function selectedPromotionCount({
  kind,
  id,
  mode,
  mcp,
}: {
  kind: "Discount" | "Promocode";
  id: string;
  mode: string | undefined;
  mcp: FakeP1Mcp;
}): Promise<{ count?: number; error?: string }> {
  if (mode === "ALL_VARIANTS" || mode === undefined) return { count: undefined };
  const suffixes =
    mode === "SELECTED_VARIANTS"
      ? ["VariantIDs"]
      : ["CategoryIDs", "CollectionIDs"];
  let count = 0;
  for (const suffix of suffixes) {
    try {
      const response = (await mcp.call("kit_request", {
        operation_id: `Get${kind}${suffix}`,
        path_params: { id },
        query: { page: 1, per_page: 100 },
      })) as {
        variant_ids?: string[];
        category_ids?: string[];
        collection_ids?: string[];
      };
      count +=
        response.variant_ids?.length ??
        response.category_ids?.length ??
        response.collection_ids?.length ??
        0;
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
  return { count };
}

function availableStock(
  variant: OperatorVariant,
  warehouses: Map<string, PromoWarehouse>,
): number {
  return variant.stocks.reduce((total, stock) => {
    if (warehouses.get(stock.warehouse_id)?.status !== "ACTIVE") return total;
    return total + Math.max(0, stock.quantity - stock.reserved);
  }, 0);
}

function coverageReport(coverage: LaunchCoverage): string {
  const counts = coverage.counts;
  return (
    `Покрытие: магазин ${counts.stores}; продукты ${counts.products}; ` +
    `варианты ${counts.variants}; категории ${counts.categories}; склады ${
      counts.warehouses
    }; скидки ${counts.discounts}; промокоды ${counts.promocodes}; подарки ${
      counts.gifts
    }; вебхуки ${counts.webhooks}; заказы ${counts.orders}. ` +
    `Страницы: ${Object.entries(coverage.pages)
      .map(([name, pages]) => `${name}=${pages}`)
      .join(", ")}. Полнота: ${coverage.complete ? "полная" : "неполная"}.`
  );
}

export async function runLaunchCheckScenario({
  request: _request,
  now,
  externalOrderProcessing,
  mcp,
}: {
  request: string;
  now: Date;
  externalOrderProcessing?: boolean;
  mcp: FakeP1Mcp;
}): Promise<LaunchCheckResult> {
  const blockers: string[] = [];
  const risks: string[] = [];
  const unchecked: string[] = [];
  const recommendations: string[] = [];
  const pages: Record<string, number> = {};

  let store: PromoStore | undefined;
  try {
    store = (await mcp.call("get_store", {})) as PromoStore;
  } catch (error) {
    blockers.push(
      `Доступ к KIT API не подтверждён: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  const variants = await readEveryPage<OperatorVariant>({
    tool: "list_variants",
    arguments_: { status: ["PUBLISHED"] },
    select: (response) => {
      const value = response as { variants: OperatorVariant[]; total_count: number };
      return { items: value.variants, total_count: value.total_count };
    },
    mcp,
  });
  const products = await readEveryPage<OperatorProduct>({
    tool: "list_products",
    arguments_: {},
    select: (response) => {
      const value = response as { products: OperatorProduct[]; total_count: number };
      return { items: value.products, total_count: value.total_count };
    },
    mcp,
  });
  const categories = await readEveryPage<PromoCategory>({
    tool: "list_categories",
    arguments_: { status: ["ACTIVE", "ARCHIVED"] },
    select: (response) => {
      const value = response as { categories: PromoCategory[]; total_count: number };
      return { items: value.categories, total_count: value.total_count };
    },
    mcp,
  });
  const warehouses = await readEveryPage<PromoWarehouse>({
    tool: "list_warehouses",
    arguments_: { status: ["ACTIVE", "ARCHIVED"] },
    select: (response) => {
      const value = response as { warehouses: PromoWarehouse[]; total_count: number };
      return { items: value.warehouses, total_count: value.total_count };
    },
    mcp,
  });
  const discounts = await readEveryPage<OperatorDiscount>({
    tool: "list_discounts",
    arguments_: { status: ["ACTIVE"] },
    select: (response) => {
      const value = response as { discounts: OperatorDiscount[]; total_count: number };
      return { items: value.discounts, total_count: value.total_count };
    },
    mcp,
  });
  const promocodes = await readEveryPage<OperatorPromocode>({
    tool: "list_promocodes",
    arguments_: { status: "ACTIVE" },
    select: (response) => {
      const value = response as { promocodes: OperatorPromocode[]; total_count: number };
      return { items: value.promocodes, total_count: value.total_count };
    },
    mcp,
  });
  const gifts = await readEveryPage<PromoGift>({
    tool: "kit_request",
    arguments_: {
      operation_id: "GetGifts",
      query: { status: "ACTIVE" },
    },
    buildArguments: (baseArguments, page) => ({
      ...baseArguments,
      query: {
        ...(baseArguments.query as Record<string, unknown>),
        page,
        per_page: 100,
      },
    }),
    select: (response) => {
      const value = response as { gifts: PromoGift[]; total_count: number };
      return { items: value.gifts, total_count: value.total_count };
    },
    mcp,
  });

  let webhooks: OperatorWebhook[] = [];
  let webhookComplete = true;
  try {
    const response = (await mcp.call("list_webhooks", {})) as {
      webhooks: OperatorWebhook[];
    };
    webhooks = response.webhooks;
  } catch (error) {
    webhookComplete = false;
    risks.push(
      `Вебхуки не прочитаны: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const orders = await readEveryPage<OperatorOrder>({
    tool: "list_orders",
    arguments_: {},
    select: (response) => {
      const value = response as { orders: OperatorOrder[]; total_count: number };
      return { items: value.orders, total_count: value.total_count };
    },
    mcp,
  });

  const paged = {
    variants,
    products,
    categories,
    warehouses,
    discounts,
    promocodes,
    gifts,
    orders,
  };
  for (const [name, result] of Object.entries(paged)) {
    pages[name] = result.pages;
    if (!result.complete) {
      risks.push(`${name}: покрытие неполное (${result.error ?? "неизвестная ошибка"})`);
    }
  }
  pages.webhooks = webhookComplete ? 1 : 0;

  if (store && !store.b2c_url) {
    blockers.push(`Магазин ${store.id}: публичный b2c URL отсутствует`);
  } else if (store?.b2c_url) {
    unchecked.push(
      `Публичная витрина ${store.b2c_url} указана в API, но её доступность ещё не проверена`,
    );
  }

  const productById = new Map(products.items.map((product) => [product.id, product]));
  const categoryById = new Map(categories.items.map((item) => [item.id, item]));
  const warehouseById = new Map(warehouses.items.map((item) => [item.id, item]));
  if (variants.complete && variants.items.length === 0) {
    blockers.push("Нет ни одного опубликованного варианта для первой продажи");
  }
  for (const variant of variants.items) {
    const label = `SKU ${variant.sku} (${variant.id})`;
    const price = Number(variant.pricing.price);
    if (!Number.isFinite(price) || price <= 0) {
      blockers.push(`${label}: отсутствует положительная цена`);
    }
    for (const stock of variant.stocks) {
      if (stock.reserved > stock.quantity) {
        blockers.push(
          `${label}: склад ${stock.warehouse_id}, резерв ${stock.reserved} больше количества ${stock.quantity}`,
        );
      }
      const warehouse = warehouseById.get(stock.warehouse_id);
      if (!warehouse) {
        blockers.push(`${label}: ссылка на отсутствующий склад ${stock.warehouse_id}`);
      } else if (warehouse.status === "ARCHIVED") {
        blockers.push(`${label}: ссылка на архивный склад ${stock.warehouse_id}`);
      }
    }
    if (availableStock(variant, warehouseById) <= 0) {
      blockers.push(`${label}: нет доступного остатка на активном складе`);
    }
    if (!variant.media.some((media) => media.type === "IMAGE")) {
      blockers.push(`${label}: отсутствует изображение`);
    }
    const product = productById.get(variant.product_id);
    if (!product) {
      const message = `${label}: родительский продукт ${variant.product_id} не прочитан`;
      if (products.complete) blockers.push(message);
      else risks.push(message);
    } else {
      const activeCategories = product.category_ids.filter(
        (id) => categoryById.get(id)?.status === "ACTIVE",
      );
      if (activeCategories.length === 0) {
        blockers.push(`${label}: у продукта ${product.id} нет активной категории`);
      }
    }
  }

  for (const discount of discounts.items) {
    if (expired(discount.discount_dates.end_date, now)) {
      risks.push(
        `Скидка ${discount.title} (${discount.id}) активна после окончания ${discount.discount_dates.end_date}`,
      );
    }
    const selected = await selectedPromotionCount({
      kind: "Discount",
      id: discount.id,
      mode: discount.binding_mode,
      mcp,
    });
    if (selected.error) {
      risks.push(`Скидка ${discount.id}: привязки не прочитаны (${selected.error})`);
    } else if (selected.count === 0) {
      risks.push(`Скидка ${discount.id}: выбранный режим не содержит объектов`);
    }
  }
  for (const promocode of promocodes.items) {
    if (expired(promocode.promocode_dates.end_date, now)) {
      risks.push(
        `Промокод ${promocode.code} (${promocode.id}) активен после окончания ${promocode.promocode_dates.end_date}`,
      );
    }
    if (
      promocode.max_usage !== undefined &&
      promocode.usage_count >= promocode.max_usage
    ) {
      risks.push(
        `Промокод ${promocode.code} (${promocode.id}): лимит исчерпан ${promocode.usage_count}/${promocode.max_usage}`,
      );
    }
    const selected = await selectedPromotionCount({
      kind: "Promocode",
      id: promocode.id,
      mode: promocode.binding_mode,
      mcp,
    });
    if (selected.error) {
      risks.push(`Промокод ${promocode.id}: привязки не прочитаны (${selected.error})`);
    } else if (selected.count === 0) {
      risks.push(`Промокод ${promocode.id}: выбранный режим не содержит объектов`);
    }
  }
  for (const gift of gifts.items) {
    try {
      const response = (await mcp.call("kit_request", {
        operation_id: "GetGiftVariants",
        path_params: { id: gift.id },
        query: { page: 1, per_page: 100 },
      })) as { variant_ids: string[] };
      if (response.variant_ids.length === 0) {
        risks.push(`Подарок ${gift.title} (${gift.id}) активен без товаров`);
      }
    } catch (error) {
      risks.push(
        `Подарок ${gift.id}: состав не прочитан (${
          error instanceof Error ? error.message : String(error)
        })`,
      );
    }
  }

  const requiredWebhookEvents = [
    "ORDER_STATUS_CHANGED",
    "ORDER_PAYMENT_STATUS_CHANGED",
    "ORDER_DELIVERY_STATUS_CHANGED",
  ];
  if (externalOrderProcessing === true) {
    const activeEvents = new Set<string>(
      webhooks
        .filter((webhook) => webhook.status === "ACTIVE")
        .flatMap((webhook) => webhook.events),
    );
    const missing = requiredWebhookEvents.filter((event) => !activeEvents.has(event));
    if (missing.length > 0) {
      blockers.push(
        `Для внешней обработки заказов нет активного webhook-покрытия: ${missing.join(", ")}`,
      );
    }
  } else if (externalOrderProcessing === undefined) {
    unchecked.push(
      "Неизвестно, используется ли внешняя обработка заказов и обязательны ли вебхуки",
    );
  }

  if (orders.items.length === 0 && orders.complete) {
    unchecked.push("Подтверждённых заказов нет: это отсутствие доказательства checkout, не ошибка");
  } else {
    unchecked.push(
      `История содержит ${orders.items.length} заказов, но полный checkout ещё не подтверждён`,
    );
  }
  unchecked.push("KIT API не предоставляет настройки оплаты и доставки");
  unchecked.push("Оплата, доставка и полный checkout требуют ручного или заказного доказательства");

  recommendations.push(
    "Проверить публичную витрину отдельным web/HTTP-запросом, затем выполнить реальный тестовый checkout",
  );
  if (risks.some((risk) => /каталог|SKU|склад|категор/iu.test(risk))) {
    recommendations.push("Передать глубокие каталожные дефекты в a1-yandex-kit-catalog-doctor");
  }

  const coverage: LaunchCoverage = {
    complete:
      store !== undefined &&
      Object.values(paged).every((result) => result.complete) &&
      webhookComplete,
    counts: {
      stores: store ? 1 : 0,
      products: products.items.length,
      variants: variants.items.length,
      categories: categories.items.length,
      warehouses: warehouses.items.length,
      discounts: discounts.items.length,
      promocodes: promocodes.items.length,
      gifts: gifts.items.length,
      webhooks: webhooks.length,
      orders: orders.items.length,
    },
    pages,
  };
  const status: LaunchStatus = blockers.length > 0 ? "NOT_READY" : "CONDITIONALLY_READY";
  const humanStatus = status === "NOT_READY" ? "не готов" : "условно готов";
  const report = [
    `Статус: ${humanStatus} (${status})`,
    coverageReport(coverage),
    formatSection("Блокеры", blockers),
    formatSection("Риски", risks),
    formatSection("Не проверено", unchecked),
    formatSection("Рекомендации", recommendations),
    formatSection("Следующие действия", recommendations),
  ].join("\n\n");
  mcp.finish(report);
  return {
    status,
    blockers,
    risks,
    unchecked,
    recommendations,
    coverage,
    report,
  };
}
